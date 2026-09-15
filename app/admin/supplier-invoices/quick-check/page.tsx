"use client"

// 請求書チェック（CSV × PDF 一括照合）
//
// 同じ画面で「1か月分の仕入れ記録CSV」と「1か月分の請求書PDF」を両方アップロードし、
// その場で突き合わせて仕入れ漏れ・差異を判定する。
//
// - DBには何も書き込まない「その場チェック」がデフォルト（データを汚さず何度でも試せる）
// - 判定ロジックは lib/supplier-invoice-match.ts の findProductId / findStockReceipt /
//   classifyMatch をそのまま再利用する（CSV行を「仮のstock_receipts」に変換して渡すだけ）
//   → DBに保存した後の「月次請求書付け合わせ」画面と、判定結果が完全に一致する
// - 気に入ったら「この結果を保存する」でsupplier_invoices等に永続化できる（任意）

import { useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { readTextSmart, parsePurchaseCsv, type PurchaseCsvRow } from "@/lib/purchase-csv"
import { fetchSuppliersByUsage, supplierOptionLabel, type Supplier as SupplierOption } from "@/lib/supplier-sort"
import {
  findProductId, findStockReceipt, classifyMatch,
  type SupplierInvoiceItem, type StockReceipt, type Product, type Alias,
} from "@/lib/supplier-invoice-match"

type SupplierWithCode = SupplierOption & { supplier_code?: string | null }

type ParsedInvoiceItem = {
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
  items: ParsedInvoiceItem[]
}

type ResultRow = {
  status: string
  note: string
  source: "invoice" | "csv-only" // csv-only: CSVにはあるが請求書に対応する行が無かった
  productName: string
  code: string
  invQty: number | null
  invAmount: number | null
  csvQty: number | null
  csvAmount: number | null
}

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  matched:         { label: "✅ 一致",             color: "#15803d", bg: "#dcfce7" },
  qty_mismatch:    { label: "⚠ 数量ズレ",          color: "#92400e", bg: "#fef3c7" },
  price_mismatch:  { label: "⚠ 単価ズレ",          color: "#92400e", bg: "#fef3c7" },
  amount_mismatch: { label: "⚠ 金額ズレ",          color: "#92400e", bg: "#fef3c7" },
  no_product:      { label: "❔ 商品マスタ無",      color: "#7c3aed", bg: "#ede9fe" },
  unmatched:       { label: "🔴 仕入れ漏れ疑い",    color: "#b91c1c", bg: "#fee2e2" },
  csv_extra:       { label: "🔵 請求書に無い",      color: "#1e40af", bg: "#dbeafe" },
}

