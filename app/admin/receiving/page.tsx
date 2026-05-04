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
}
type Supplier = { id: string; name: string; maker_name: string | null }
type Mapping = {
  id: string
  supplier_id: string | null
  supplier_product_code: string | null
  supplier_jan: string | null
  supplier_product_name: string
  product_id: string | null
  unit_quantity_per_pack: number
}

type Row = {
  // 商品（既存マスタ参照 or PDFからの自由テキスト）
  productId: string
  productName: string  // datalist 表示 + 既存商品マッチング用
  // 仕入伝票上の情報（PDFから入る場合あり）
  supplierJan: string
  supplierCode: string
  supplierProductName: string  // PDFの場合の元の商品名
  packSize: string  // 「20枚入」等
  // 数量・単価
  quantity: string
  unitPrice: string
  unitQuantityPerPack: number  // 換算係数
  memo: string
  // マッピング状態
  mappingId?: string
  mappingFound: boolean
}

const newRow = (): Row => ({
  productId: "", productName: "",
  supplierJan: "", supplierCode: "", supplierProductName: "",
  packSize: "", quantity: "", unitPrice: "",
  unitQuantityPerPack: 1, memo: "",
  mappingFound: false,
})

const INITIAL_ROWS = 10

export default function ReceivingPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [mappings, setMappings] = useState<Mapping[]>([])
  const [recent, setRecent] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // 共通設定
  const [supplierId, setSupplierId] = useState("")
  const [date, setDate] = useState(ymd(new Date()))
  const [updateCost, setUpdateCost] = useState(true)

  // 表データ
  const [rows, setRows] = useState<Row[]>(Array.from({ length: INITIAL_ROWS }, newRow))

  // PDF解析
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState("")
  const [parsedMeta, setParsedMeta] = useState<{ supplier_name?: string; invoice_number?: string; invoice_date?: string; total?: number } | null>(null)

  // 登録
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [logs, setLogs] = useState<string[]>([])

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [p, s, m, r] = await Promise.all([
      supabase.from("products").select("id,name,product_code,manufacturer,stock,cost").order("name"),
      supabase.from("suppliers").select("id,name,maker_name").order("name"),
      supabase.from("supplier_product_mappings").select("*"),
      supabase.from("stock_receipts").select("*").order("created_at", { ascending: false }).limit(20),
    ])
    setProducts((p.data as Product[]) || [])
    setSuppliers((s.data as Supplier[]) || [])
    setMappings((m.data as Mapping[]) || [])
    setRecent(r.data || [])
    setLoading(false)
  }

  // 商品マスタの name → product マップ
  const productByName = useMemo(() => new Map(products.map((p) => [p.name, p])), [products])

  // マッピング検索（仕入先固定で JAN > 商品コード > 商品名）
  function findMapping(supplierJan: string, supplierCode: string, supplierProductName: string): Mapping | undefined {
    if (!supplierId) return undefined
    const list = mappings.filter((m) => m.supplier_id === supplierId)
    if (supplierJan) { const m = list.find((m) => m.supplier_jan === supplierJan); if (m) return m }
    if (supplierCode) { const m = list.find((m) => m.supplier_product_code === supplierCode); if (m) return m }
    if (supplierProductName) return list.find((m) => m.supplier_product_name === supplierProductName)
    return undefined
  }

  function updateRow(i: number, partial: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, ...partial } : r))
  }

  function onProductNameChange(i: number, name: string) {
    const p = productByName.get(name)
    updateRow(i, {
      productName: name,
      productId: p?.id || "",
      // 商品が見つかったら、空の単価を cost で埋める
      ...(p && !rows[i].unitPrice && p.cost ? { unitPrice: String(p.cost) } : {}),
    })
  }

  function addRow() { setRows((prev) => [...prev, newRow()]) }
  function removeRow(i: number) {
    setRows((prev) => {
      const next = prev.filter((_, idx) => idx !== i)
      return next.length === 0 ? [newRow()] : next
    })
  }
  function clearAll() {
    if (!confirm("入力をすべてクリアしますか？（PDF解析結果も含む）")) return
    setRows(Array.from({ length: INITIAL_ROWS }, newRow))
    setLogs([])
    setParsedMeta(null)
    setPdfFile(null)
    setParseError("")
  }

  // PDF アップロード → 解析 → 表に流し込み
  async function uploadAndParse() {
    if (!pdfFile) { setParseError("PDF を選択してください"); return }
    setParsing(true)
    setParseError("")
    setParsedMeta(null)
    try {
      const buf = await pdfFile.arrayBuffer()
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

      // 仕入先・日付を自動セット
      if (data.invoice_date) setDate(data.invoice_date)
      if (!supplierId && data.supplier_name) {
        const matched = suppliers.find((s) => data.supplier_name.includes(s.name) || s.name.includes(data.supplier_name.split(/\s+/)[0]))
        if (matched) setSupplierId(matched.id)
      }

      // 表に流し込み（マッピング自動適用）
      const newRows: Row[] = data.items.map((it: any) => {
        const m = findMapping(it.supplier_jan || "", it.supplier_product_code || "", it.supplier_product_name)
        const product = m?.product_id ? products.find((p) => p.id === m.product_id) : products.find((p) => it.supplier_product_name?.toLowerCase().includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(it.supplier_product_name?.toLowerCase().slice(0, 8) || ""))
        return {
          productId: product?.id || "",
          productName: product?.name || "",
          supplierJan: it.supplier_jan || "",
          supplierCode: it.supplier_product_code || "",
          supplierProductName: it.supplier_product_name || "",
          packSize: it.pack_size || "",
          quantity: String(it.quantity || ""),
          unitPrice: String(it.unit_price || ""),
          unitQuantityPerPack: m?.unit_quantity_per_pack || 1,
          memo: "",
          mappingId: m?.id,
          mappingFound: !!m,
        }
      })
      // 既存の空行を消して PDF からの行で置き換え（足りなければ空行追加）
      const padded = newRows.length >= INITIAL_ROWS ? newRows : [...newRows, ...Array.from({ length: INITIAL_ROWS - newRows.length }, newRow)]
      setRows(padded)
    } catch (e) {
      setParseError((e as Error).message)
    } finally {
      setParsing(false)
    }
  }

  // 集計
  const validRows = rows.filter((r) => r.productId && Number(r.quantity) > 0)
  const totalAmount = validRows.reduce((s, r) => s + (Number(r.unitPrice) || 0) * Number(r.quantity), 0)
  const allMapped = rows.every((r) => !r.supplierProductName || r.productId)  // PDF由来は要マッピング

  async function submitAll() {
    if (validRows.length === 0) { alert("有効な行がありません"); return }
    if (!confirm(`${validRows.length}行を仕入登録します。\n合計仕入額: ${fmtYen(totalAmount)}\nよろしいですか？`)) return

    setSubmitting(true)
    setLogs([])
    setProgress({ done: 0, total: validRows.length })
    const newLogs: string[] = []

    // PDF由来の場合は supplier_invoices にも履歴
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
        const product = products.find((p) => p.id === row.productId)
        if (!product) throw new Error("商品が見つかりません")
        const qty = Number(row.quantity)
        const price = row.unitPrice === "" ? null : Number(row.unitPrice)
        const stockDelta = qty * row.unitQuantityPerPack

        // 商品在庫 + cost 更新
        const productUpdate: { stock: number; cost?: number } = { stock: (product.stock || 0) + stockDelta }
        if (price !== null && updateCost) productUpdate.cost = price

        const { error: pe } = await supabase.from("products").update(productUpdate).eq("id", product.id)
        if (pe) throw new Error(pe.message)

        // stock_receipts insert
        const memoStr = [
          row.memo,
          parsedMeta?.invoice_number ? `伝票:${parsedMeta.invoice_number}` : "",
          row.supplierProductName ? `元:${row.supplierProductName}` : "",
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

        // マッピング学習（PDF由来のみ）
        if (row.supplierProductName && supplierId) {
          if (row.mappingId) {
            await supabase.from("supplier_product_mappings").update({
              product_id: product.id,
              unit_quantity_per_pack: row.unitQuantityPerPack,
              updated_at: new Date().toISOString(),
            }).eq("id", row.mappingId)
          } else {
            await supabase.from("supplier_product_mappings").insert({
              supplier_id: supplierId,
              supplier_jan: row.supplierJan || null,
              supplier_product_code: row.supplierCode || null,
              supplier_product_name: row.supplierProductName,
              product_id: product.id,
              unit_quantity_per_pack: row.unitQuantityPerPack,
            })
          }
        }

        newLogs.push(`✓ ${product.name} +${stockDelta}${row.unitQuantityPerPack !== 1 ? ` (${qty}×${row.unitQuantityPerPack})` : ""}`)
      } catch (e) {
        newLogs.push(`✗ ${row.productName || row.supplierProductName}: ${(e as Error).message}`)
      }
      setProgress({ done: i + 1, total: validRows.length })
      setLogs([...newLogs])
    }

    setSubmitting(false)
    if (newLogs.every((l) => l.startsWith("✓"))) {
      // 成功 → クリア
      setRows(Array.from({ length: INITIAL_ROWS }, newRow))
      setParsedMeta(null)
      setPdfFile(null)
    }
    fetchData()
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-bold text-gray-900">
          仕入入力
          <span className="ml-2 text-xs font-normal text-gray-400">手打ち or PDF読込</span>
        </h1>
      </div>

      {/* 共通設定 */}
      <div className="bg-white rounded-lg p-3" style={{ border: "1px solid #e8eaed" }}>
        <p className="text-xs font-bold text-gray-500 mb-2">① 仕入先 + 入荷日</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
            <option value="">— 仕入先を選択 —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.maker_name ? ` (${s.maker_name})` : ""}</option>)}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        </div>
      </div>

      {/* PDF読込 */}
      <div className="bg-blue-50 rounded-lg p-3" style={{ border: "1px solid #c7d2fe" }}>
        <p className="text-xs font-bold text-blue-900 mb-2">② PDFから自動入力（任意）</p>
        <div className="flex gap-2 items-center flex-wrap">
          <input type="file" accept="application/pdf" onChange={(e) => setPdfFile(e.target.files?.[0] || null)} className="text-xs flex-1 min-w-[200px]" />
          <button onClick={uploadAndParse} disabled={!pdfFile || parsing} className="px-4 py-1.5 bg-blue-600 text-white rounded text-xs font-bold disabled:opacity-50">
            {parsing ? "AI解析中…" : "AI解析して下の表に流し込み"}
          </button>
        </div>
        {parseError && <p className="text-xs text-red-700 mt-1">⚠ {parseError}</p>}
        {parsedMeta && (
          <p className="text-xs text-blue-800 mt-2">
            ✓ 解析成功: {parsedMeta.supplier_name || "—"} / No.{parsedMeta.invoice_number || "—"} / 合計 {parsedMeta.total ? fmtYen(parsedMeta.total) : "—"}
          </p>
        )}
      </div>

      {/* 入力表（手打ち + PDFが流し込まれる） */}
      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0" }}>
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <thead className="sticky top-0 bg-gray-100">
            <tr className="text-[10px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-1.5 py-1.5 text-center w-8">#</th>
              <th className="px-1.5 py-1.5 text-left">自社商品</th>
              <th className="px-1.5 py-1.5 text-left w-40">仕入先 商品名/JAN</th>
              <th className="px-1.5 py-1.5 text-right w-12">数量</th>
              <th className="px-1.5 py-1.5 text-right w-12">×</th>
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
              const matched = !!row.productId
              const isPdfRow = !!row.supplierProductName
              const ng = isPdfRow && !matched
              return (
                <tr key={i} className={"border-b border-gray-100 " + (ng ? "bg-orange-50" : matched ? "bg-emerald-50/30" : "")}>
                  <td className="px-1.5 py-0.5 text-center text-gray-400">{i + 1}</td>
                  <td className="px-1.5 py-0.5">
                    <input
                      list="products-list"
                      value={row.productName}
                      onChange={(e) => onProductNameChange(i, e.target.value)}
                      placeholder="商品名"
                      className="w-full px-1.5 py-0.5 border border-gray-200 rounded text-[11px]"
                    />
                  </td>
                  <td className="px-1.5 py-0.5 text-[10px] text-gray-500">
                    {isPdfRow ? (
                      <>
                        <div className="font-semibold text-gray-700">{row.supplierProductName}</div>
                        <div>{row.supplierJan && `JAN:${row.supplierJan}`} {row.packSize && `/ ${row.packSize}`}</div>
                      </>
                    ) : "—"}
                  </td>
                  <td className="px-1.5 py-0.5">
                    <input type="number" value={row.quantity} onChange={(e) => updateRow(i, { quantity: e.target.value })} className="w-full px-1 py-0.5 border border-gray-200 rounded text-right text-[11px]" />
                  </td>
                  <td className="px-1.5 py-0.5">
                    <input type="number" min={1} value={row.unitQuantityPerPack} onChange={(e) => updateRow(i, { unitQuantityPerPack: Math.max(1, Number(e.target.value) || 1) })} className="w-full px-1 py-0.5 border border-gray-200 rounded text-right text-[11px]" />
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

      {/* datalist */}
      <datalist id="products-list">
        {products.map((p) => <option key={p.id} value={p.name}>{p.product_code || ""} {p.manufacturer || ""}</option>)}
      </datalist>

      {/* アクション */}
      <div className="bg-white rounded-lg p-3 sticky bottom-0" style={{ border: "1px solid #e8eaed" }}>
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
          <button
            onClick={submitAll}
            disabled={submitting || validRows.length === 0 || !allMapped}
            className="px-6 py-3 rounded-lg bg-gray-900 text-white font-bold text-sm disabled:opacity-50"
          >
            {submitting ? `登録中… ${progress.done}/${progress.total}` : `${validRows.length}行 仕入登録`}
          </button>
        </div>
        {!allMapped && (
          <p className="text-[11px] text-orange-700 mt-1">⚠ オレンジ背景の行は自社商品が未選択です（PDF由来）。</p>
        )}
      </div>

      {/* 結果 */}
      {logs.length > 0 && (
        <div className="bg-white rounded-lg p-3" style={{ border: "1px solid #e8eaed" }}>
          <p className="text-xs font-bold text-gray-500 mb-2">登録結果</p>
          <div className="space-y-1 max-h-48 overflow-auto text-[11px]">
            {logs.map((l, i) => <div key={i} className={l.startsWith("✓") ? "text-emerald-700" : "text-red-700"}>{l}</div>)}
          </div>
        </div>
      )}

      {/* 直近履歴 */}
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
