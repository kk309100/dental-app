"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { fmtYen, ymd } from "@/lib/invoice"
import Link from "next/link"

type Supplier = { id: string; name: string; maker_name: string | null }
type Product = { id: string; name: string; product_code: string | null; manufacturer: string | null; cost: number | null }
type Mapping = {
  id: string
  supplier_id: string | null
  supplier_product_code: string | null
  supplier_jan: string | null
  supplier_product_name: string
  product_id: string | null
  unit_quantity_per_pack: number
}

type ParsedItem = {
  supplier_jan?: string
  supplier_product_code?: string
  supplier_product_name: string
  pack_size?: string
  quantity: number
  unit_price: number
  amount?: number
}
type ParsedInvoice = {
  supplier_name?: string
  invoice_number?: string
  invoice_date?: string
  subtotal?: number
  tax?: number
  total?: number
  items: ParsedItem[]
}

type Row = ParsedItem & {
  // ユーザー編集
  productId: string
  unitQuantityPerPack: number
  excluded: boolean
  // マッピング状態
  mappingFound: boolean
  mappingId?: string
}

export default function PdfReceivingPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [mappings, setMappings] = useState<Mapping[]>([])
  const [supplierId, setSupplierId] = useState("")
  const [date, setDate] = useState(ymd(new Date()))
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState<ParsedInvoice | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [logs, setLogs] = useState<string[]>([])

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    const [s, p, m] = await Promise.all([
      supabase.from("suppliers").select("id,name,maker_name").order("name"),
      supabase.from("products").select("id,name,product_code,manufacturer,cost").order("name"),
      supabase.from("supplier_product_mappings").select("*"),
    ])
    setSuppliers(s.data || [])
    setProducts(p.data || [])
    setMappings(m.data || [])
  }

  // 商品名/コード → product マップ
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  function findMapping(item: ParsedItem): Mapping | undefined {
    if (!supplierId) return undefined
    // 優先順: supplier+jan → supplier+code → supplier+name
    const supplierMaps = mappings.filter((m) => m.supplier_id === supplierId)
    if (item.supplier_jan) {
      const m = supplierMaps.find((m) => m.supplier_jan === item.supplier_jan)
      if (m) return m
    }
    if (item.supplier_product_code) {
      const m = supplierMaps.find((m) => m.supplier_product_code === item.supplier_product_code)
      if (m) return m
    }
    return supplierMaps.find((m) => m.supplier_product_name === item.supplier_product_name)
  }

  // 自社商品候補を仕入先商品名から推定
  function suggestProduct(item: ParsedItem): string {
    const name = item.supplier_product_name.toLowerCase()
    // 簡易マッチング: 商品名に部分一致するもの
    const candidate = products.find((p) => name.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(name.slice(0, 8)))
    return candidate?.id || ""
  }

  async function uploadAndParse() {
    if (!file) { setError("PDF を選択してください"); return }
    setParsing(true)
    setError("")
    setParsed(null)
    setRows([])
    try {
      // PDF を base64 化
      const buf = await file.arrayBuffer()
      const base64 = Buffer.from(buf).toString("base64")

      const r = await fetch("/api/parse-receiving", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64: base64 }),
      })
      if (!r.ok) {
        const err = await r.json()
        throw new Error(err.error || "解析失敗")
      }
      const { data } = await r.json() as { data: ParsedInvoice }
      setParsed(data)

      // 行を構築（マッピング自動適用）
      const newRows: Row[] = data.items.map((item) => {
        const mapping = findMapping(item)
        const productId = mapping?.product_id || suggestProduct(item)
        const unitQ = mapping?.unit_quantity_per_pack || 1
        return {
          ...item,
          productId,
          unitQuantityPerPack: unitQ,
          excluded: false,
          mappingFound: !!mapping,
          mappingId: mapping?.id,
        }
      })
      setRows(newRows)

      // 仕入先名や日付を自動入力
      if (data.invoice_date) setDate(data.invoice_date)
      // supplier 名から推定
      if (!supplierId && data.supplier_name) {
        const matched = suppliers.find((s) => data.supplier_name!.includes(s.name) || s.name.includes(data.supplier_name!.split(/\s+/)[0]))
        if (matched) setSupplierId(matched.id)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setParsing(false)
    }
  }

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }

  // 仕入先変更時、マッピングを再計算
  useEffect(() => {
    if (!parsed) return
    setRows((prev) => prev.map((r) => {
      const item = { supplier_jan: r.supplier_jan, supplier_product_code: r.supplier_product_code, supplier_product_name: r.supplier_product_name, quantity: r.quantity, unit_price: r.unit_price }
      const mapping = findMapping(item)
      if (mapping) {
        return { ...r, productId: mapping.product_id || r.productId, unitQuantityPerPack: mapping.unit_quantity_per_pack, mappingFound: true, mappingId: mapping.id }
      }
      return { ...r, mappingFound: false, mappingId: undefined }
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId])

  const validRows = rows.filter((r) => !r.excluded && r.productId && r.quantity > 0)
  const totalAmount = validRows.reduce((s, r) => s + (r.unit_price || 0) * r.quantity, 0)
  const allMapped = validRows.every((r) => r.productId)

  async function commitAll() {
    if (!supplierId) { alert("仕入先を選択してください"); return }
    if (validRows.length === 0) { alert("有効な明細がありません"); return }
    if (!confirm(`${validRows.length}行を仕入登録します。\n合計: ${fmtYen(totalAmount)}\nよろしいですか？`)) return

    setSubmitting(true)
    setLogs([])
    setProgress({ done: 0, total: validRows.length })
    const newLogs: string[] = []

    // 1) supplier_invoice 作成
    const { data: inv, error: invErr } = await supabase.from("supplier_invoices").insert({
      supplier_id: supplierId,
      invoice_date: date,
      invoice_number: parsed?.invoice_number || null,
      total_amount: totalAmount,
      pdf_filename: file?.name || null,
      parsed_data: parsed,
      status: "completed",
      completed_at: new Date().toISOString(),
    }).select().single()
    if (invErr) {
      alert("supplier_invoice 作成失敗: " + invErr.message)
      setSubmitting(false)
      return
    }

    for (let i = 0; i < validRows.length; i++) {
      const r = validRows[i]
      try {
        const product = productById.get(r.productId)
        if (!product) throw new Error("商品が見つかりません")
        const stockDelta = r.quantity * r.unitQuantityPerPack

        // 商品の在庫 + cost更新
        const { error: pe } = await supabase.from("products").update({
          stock: ((product as any).stock || 0) + stockDelta,
          cost: r.unit_price,
        }).eq("id", product.id)
        if (pe) throw new Error(pe.message)

        // stock_receipts insert
        const { error: re } = await supabase.from("stock_receipts").insert({
          product_id: product.id,
          quantity: stockDelta,
          memo: `${parsed?.invoice_number || ""} / ${r.supplier_product_name}${r.unitQuantityPerPack !== 1 ? ` (${r.quantity}×${r.unitQuantityPerPack})` : ""}`,
          supplier_id: supplierId,
          unit_price: r.unit_price,
        })
        if (re) throw new Error(re.message)

        // マッピング保存（学習）
        if (r.mappingId) {
          // 更新
          await supabase.from("supplier_product_mappings").update({
            product_id: r.productId,
            unit_quantity_per_pack: r.unitQuantityPerPack,
            updated_at: new Date().toISOString(),
          }).eq("id", r.mappingId)
        } else {
          // 新規
          await supabase.from("supplier_product_mappings").insert({
            supplier_id: supplierId,
            supplier_jan: r.supplier_jan || null,
            supplier_product_code: r.supplier_product_code || null,
            supplier_product_name: r.supplier_product_name,
            product_id: r.productId,
            unit_quantity_per_pack: r.unitQuantityPerPack,
          })
        }

        newLogs.push(`✓ ${product.name} +${stockDelta} (${r.quantity}×${r.unitQuantityPerPack})`)
      } catch (e) {
        newLogs.push(`✗ ${r.supplier_product_name}: ${(e as Error).message}`)
      }
      setProgress({ done: i + 1, total: validRows.length })
      setLogs([...newLogs])
    }

    setSubmitting(false)
    if (newLogs.every((l) => l.startsWith("✓"))) {
      alert("全件登録完了 ✓\n仕入先納品書: " + (inv.id))
      // フォームクリア
      setRows([])
      setParsed(null)
      setFile(null)
    }
    fetchData()
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-bold text-gray-900">
          仕入納品書PDF取込
          <span className="ml-2 text-xs font-normal text-gray-400">AI読取で一括登録</span>
        </h1>
      </div>

      {/* ステップ1: 仕入先・PDF */}
      <div className="bg-white rounded-lg p-3" style={{ border: "1px solid #e8eaed" }}>
        <p className="text-xs font-bold text-gray-500 mb-2">① 仕入先 + PDF</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
            <option value="">— 仕入先選択 —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.maker_name ? ` (${s.maker_name})` : ""}</option>)}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
          <div className="flex gap-1">
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="flex-1 text-xs"
            />
            <button onClick={uploadAndParse} disabled={!file || parsing} className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-bold disabled:opacity-50">
              {parsing ? "解析中…" : "AI解析"}
            </button>
          </div>
        </div>
        {error && <p className="text-xs text-red-600 mt-2">⚠ {error}</p>}
      </div>

      {/* 解析結果 */}
      {parsed && (
        <>
          <div className="bg-blue-50 rounded-lg p-3" style={{ border: "1px solid #c7d2fe" }}>
            <p className="text-xs">
              <strong>解析結果</strong>: {parsed.supplier_name || "—"} ／ No.{parsed.invoice_number || "—"} ／ 発行 {parsed.invoice_date || "—"} ／ 合計 {parsed.total ? fmtYen(parsed.total) : "—"}
            </p>
          </div>

          <div className="bg-white rounded-lg overflow-auto" style={{ border: "1px solid #d0d0d0" }}>
            <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
              <thead className="sticky top-0 bg-gray-100">
                <tr className="text-[10px] text-gray-700 font-bold border-b-2 border-gray-300">
                  <th className="px-1.5 py-1.5 text-center w-8">除外</th>
                  <th className="px-1.5 py-1.5 text-left">仕入先 商品名 / 入数</th>
                  <th className="px-1.5 py-1.5 text-right w-12">数量</th>
                  <th className="px-1.5 py-1.5 text-right w-16">単価</th>
                  <th className="px-1.5 py-1.5 text-left">→ 自社商品</th>
                  <th className="px-1.5 py-1.5 text-right w-16">換算 ×</th>
                  <th className="px-1.5 py-1.5 text-right w-20">在庫加算</th>
                  <th className="px-1.5 py-1.5 text-center w-10">学習</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const stockDelta = r.quantity * r.unitQuantityPerPack
                  return (
                    <tr key={i} className={"border-b border-gray-100 " + (r.excluded ? "opacity-40 bg-gray-50" : r.mappingFound ? "bg-emerald-50/40" : !r.productId ? "bg-orange-50/40" : "")}>
                      <td className="px-1.5 py-1 text-center">
                        <input type="checkbox" checked={r.excluded} onChange={(e) => updateRow(i, { excluded: e.target.checked })} />
                      </td>
                      <td className="px-1.5 py-1 text-[11px]">
                        <div className="font-semibold">{r.supplier_product_name}</div>
                        <div className="text-gray-400 text-[10px]">
                          {r.supplier_jan && `JAN: ${r.supplier_jan}`}
                          {r.supplier_product_code && ` / 仕入CD: ${r.supplier_product_code}`}
                          {r.pack_size && ` / 入数: ${r.pack_size}`}
                        </div>
                      </td>
                      <td className="px-1.5 py-1 text-right">{r.quantity}</td>
                      <td className="px-1.5 py-1 text-right">{fmtYen(r.unit_price)}</td>
                      <td className="px-1.5 py-1">
                        <select value={r.productId} onChange={(e) => updateRow(i, { productId: e.target.value })} className="w-full px-1 py-0.5 border border-gray-200 rounded text-[11px]">
                          <option value="">— 選択 —</option>
                          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </td>
                      <td className="px-1.5 py-1">
                        <input type="number" min={1} value={r.unitQuantityPerPack} onChange={(e) => updateRow(i, { unitQuantityPerPack: Math.max(1, Number(e.target.value) || 1) })} className="w-full px-1 py-0.5 border border-gray-200 rounded text-right text-[11px]" />
                      </td>
                      <td className="px-1.5 py-1 text-right text-[11px] font-bold">{stockDelta}</td>
                      <td className="px-1.5 py-1 text-center text-[10px]">
                        {r.mappingFound ? <span className="text-emerald-600" title="マッピング学習済み">✓</span> : <span className="text-gray-300" title="新規">+</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={6} className="px-2 py-2 text-right text-xs font-bold">合計</td>
                  <td colSpan={2} className="px-2 py-2 text-right text-sm font-bold">{fmtYen(totalAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {!allMapped && (
            <div className="bg-orange-50 text-orange-800 text-xs p-2 rounded">
              ⚠ 自社商品が選択されていない行があります（オレンジ背景）。マッピングしてから完了してください。
            </div>
          )}

          <button
            onClick={commitAll}
            disabled={submitting || !supplierId || validRows.length === 0 || !allMapped}
            className="w-full px-4 py-3 bg-gray-900 text-white rounded-lg font-bold disabled:opacity-50"
          >
            {submitting ? `登録中… ${progress.done}/${progress.total}` : `${validRows.length}行 仕入登録（${fmtYen(totalAmount)}）`}
          </button>

          {logs.length > 0 && (
            <div className="bg-white rounded-lg p-2 max-h-48 overflow-auto text-xs space-y-0.5" style={{ border: "1px solid #e8eaed" }}>
              {logs.map((l, i) => <div key={i} className={l.startsWith("✓") ? "text-emerald-700" : "text-red-700"}>{l}</div>)}
            </div>
          )}
        </>
      )}

      {/* マッピング一覧（参考） */}
      <details className="bg-white rounded-lg p-3" style={{ border: "1px solid #e8eaed" }}>
        <summary className="text-xs font-bold text-gray-500 cursor-pointer">学習済みマッピング ({mappings.length}件)</summary>
        <div className="mt-2 max-h-48 overflow-auto">
          <table className="w-full text-[10px]">
            <thead className="bg-gray-50">
              <tr><th className="px-1 py-1 text-left">仕入先名</th><th className="px-1 py-1 text-left">JAN/コード</th><th className="px-1 py-1 text-left">→ 自社</th><th className="px-1 py-1 text-right">×</th></tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={m.id} className="border-b border-gray-100">
                  <td className="px-1 py-0.5">{m.supplier_product_name}</td>
                  <td className="px-1 py-0.5 text-gray-500">{m.supplier_jan || m.supplier_product_code || "—"}</td>
                  <td className="px-1 py-0.5">{m.product_id ? productById.get(m.product_id)?.name : "—"}</td>
                  <td className="px-1 py-0.5 text-right">{m.unit_quantity_per_pack}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