export default function QuickCheckPage() {
  const [suppliers, setSuppliers] = useState<SupplierWithCode[]>([])
  const [supplierId, setSupplierId] = useState("")
  const [mastersLoaded, setMastersLoaded] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [aliases, setAliases] = useState<Alias[]>([])

  const [csvFileName, setCsvFileName] = useState("")
  const [csvRows, setCsvRows] = useState<PurchaseCsvRow[]>([])
  const [csvError, setCsvError] = useState("")
  const [csvSkipped, setCsvSkipped] = useState(0)

  const [pdfFileName, setPdfFileName] = useState("")
  const [pdfParsing, setPdfParsing] = useState(false)
  const [pdfError, setPdfError] = useState("")
  const [invoice, setInvoice] = useState<ParsedInvoice | null>(null)

  const [checked, setChecked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [filter, setFilter] = useState<string>("all")

  async function ensureMasters() {
    if (mastersLoaded) return
    const [sups, { data: prod }] = await Promise.all([
      fetchSuppliersByUsage("id,name,supplier_code"),
      supabase.from("products").select("id,name,product_code,barcode,manufacturer").limit(50000),
    ])
    setSuppliers(sups as SupplierWithCode[])
    setProducts((prod as Product[]) || [])
    setMastersLoaded(true)
  }

  async function loadAliasesFor(supId: string) {
    if (!supId) { setAliases([]); return }
    try {
      const { data } = await supabase.from("supplier_product_aliases")
        .select("supplier_id,supplier_product_code,supplier_product_name,product_id")
        .eq("supplier_id", supId).limit(50000)
      setAliases((data as Alias[]) || [])
    } catch { setAliases([]) }
  }

  async function handleCsvFile(file: File) {
    setCsvFileName(file.name); setCsvError(""); setCsvRows([]); setChecked(false); setSaved(false)
    await ensureMasters()
    const text = await readTextSmart(file)
    const parsed = parsePurchaseCsv(text)
    if (parsed.error) { setCsvError(parsed.error); return }
    setCsvRows(parsed.rows)
    setCsvSkipped(parsed.skippedCount)

    // CSVの仕入先コードから自動選択（未選択の場合のみ）
    if (!supplierId && parsed.supplierCode) {
      const m = suppliers.find(s => s.supplier_code && s.supplier_code.trim() === parsed.supplierCode)
      if (m) { setSupplierId(m.id); loadAliasesFor(m.id) }
    }
  }

  async function handlePdfFile(file: File) {
    if (!supplierId) { alert("先に仕入先を選択してください（自動判定できなかった場合は手動で選んでください）"); return }
    setPdfFileName(file.name); setPdfError(""); setInvoice(null); setChecked(false); setSaved(false)
    setPdfParsing(true)
    try {
      const buf = await file.arrayBuffer()
      const base64 = Buffer.from(buf).toString("base64")
      const r = await fetch("/api/parse-supplier-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64: base64 }),
      })
      const body = await r.json().catch(() => null)
      if (!r.ok || !body) throw new Error(body?.error || `HTTP ${r.status}`)
      setInvoice(body.data as ParsedInvoice)
    } catch (e) {
      setPdfError((e as Error).message)
    } finally {
      setPdfParsing(false)
    }
  }

  // ── 照合本体：lib/supplier-invoice-match.ts の関数をそのまま再利用 ──────
  const results: ResultRow[] = useMemo(() => {
    if (!checked || !invoice) return []

    // CSV行を「仮の stock_receipts」として扱う（DBに保存前でも同じロジックで判定できるように）
    const fakeReceipts: (StockReceipt & { _row: PurchaseCsvRow })[] = csvRows.map((row, i) => ({
      id: `csv-${i}`,
      supplier_id: supplierId,
      product_id: findProductId(
        { supplier_product_code: row.productCode || null, jan_code: null, product_name: row.productName || null },
        supplierId, products, aliases
      ).product_id,
      quantity: row.quantity ?? 0,
      unit_price: row.unitPrice,
      created_at: row.voucherDate ? `${row.voucherDate}T00:00:00` : new Date().toISOString(),
      memo: null,
      supplier_invoice_item_id: null,
      _row: row,
    }))

    const claimed = new Set<string>()
    const out: ResultRow[] = []

    for (const it of invoice.items) {
      const item: SupplierInvoiceItem = {
        id: `inv-${out.length}`,
        supplier_invoice_id: "quick-check",
        delivery_date: it.delivery_date || null,
        delivery_number: it.delivery_number || null,
        supplier_product_code: it.supplier_product_code || null,
        jan_code: it.jan_code || null,
        product_name: it.product_name || null,
        quantity: Number(it.quantity || 0),
        unit_price: Number(it.unit_price || 0),
        amount: Number(it.amount || 0),
      }
      const { product_id } = findProductId(item, supplierId, products, aliases)
      let receipt: (StockReceipt & { _row: PurchaseCsvRow }) | null = null
      if (product_id) {
        const remaining = fakeReceipts.filter(r => !claimed.has(r.id))
        const r = findStockReceipt(product_id, supplierId, item.quantity, item.delivery_date, remaining)
        receipt = (r.receipt as (StockReceipt & { _row: PurchaseCsvRow }) | null)
        if (receipt) claimed.add(receipt.id)
      }
      const { status, note } = classifyMatch(item, product_id, receipt)
      out.push({
        status, note,
        source: "invoice",
        productName: it.product_name || "(品名不明)",
        code: it.supplier_product_code || "",
        invQty: item.quantity, invAmount: item.amount,
        csvQty: receipt?.quantity ?? null, csvAmount: receipt ? Number(receipt.unit_price || 0) * Number(receipt.quantity) : null,
      })
    }

    // 請求書側に対応が無かったCSV行 = 記録はあるが請求書に載っていない
    fakeReceipts.filter(r => !claimed.has(r.id)).forEach(r => {
      out.push({
        status: "csv_extra",
        note: "",
        source: "csv-only",
        productName: r._row.productName,
        code: r._row.productCode,
        invQty: null, invAmount: null,
        csvQty: r._row.quantity, csvAmount: r._row.amount,
      })
    })

    return out
  }, [checked, invoice, csvRows, supplierId, products, aliases])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    results.forEach(r => { c[r.status] = (c[r.status] || 0) + 1 })
    return c
  }, [results])

  const filtered = filter === "all" ? results : results.filter(r => r.status === filter)
  const canCheck = csvRows.length > 0 && !!invoice && !!supplierId

  async function handleSave() {
    if (!invoice || !supplierId) return
    if (!confirm(
      `この結果をデータベースに保存します。\n` +
      `・請求書として記録（supplier_invoices / supplier_invoice_items）\n` +
      `・CSVの仕入れ記録を入荷履歴として記録（stock_receipts）\n\n` +
      `よろしいですか？`
    )) return
    setSaving(true)
    try {
      // 1) 請求書ヘッダ + 明細
      const { data: inv, error: e1 } = await supabase.from("supplier_invoices").insert({
        supplier_id: supplierId,
        invoice_number: invoice.invoice_number || null,
        invoice_date: invoice.invoice_date || null,
        period_start: invoice.period_start || null,
        period_end: invoice.period_end || null,
        total_amount: Number(invoice.total || 0),
        computed_total: invoice.items.reduce((s, it) => s + Number(it.amount || 0), 0),
        pdf_filename: pdfFileName || null,
        pdf_data: invoice,
        status: "未照合",
      }).select().single()
      if (e1 || !inv) throw new Error("請求書の保存に失敗: " + e1?.message)

      const itemRows = invoice.items.map((it, idx) => ({
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
      if (e2) { await supabase.from("supplier_invoices").delete().eq("id", inv.id); throw new Error("明細の保存に失敗: " + e2.message) }

      // 2) CSVの仕入れ記録を stock_receipts に保存（商品マスタに無いものはスキップ）
      const productIdByCode = new Map(products.filter(p => p.product_code).map(p => [p.product_code as string, p.id]))
      const receiptRows = csvRows
        .map(row => {
          const pid = row.productCode ? productIdByCode.get(row.productCode) : undefined
          if (!pid) return null
          return {
            product_id: pid,
            supplier_id: supplierId,
            quantity: row.quantity ?? 0,
            unit_price: row.unitPrice,
            created_at: row.voucherDate ? `${row.voucherDate}T00:00:00` : undefined,
            memo: [row.voucherNo && `伝票№:${row.voucherNo}`, "CSV取込(即時チェック)"].filter(Boolean).join(" / "),
          }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
      for (let i = 0; i < receiptRows.length; i += 500) {
        await supabase.from("stock_receipts").insert(receiptRows.slice(i, i + 500))
      }

      // 3) DB側の自動マッチも走らせて状態を同期しておく
      const { runAutoMatch } = await import("@/lib/supplier-invoice-match")
      try { await runAutoMatch(inv.id) } catch { /* 手動で再実行可能 */ }

      setSaved(true)
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center flex-wrap gap-3">
        <h1 className="text-lg font-bold text-gray-900" style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: 0 }}>
          📋 請求書チェック（CSV × PDF 一括照合）
        </h1>
        <Link href="/admin/supplier-invoices" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold text-purple-700 bg-purple-100 hover:bg-purple-200 transition-colors">
          請求書一覧
        </Link>
        <Link href="/admin/receiving/csv-import" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold text-blue-700 bg-blue-100 hover:bg-blue-200 transition-colors">
          CSVだけ取り込む
        </Link>
      </div>

      <div className="rounded-lg p-3" style={{ border: "1px solid #c7d2fe", background: "#eef2ff" }}>
        <p className="text-xs text-gray-700">
          1か月分の「仕入れ記録CSV」と「請求書PDF」を両方アップロードすると、その場で突き合わせて<strong>仕入れ漏れ・数量/金額のズレ</strong>を判定します。
          この画面だけではデータベースには何も保存されません（下の「保存する」を押すまでは、何度でもやり直せます）。
        </p>
      </div>

      <div className="rounded-lg p-4 space-y-2" style={{ border: "1px solid #e5e7eb", background: "#fff" }}>
        <p className="text-xs font-bold text-gray-700">仕入先</p>
        <select
          className="border rounded px-2 py-1.5 text-sm min-w-[220px]"
          value={supplierId}
          onChange={async (e) => { setSupplierId(e.target.value); await loadAliasesFor(e.target.value); setChecked(false); setSaved(false) }}
          onFocus={ensureMasters}
        >
          <option value="">— 仕入先を選択 —</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{supplierOptionLabel(s)}</option>)}
        </select>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-lg p-4 space-y-2" style={{ border: "1px solid #e5e7eb", background: "#fff" }}>
          <p className="text-xs font-bold text-gray-700">① 仕入れ記録CSV</p>
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold cursor-pointer bg-blue-600 text-white hover:bg-blue-700 transition-colors">
            📄 CSVを選択
            <input type="file" accept=".csv,text/csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCsvFile(f); e.target.value = "" }} />
          </label>
          {csvFileName && <p className="text-xs text-gray-500">{csvFileName} — {csvRows.length}行（スキップ{csvSkipped}件）</p>}
          {csvError && <p className="text-xs text-red-700 bg-red-50 p-2 rounded whitespace-pre-wrap">⚠ {csvError}</p>}
        </div>

        <div className="rounded-lg p-4 space-y-2" style={{ border: "1px solid #e5e7eb", background: "#fff" }}>
          <p className="text-xs font-bold text-gray-700">② 請求書PDF</p>
          <label className={"inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold cursor-pointer transition-colors " + (pdfParsing ? "bg-gray-300 text-gray-600 cursor-wait" : "bg-blue-600 text-white hover:bg-blue-700")}>
            {pdfParsing ? "🤖 AI解析中…" : "📄 PDFを選択"}
            <input type="file" accept="application/pdf" className="hidden" disabled={pdfParsing}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePdfFile(f); e.target.value = "" }} />
          </label>
          {pdfFileName && invoice && <p className="text-xs text-gray-500">{pdfFileName} — {invoice.items.length}行 / 合計{fmtYen(invoice.total || 0)}</p>}
          {pdfError && <p className="text-xs text-red-700 bg-red-50 p-2 rounded whitespace-pre-wrap">⚠ {pdfError}</p>}
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={() => setChecked(true)}
          disabled={!canCheck}
          className={"px-6 py-2.5 rounded-lg text-sm font-bold " + (canCheck ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-gray-200 text-gray-400 cursor-not-allowed")}
        >
          🔍 この2つを照合する
        </button>
      </div>

      {checked && (
        <div className="rounded-lg p-4 space-y-3" style={{ border: "1px solid #e5e7eb", background: "#fff" }}>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-sm">
            <div className="rounded p-2" style={{ background: "#f9fafb" }}><div className="text-gray-500">明細数</div><div className="font-bold">{results.length}</div></div>
            <div className="rounded p-2" style={{ background: STATUS_LABEL.matched.bg }}><div style={{ color: STATUS_LABEL.matched.color }}>一致</div><div className="font-bold" style={{ color: STATUS_LABEL.matched.color }}>{counts.matched || 0}</div></div>
            <div className="rounded p-2" style={{ background: STATUS_LABEL.qty_mismatch.bg }}><div style={{ color: STATUS_LABEL.qty_mismatch.color }}>数量/単価ズレ</div><div className="font-bold" style={{ color: STATUS_LABEL.qty_mismatch.color }}>{(counts.qty_mismatch||0)+(counts.price_mismatch||0)+(counts.amount_mismatch||0)}</div></div>
            <div className="rounded p-2" style={{ background: STATUS_LABEL.unmatched.bg }}><div style={{ color: STATUS_LABEL.unmatched.color }}>仕入れ漏れ疑い</div><div className="font-bold" style={{ color: STATUS_LABEL.unmatched.color }}>{counts.unmatched || 0}</div></div>
            <div className="rounded p-2" style={{ background: STATUS_LABEL.csv_extra.bg }}><div style={{ color: STATUS_LABEL.csv_extra.color }}>請求書に無い</div><div className="font-bold" style={{ color: STATUS_LABEL.csv_extra.color }}>{counts.csv_extra || 0}</div></div>
            <div className="rounded p-2" style={{ background: STATUS_LABEL.no_product.bg }}><div style={{ color: STATUS_LABEL.no_product.color }}>商品マスタ無</div><div className="font-bold" style={{ color: STATUS_LABEL.no_product.color }}>{counts.no_product || 0}</div></div>
          </div>

          {(counts.unmatched || 0) > 0 && (
            <div className="rounded-lg p-3" style={{ border: "2px solid #ef4444", background: "#fef2f2" }}>
              <p className="text-sm font-bold text-red-800">🔴 {counts.unmatched}件の仕入れ漏れ疑いがあります — 請求書には載っているのに、CSVの仕入れ記録に見当たりません。</p>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap text-xs">
            {["all", ...Object.keys(STATUS_LABEL)].map(k => (
              <button key={k} onClick={() => setFilter(k)}
                className={"px-2.5 py-1 rounded-full border " + (filter === k ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-300")}>
                {k === "all" ? "すべて" : STATUS_LABEL[k].label}
              </button>
            ))}
          </div>

          <div className="overflow-auto rounded border" style={{ maxHeight: 420 }}>
            <table className="w-full text-xs">
              <thead className="sticky top-0" style={{ background: "#f9fafb" }}>
                <tr>
                  <th className="text-left p-2">状態</th>
                  <th className="text-left p-2">品名</th>
                  <th className="text-right p-2">数量(請求書)</th>
                  <th className="text-right p-2">金額(請求書)</th>
                  <th className="text-right p-2">数量(記録)</th>
                  <th className="text-right p-2">金額(記録)</th>
                  <th className="text-left p-2">備考</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2"><span style={{ color: STATUS_LABEL[r.status].color, background: STATUS_LABEL[r.status].bg, padding: "2px 8px", borderRadius: 999, fontWeight: 700 }}>{STATUS_LABEL[r.status].label}</span></td>
                    <td className="p-2">{r.productName}</td>
                    <td className="p-2 text-right">{r.invQty ?? "―"}</td>
                    <td className="p-2 text-right">{r.invAmount != null ? fmtYen(r.invAmount) : "―"}</td>
                    <td className="p-2 text-right">{r.csvQty ?? "―"}</td>
                    <td className="p-2 text-right">{r.csvAmount != null ? fmtYen(r.csvAmount) : "―"}</td>
                    <td className="p-2 text-gray-500">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!saved ? (
            <div className="flex justify-end">
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-bold bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-50">
                {saving ? "保存中…" : "💾 この結果をデータベースに保存する（任意）"}
              </button>
            </div>
          ) : (
            <div className="rounded-lg p-3" style={{ border: "2px solid #059669", background: "#f0fdf4" }}>
              <p className="text-sm font-bold text-emerald-800">✅ 保存しました</p>
              <Link href="/admin/supplier-invoices" className="text-sm text-purple-700 underline">請求書一覧で確認する</Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
