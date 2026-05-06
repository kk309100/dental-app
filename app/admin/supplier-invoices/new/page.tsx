"use client"

// 月次まとめ請求書 PDF をアップロード → AI解析 → DB登録 → 自動マッチ
//
// フロー:
//   1. 仕入先選択 + PDF選択
//   2. POST /api/parse-supplier-invoice → 明細抽出
//   3. UI で確認（編集可能）
//   4. supplier_invoices + supplier_invoice_items に保存
//   5. lib/supplier-invoice-match.ts の runAutoMatch を実行
//   6. /admin/supplier-invoices/[id]/match に遷移

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { fetchSuppliersByUsage, supplierOptionLabel, type Supplier } from "@/lib/supplier-sort"
import { runAutoMatch } from "@/lib/supplier-invoice-match"

type ParsedItem = {
  delivery_date?: string
  delivery_number?: string
  supplier_product_code?: string
  jan_code?: string
  product_name: string
  manufacturer?: string
  pack_size?: string
  quantity: number
  unit_price: number
  amount: number
  tax_rate?: number
}

type ParsedInvoice = {
  supplier_name?: string
  invoice_number?: string
  invoice_date?: string
  period_start?: string
  period_end?: string
  subtotal?: number
  tax?: number
  total?: number
  items: ParsedItem[]
}

