"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { fmtYen, ymd } from "@/lib/invoice"

type Product = {
  id: string
  name: string
  product_code: string | null
  manufacturer: string | null
  stock: number | null
  cost: number | null
  barcode: string | null
}
type Supplier = { id: string; name: string; maker_name: string | null }

type Row = {
  productName: string         // 商品名（PDF由来 or 手入力）
  supplierJan: string         // PDF由来
  supplierCode: string        // PDF由来
  packSize: string            // 「20枚入」等
  quantity: string
  unitPrice: string
  unitQuantityPerPack: number // 換算
  memo: string
  manufacturer: string        // 新規作成時用
}

const newRow = (): Row => ({
  productName: "", supplierJan: "", supplierCode: "",
  packSize: "", quantity: "", unitPrice: "",
  unitQuantityPerPack: 1, memo: "", manufacturer: "",
})

const INITIAL_ROWS = 10

export default function ReceivingPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [recent, setRecent] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const [supplierId, setSupplierId] = useState("")
  const [date, setDate] = useState(ymd(new Date()))
  const [updateCost, setUpdateCost] = useState(true)

  const [rows, setRows] = useState<Row[]>(Array.from({ length: INITIAL_ROWS }, newRow))

  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState("")
  const [parsedMeta, setParsedMeta] = useState<{ supplier_name?: string; invoice_number?: string; invoice_date?: string; total?: number } | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [logs, setLogs] = useState<string[]>([])

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [p, s, r] = await Promise.all([
      supabase.from("products").select("id,name,product_code,manufacturer,stock,cost,barcode"),
      supabase.from("suppliers").select("id,name,maker_name").order("name"),
      supabase.from("stock_receipts").select("*").order("created_at", { ascending: false }).limit(20),
    ])
    setProducts((p.data as Product[]) || [])
    setSuppliers((s.data as Supplier[]) || [])
    setRecent(r.data || [])
    setLoading(false)
  }

  function updateRow(i: number, partial: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, ...partial } : r))
  }
  function addRow() { setRows((prev) => [...prev, newRow()]) }
  function removeRow(i: number) {
    setRows((prev) => {
      const next = prev.filter((_, idx) => idx !== i)
      return next.length === 0 ? [newRow()] : next
    })
  }
  function clearAll() {
    if (!confirm("入力をすべてクリアしますか？")) return
    setRows(Array.from({ length: INITIAL_ROWS }, newRow))
    setLogs([])
    setParsedMeta(null)
    setPdfFile(null)
    setParseError("")
  }

  async function uploadAndParse(file?: File) {
    const target = file || pdfFile
    if (!target) { setParseError("PDF を選択してください"); return }
    if (file) setPdfFile(file)
    setParsing(true)
    setParseError("")
    setParsedMeta(null)
    try {
      const buf = await target.arrayBuffer()
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
      const { data } = await r.json()
      setParsedMeta({ supplier_name: data.supplier_name, invoice_number: data.invoice_number, invoice_date: data.invoice_date, total: data.total })

      if (data.invoice_date) setDate(data.invoice_date)
      if (!supplierId && data.supplier_name) {
        const matched = suppliers.find((s) => data.supplier_name.includes(s.name) || s.name.includes(data.supplier_name.split(/\s+/)[0]))
        if (matched) setSupplierId(matched.id)
      }

      const newRows: Row[] = data.items.map((it: any) => ({
        productName: it.supplier_product_name || "",
        supplierJan: it.supplier_jan || "",
        supplierCode: it.supplier_product_code || "",
        packSize: it.pack_size || "",
        quantity: String(it.quantity || ""),
        unitPrice: String(it.unit_price || ""),
        unitQuantityPerPack: 1,
        memo: "",
        manufacturer: "",
      }))
      const padded = newRows.length >= INITIAL_ROWS ? newRows : [...newRows, ...Array.from({ length: INITIAL_ROWS - newRows.length }, newRow)]
      setRows(padded)
    } catch (e) {
      setParseError((e as Error).message)
    } finally {
      setParsing(false)
    }
  }

  // 商品マスタ検索: JAN → product_code → name
  function findProduct(row: Row): Product | undefined {
    if (row.supplierJan) {
      const m = products.find((p) => p.barcode === row.supplierJan)
      if (m) return m
    }
    if (row.supplierCode) {
      const m = products.find((p) => p.product_code === row.supplierCode)
      if (m) return m
    }
    if (row.productName) {
      return products.find((p) => p.name === row.productName.trim())
    }
    return undefined
  }

  const validRows = rows.filter((r) => r.productName.trim() && Number(r.quantity) > 0)
  const totalAmount = validRows.reduce((s, r) => s + (Number(r.unitPrice) || 0) * Number(r.quantity), 0)

  async function submitAll() {
    if (validRows.length === 0) { alert("有効な行がありません"); return }
    if (!confirm(`${validRows.length}行を仕入登録します。\n合計仕入額: ${fmtYen(totalAmount)}\n\n商品マスタに無い商品は自動で新規登録されます。\nよろしいですか？`)) return

    setSubmitting(true)
    setLogs([])
    setProgress({ done: 0, total: validRows.length })
    const newLogs: string[] = []

    let invoiceId: string | null = null
    if (parsedMeta) {
      const { data } = await supabase.from("supplier_invoices").insert({
        supplier_id: supplierId || null,
        invoice_date: date,
        invoice_number: parsedMeta.invoice_number || null,
        total_amount: totalAmount,
        pdf_filename: pdfFile?.name || null,
        parsed_data: parsedMeta,
        status: "completed",
        completed_at: new Date().toISOString(),
      }).select().single()
      invoiceId = data?.id || null
    }

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i]
      try {
        const qty = Number(row.quantity)
        const price = row.unitPrice === "" ? null : Number(row.unitPrice)
        const stockDelta = qty * row.unitQuantityPerPack

        // 商品検索 or 新規作成
        let product = findProduct(row)
        if (!product) {
          // 新規作成
          const supplierName = suppliers.find((s) => s.id === supplierId)?.name || ""
          const { data: newP, error: cpe } = await supabase.from("products").insert({
            name: row.productName.trim(),
            product_code: row.supplierCode || null,
            manufacturer: row.manufacturer || supplierName || null,
            barcode: row.supplierJan || null,
            stock: 0,
            reorder_level: 10,
            cost: price,
            price: 0,
            is_active: true,
          }).select().single()
          if (cpe) throw new Error("商品新規作成失敗: " + cpe.message)
          product = newP as Product
          newLogs.push(`+ 新規商品作成: ${product.name}`)
          // ローカルにも追加して以後のループで再利用可能に
          setProducts((prev) => [...prev, product!])
        }

        // 在庫 + cost 更新
        const productUpdate: { stock: number; cost?: number } = { stock: (product.stock || 0) + stockDelta }
        if (price !== null && updateCost) productUpdate.cost = price
        const { error: pe } = await supabase.from("products").update(productUpdate).eq("id", product.id)
        if (pe) throw new Error(pe.message)

        const memoStr = [
          row.memo,
          parsedMeta?.invoice_number ? `伝票:${parsedMeta.invoice_number}` : "",
          row.unitQuantityPerPack !== 1 ? `(${qty}×${row.unitQuantityPerPack})` : "",
        ].filter(Boolean).join(" / ")
        const { error: re } = await supabase.from("stock_receipts").insert({
          product_id: product.id,
          quantity: stockDelta,
          memo: memoStr || null,
          supplier_id: supplierId || null,
          unit_price: price,
        })
        if (re) throw new Error(re.message)

        newLogs.push(`✓ ${product.name} +${stockDelta}${row.unitQuantityPerPack !== 1 ? ` (${qty}×${row.unitQuantityPerPack})` : ""}`)
      } catch (e) {
        newLogs.push(`✗ ${row.productName}: ${(e as Error).message}`)
      }
      setProgress({ done: i + 1, total: validRows.length })
      setLogs([...newLogs])
    }

    setSubmitting(false)
    if (newLogs.every((l) => l.startsWith("✓") || l.startsWith("+"))) {
      setRows(Array.from({ length: INITIAL_ROWS }, newRow))
      setParsedMeta(null)
      setPdfFile(null)
    }
    fetchData()
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  return (
    <div className="space-y-3">
      {/* タイトル + PDF読込ボタン（タイトル直右に） */}
      <div className="flex items-center flex-wrap gap-3">
        <h1 className="text-lg font-bold text-gray-900">
          仕入入力
          <span className="ml-2 text-xs font-normal text-gray-400">手打ち or PDF読込 ・ 商品マスタは自動更新</span>
        </h1>
        <label
          htmlFor="pdf-upload"
          className={"flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors " + (parsing ? "bg-gray-300 text-gray-600 cursor-wait" : "bg-blue-600 text-white hover:bg-blue-700")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {parsing ? "AI解析中…" : "📄 PDFから読込"}
        </label>
        <input
          id="pdf-upload"
          type="file"
          accept="application/pdf"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) uploadAndParse(f)
            // ファイル選択をリセット（同じファイル再選択可能に）
            e.target.value = ""
          }}
          className="hidden"
          disabled={parsing}
        />
      </div>

      {/* 解析結果バナー（あるときだけ） */}
      {parseError && (
        <div className="bg-red-50 text-red-700 text-xs p-2 rounded" style={{ border: "1px solid #fca5a5" }}>
          ⚠ PDF解析失敗: {parseError}
        </div>
      )}
      {parsedMeta && (
        <div className="bg-blue-50 text-blue-800 text-xs p-2 rounded" style={{ border: "1px solid #c7d2fe" }}>
          ✅ <strong>{pdfFile?.name}</strong> 解析成功: {parsedMeta.supplier_name || "—"} / No.{parsedMeta.invoice_number || "—"} / 合計 {parsedMeta.total ? fmtYen(parsedMeta.total) : "—"} → 下の表に流し込み済み
        </div>
      )}

      {/* 共通設定 */}
      <div className="bg-white rounded-lg p-3" style={{ border: "1px solid #e8eaed" }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-gray-500 mb-0.5 font-bold">仕入先</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
              <option value="">— 仕入先を選択 —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.maker_name ? ` (${s.maker_name})` : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 mb-0.5 font-bold">入荷日</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
          </div>
        </div>
      </div>

      {/* 入力表 */}
      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0" }}>
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <thead className="sticky top-0 bg-gray-100">
            <tr className="text-[10px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-1.5 py-1.5 text-center w-8">#</th>
              <th className="px-1.5 py-1.5 text-left">商品名</th>
              <th className="px-1.5 py-1.5 text-left w-32">JAN / 商品コード</th>
              <th className="px-1.5 py-1.5 text-right w-12">数量</th>
              <th className="px-1.5 py-1.5 text-right w-12" title="1パッケージあたりの個数">×</th>
              <th className="px-1.5 py-1.5 text-right w-16">在庫加算</th>
              <th className="px-1.5 py-1.5 text-right w-20">仕入単価</th>
              <th className="px-1.5 py-1.5 text-right w-20">小計</th>
              <th className="px-1.5 py-1.5 text-left w-32">メモ</th>
              <th className="px-1.5 py-1.5 text-center w-8"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const stockDelta = Number(row.quantity || 0) * row.unitQuantityPerPack
              const subtotal = (Number(row.unitPrice) || 0) * Number(row.quantity || 0)
              const existing = findProduct(row)
              const isPdfRow = !!(row.supplierJan || row.supplierCode)
              return (
                <tr key={i} className={"border-b border-gray-100 " + (existing ? "bg-emerald-50/30" : isPdfRow && row.productName ? "bg-yellow-50/40" : "")}>
                  <td className="px-1.5 py-0.5 text-center text-gray-400">{i + 1}</td>
                  <td className="px-1.5 py-0.5">
                    <input
                      list="products-list"
                      value={row.productName}
                      onChange={(e) => updateRow(i, { productName: e.target.value })}
                      placeholder="商品名"
                      className="w-full px-1.5 py-0.5 border border-gray-200 rounded text-[11px]"
                    />
                    {row.packSize && <div className="text-[9px] text-gray-400 mt-0.5">入数: {row.packSize}</div>}
                    {row.productName && !existing && <div className="text-[9px] text-yellow-700 mt-0.5">⚡ 新規商品として登録されます</div>}
                  </td>
                  <td className="px-1.5 py-0.5 text-[10px] text-gray-500">
                    {row.supplierJan && <div>{row.supplierJan}</div>}
                    {row.supplierCode && <div>{row.supplierCode}</div>}
                  </td>
                  <td className="px-1.5 py-0.5">
                    <input type="number" value={row.quantity} onChange={(e) => updateRow(i, { quantity: e.target.value })} className="w-full px-1 py-0.5 border border-gray-200 rounded text-right text-[11px]" />
                  </td>
                  <td className="px-1.5 py-0.5">
                    <input type="number" min={1} value={row.unitQuantityPerPack} onChange={(e) => updateRow(i, { unitQuantityPerPack: Math.max(1, Number(e.target.value) || 1) })} className="w-full px-1 py-0.5 border border-gray-200 rounded text-right text-[11px]" title="1パッケージ=N個。例: 20枚入を「枚」管理なら20" />
                  </td>
                  <td className="px-1.5 py-0.5 text-right text-[11px] font-bold">{stockDelta > 0 ? stockDelta : ""}</td>
                  <td className="px-1.5 py-0.5">
                    <input type="number" value={row.unitPrice} onChange={(e) => updateRow(i, { unitPrice: e.target.value })} placeholder="¥" className="w-full px-1 py-0.5 border border-gray-200 rounded text-right text-[11px]" />
                  </td>
                  <td className="px-1.5 py-0.5 text-right text-[11px] font-bold">{subtotal > 0 ? fmtYen(subtotal) : ""}</td>
                  <td className="px-1.5 py-0.5">
                    <input value={row.memo} onChange={(e) => updateRow(i, { memo: e.target.value })} placeholder="伝票No等" className="w-full px-1 py-0.5 border border-gray-200 rounded text-[11px]" />
                  </td>
                  <td className="px-1.5 py-0.5 text-center">
                    <button onClick={() => removeRow(i)} className="text-red-500 hover:text-red-700 text-base leading-none">×</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-gray-50 sticky bottom-0">
            <tr className="border-t-2 border-gray-300">
              <td colSpan={7} className="px-2 py-2 text-right text-xs font-bold text-gray-700">合計</td>
              <td className="px-2 py-2 text-right text-base font-bold text-gray-900">{fmtYen(totalAmount)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <datalist id="products-list">
        {products.map((p) => <option key={p.id} value={p.name}>{p.product_code || ""} {p.manufacturer || ""}</option>)}
      </datalist>

      {/* 凡例 + アクション */}
      <div className="bg-white rounded-lg p-3 sticky bottom-0" style={{ border: "1px solid #e8eaed" }}>
        <div className="flex items-center gap-3 text-[11px] text-gray-600 mb-2 flex-wrap">
          <span><span className="inline-block w-3 h-3 bg-emerald-50 border border-emerald-200 mr-1 align-middle"></span>商品マスタ既存</span>
          <span><span className="inline-block w-3 h-3 bg-yellow-50 border border-yellow-200 mr-1 align-middle"></span>新規作成される</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={addRow} className="px-3 py-1.5 border border-gray-200 rounded text-xs">＋ 行を追加</button>
          <button onClick={clearAll} className="px-3 py-1.5 border border-gray-200 rounded text-xs text-gray-500">クリア</button>
          <label className="flex items-center gap-1 text-xs text-gray-600 ml-2">
            <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} />
            商品マスタの仕入価格も更新
          </label>
          <div className="flex-1 text-xs text-gray-500 text-right">
            有効: <strong className="text-gray-900">{validRows.length}行</strong> / 合計: <strong className="text-gray-900">{fmtYen(totalAmount)}</strong>
          </div>
          <button onClick={submitAll} disabled={submitting || validRows.length === 0} className="px-6 py-3 rounded-lg bg-gray-900 text-white font-bold text-sm disabled:opacity-50">
            {submitting ? `登録中… ${progress.done}/${progress.total}` : `${validRows.length}行 仕入登録`}
          </button>
        </div>
      </div>

      {logs.length > 0 && (
        <div className="bg-white rounded-lg p-3" style={{ border: "1px solid #e8eaed" }}>
          <p className="text-xs font-bold text-gray-500 mb-2">登録結果</p>
          <div className="space-y-1 max-h-48 overflow-auto text-[11px]">
            {logs.map((l, i) => (
              <div key={i} className={l.startsWith("✓") ? "text-emerald-700" : l.startsWith("+") ? "text-blue-700" : "text-red-700"}>{l}</div>
            ))}
          </div>
        </div>
      )}

      <details className="bg-white rounded-lg p-3" style={{ border: "1px solid #e8eaed" }}>
        <summary className="text-xs font-bold text-gray-500 cursor-pointer">直近の入荷履歴 (最新20件)</summary>
        <div className="mt-2 space-y-1 max-h-64 overflow-auto">
          {recent.map((rc) => {
            const product = products.find((p) => p.id === rc.product_id)
            const supplier = suppliers.find((s) => s.id === rc.supplier_id)
            return (
              <div key={rc.id} className="flex items-center justify-between py-1.5 px-2 text-[11px] border-b border-gray-100">
                <div className="flex-1 min-w-0">
                  <span className="font-semibold">{product?.name || "—"}</span>
                  <span className="text-gray-400 ml-2">{new Date(rc.created_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  {supplier && <span className="text-gray-400 ml-2">/ {supplier.name}</span>}
                </div>
                <div className="flex items-center gap-3 text-right shrink-0">
                  {rc.unit_price && <span className="text-gray-500">@{fmtYen(rc.unit_price)}</span>}
                  <span className="font-bold w-12">+{rc.quantity}</span>
                </div>
              </div>
            )
          })}
        </div>
      </details>
    </div>
  )
}