export default function NewSupplierInvoicePage() {
  const router = useRouter()

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [supplierId, setSupplierId] = useState("")
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState<ParsedInvoice | null>(null)
  const [parseError, setParseError] = useState("")
  const [saving, setSaving] = useState(false)

  // 編集可能フィールド
  const [invoiceNumber, setInvoiceNumber] = useState("")
  const [invoiceDate, setInvoiceDate] = useState("")
  const [periodStart, setPeriodStart] = useState("")
  const [periodEnd, setPeriodEnd] = useState("")
  const [totalAmount, setTotalAmount] = useState("")
  const [items, setItems] = useState<ParsedItem[]>([])

  useEffect(() => {
    (async () => {
      const sups = await fetchSuppliersByUsage("id,name")
      setSuppliers(sups)
    })()
  }, [])

  async function uploadAndParse() {
    if (!pdfFile) { alert("PDFを選択してください"); return }
    if (!supplierId) { alert("仕入先を選択してください"); return }

    setParsing(true); setParseError(""); setParsed(null)
    try {
      const buf = await pdfFile.arrayBuffer()
      const base64 = Buffer.from(buf).toString("base64")
      const r = await fetch("/api/parse-supplier-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64: base64 }),
      })
      if (!r.ok) {
        const err = await r.json()
        throw new Error(err.error || `HTTP ${r.status}`)
      }
      const { data } = await r.json()
      setParsed(data)
      setInvoiceNumber(data.invoice_number || "")
      setInvoiceDate(data.invoice_date || "")
      setPeriodStart(data.period_start || "")
      setPeriodEnd(data.period_end || "")
      setTotalAmount(String(data.total || ""))
      setItems(data.items || [])
    } catch (e) {
      setParseError((e as Error).message)
    } finally {
      setParsing(false)
    }
  }

  function updateItem(idx: number, patch: Partial<ParsedItem>) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  async function save() {
    if (!supplierId) { alert("仕入先を選択してください"); return }
    if (items.length === 0) { alert("明細がありません"); return }
    setSaving(true)
    try {
      // 1) supplier_invoices ヘッダ作成
      const { data: inv, error: e1 } = await supabase.from("supplier_invoices").insert({
        supplier_id: supplierId,
        invoice_number: invoiceNumber || null,
        invoice_date: invoiceDate || null,
        period_start: periodStart || null,
        period_end: periodEnd || null,
        total_amount: Number(totalAmount) || 0,
        computed_total: items.reduce((s, it) => s + Number(it.amount || 0), 0),
        pdf_filename: pdfFile?.name || null,
        pdf_data: parsed,
        status: "未照合",
      }).select().single()
      if (e1 || !inv) throw new Error(`請求書作成失敗: ${e1?.message}`)

      // 2) 明細を一括 insert
      const itemRows = items.map((it, idx) => ({
        supplier_invoice_id: inv.id,
        line_no: idx + 1,
        delivery_date: it.delivery_date || null,
        delivery_number: it.delivery_number || null,
        supplier_product_code: it.supplier_product_code || null,
        jan_code: it.jan_code || null,
        product_name: it.product_name || "",
        manufacturer: it.manufacturer || null,
        pack_size: it.pack_size || null,
        quantity: Number(it.quantity || 0),
        unit_price: Number(it.unit_price || 0),
        amount: Number(it.amount || 0),
        tax_rate: Number(it.tax_rate || 10),
      }))
      const { error: e2 } = await supabase.from("supplier_invoice_items").insert(itemRows)
      if (e2) {
        // ロールバック
        await supabase.from("supplier_invoices").delete().eq("id", inv.id)
        throw new Error(`明細作成失敗: ${e2.message}`)
      }

      // 3) 自動マッチ実行
      try {
        await runAutoMatch(inv.id)
      } catch (e) {
        console.warn("自動マッチ失敗（手動で再実行可能）:", e)
      }

      // 4) 付け合わせ画面へ遷移
      router.push(`/admin/supplier-invoices/${inv.id}/match`)
    } catch (e) {
      alert((e as Error).message)
      setSaving(false)
    }
  }

  const itemsTotal = items.reduce((s, it) => s + Number(it.amount || 0), 0)
  const totalDiff = totalAmount ? Number(totalAmount) - itemsTotal : 0

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900">📤 月次請求書アップロード</h1>
        <Link href="/admin/supplier-invoices" className="text-xs text-gray-500 underline">← 一覧</Link>
      </div>

      {/* Step 1: 仕入先 + PDF */}
      <div className="bg-white rounded-lg p-3 space-y-2" style={{ border: "1px solid #e8eaed" }}>
        <p className="text-xs font-bold text-gray-700">① 仕入先 + 請求書PDF</p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={supplierId} onChange={e => setSupplierId(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded text-sm bg-white min-w-[200px]">
            <option value="">— 仕入先を選択 —</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{supplierOptionLabel(s)}</option>)}
          </select>
          <input
            type="file"
            accept="application/pdf"
            onChange={e => { const f = e.target.files?.[0]; if (f) setPdfFile(f) }}
            className="text-sm"
          />
          <button onClick={uploadAndParse} disabled={!pdfFile || !supplierId || parsing}
            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded hover:bg-blue-700 disabled:opacity-40">
            {parsing ? "🤖 AI解析中..." : "📄 解析開始"}
          </button>
          {pdfFile && <span className="text-[11px] text-gray-500">{pdfFile.name} ({(pdfFile.size / 1024 / 1024).toFixed(1)}MB)</span>}
        </div>
        {parseError && (
          <p className="text-xs text-red-700 bg-red-50 p-2 rounded" style={{ border: "1px solid #fecaca" }}>
            ⚠ {parseError}
          </p>
        )}
      </div>

      {/* Step 2: 解析結果（編集可能） */}
      {parsed && (
        <>
          <div className="bg-white rounded-lg p-3 space-y-2" style={{ border: "1px solid #e8eaed" }}>
            <p className="text-xs font-bold text-gray-700">② ヘッダ情報（必要なら修正）</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
              <div>
                <label className="text-[10px] text-gray-500">請求書No</label>
                <input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-200 rounded text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500">請求日</label>
                <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-200 rounded text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500">期間開始</label>
                <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-200 rounded text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500">期間終了（締日）</label>
                <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-200 rounded text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500">請求額（税込）</label>
                <input type="number" value={totalAmount} onChange={e => setTotalAmount(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-200 rounded text-xs text-right" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg overflow-hidden" style={{ border: "1px solid #e8eaed" }}>
            <div className="p-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
              <p className="text-xs font-bold text-gray-700">③ 明細 ({items.length}行 / 計 {fmtYen(itemsTotal)})</p>
              {totalDiff !== 0 && (
                <p className="text-xs text-amber-700">
                  ⚠ 請求額 {fmtYen(Number(totalAmount))} と明細合計 {fmtYen(itemsTotal)} で {fmtYen(Math.abs(totalDiff))} ズレ
                </p>
              )}
            </div>
            <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 460px)" }}>
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr className="text-[10px] text-gray-500">
                    <th className="px-2 py-1.5 text-left w-8">#</th>
                    <th className="px-2 py-1.5 text-left w-20">納品日</th>
                    <th className="px-2 py-1.5 text-left w-20">伝票No</th>
                    <th className="px-2 py-1.5 text-left w-24">商品コード</th>
                    <th className="px-2 py-1.5 text-left">商品名</th>
                    <th className="px-2 py-1.5 text-right w-12">数量</th>
                    <th className="px-2 py-1.5 text-right w-20">単価</th>
                    <th className="px-2 py-1.5 text-right w-24">金額</th>
                    <th className="px-2 py-1.5 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx} className="border-b border-gray-100">
                      <td className="px-2 py-1 text-gray-400">{idx + 1}</td>
                      <td className="px-2 py-1">
                        <input type="date" value={it.delivery_date || ""}
                          onChange={e => updateItem(idx, { delivery_date: e.target.value })}
                          className="w-full px-1 py-0.5 border border-gray-200 rounded text-[11px]" />
                      </td>
                      <td className="px-2 py-1">
                        <input value={it.delivery_number || ""}
                          onChange={e => updateItem(idx, { delivery_number: e.target.value })}
                          className="w-full px-1 py-0.5 border border-gray-200 rounded text-[11px] font-mono" />
                      </td>
                      <td className="px-2 py-1">
                        <input value={it.supplier_product_code || ""}
                          onChange={e => updateItem(idx, { supplier_product_code: e.target.value })}
                          className="w-full px-1 py-0.5 border border-gray-200 rounded text-[11px] font-mono" />
                      </td>
                      <td className="px-2 py-1">
                        <input value={it.product_name}
                          onChange={e => updateItem(idx, { product_name: e.target.value })}
                          className="w-full px-1 py-0.5 border border-gray-200 rounded text-[11px]" />
                      </td>
                      <td className="px-2 py-1">
                        <input type="number" value={it.quantity}
                          onChange={e => updateItem(idx, { quantity: Number(e.target.value) })}
                          className="w-full px-1 py-0.5 border border-gray-200 rounded text-[11px] text-right" />
                      </td>
                      <td className="px-2 py-1">
                        <input type="number" value={it.unit_price}
                          onChange={e => updateItem(idx, { unit_price: Number(e.target.value) })}
                          className="w-full px-1 py-0.5 border border-gray-200 rounded text-[11px] text-right" />
                      </td>
                      <td className="px-2 py-1">
                        <input type="number" value={it.amount}
                          onChange={e => updateItem(idx, { amount: Number(e.target.value) })}
                          className="w-full px-1 py-0.5 border border-gray-200 rounded text-[11px] text-right font-bold" />
                      </td>
                      <td className="px-2 py-1 text-center">
                        <button onClick={() => removeItem(idx)} className="text-red-500 text-sm">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button onClick={() => { setParsed(null); setItems([]) }}
              className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded">破棄</button>
            <button onClick={save} disabled={saving || items.length === 0}
              className="px-5 py-2 text-sm font-bold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
              {saving ? "保存中…（自動マッチ実行）" : "✓ 登録 → 付け合わせへ"}
            </button>
          </div>
        </>
      )}

      {!parsed && !parsing && (
        <div className="bg-blue-50 rounded p-3 text-xs text-gray-600" style={{ border: "1px solid #c7d2fe" }}>
          💡 仕入先（リンク等）から月初に届く<strong>1ヶ月分まとめ請求書PDF</strong>をアップロードしてください。<br />
          AI が自動で全明細（納品日・商品コード・数量・金額）を抽出します。<br />
          抽出後、システムに登録済みの仕入入荷データと自動マッチング → 差異を表示します。
        </div>
      )}
    </div>
  )
}
