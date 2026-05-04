"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { fmtYen, ymd } from "@/lib/invoice"

type Product = { id: string; name: string; product_code: string | null; manufacturer: string | null; stock: number | null; cost: number | null }
type Supplier = { id: string; name: string; maker_name: string | null }

type Row = {
  productId: string
  productName: string  // 表示用、最終的に productId に解決
  quantity: string
  unitPrice: string
  memo: string
}

const newRow = (): Row => ({ productId: "", productName: "", quantity: "", unitPrice: "", memo: "" })
const INITIAL_ROWS = 10

export default function ReceivingPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [supplierId, setSupplierId] = useState("")
  const [date, setDate] = useState(ymd(new Date()))
  const [rows, setRows] = useState<Row[]>(Array.from({ length: INITIAL_ROWS }, newRow))
  const [updateCost, setUpdateCost] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState<{ ok: boolean; msg: string }[]>([])
  const [recent, setRecent] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [p, s, r] = await Promise.all([
      supabase.from("products").select("id,name,product_code,manufacturer,stock,cost").order("name"),
      supabase.from("suppliers").select("id,name,maker_name").order("name"),
      supabase.from("stock_receipts").select("*").order("created_at", { ascending: false }).limit(20),
    ])
    setProducts((p.data as Product[]) || [])
    setSuppliers((s.data as Supplier[]) || [])
    setRecent(r.data || [])
    setLoading(false)
  }

  // 名前 → product マップ（datalist で選んだ後の解決用）
  const productByName = useMemo(() => new Map(products.map((p) => [p.name, p])), [products])

  function updateRow(i: number, partial: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, ...partial } : r))
  }

  function onProductNameChange(i: number, name: string) {
    const p = productByName.get(name)
    updateRow(i, {
      productName: name,
      productId: p?.id || "",
      // 商品が見つかったら、現在の cost を仕入単価のデフォルトに（空のときのみ）
      ...(p && !rows[i].unitPrice && p.cost ? { unitPrice: String(p.cost) } : {}),
    })
  }

  function addRow() {
    setRows((prev) => [...prev, newRow()])
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i).concat(prev.length === 1 ? [newRow()] : []))
  }

  function clearAll() {
    if (!confirm("入力をすべてクリアしますか？")) return
    setRows(Array.from({ length: INITIAL_ROWS }, newRow))
    setResults([])
  }

  // 有効行（商品名 + 数量 入力済み）
  const validRows = rows.filter((r) => r.productName.trim() && Number(r.quantity) > 0)
  const totalAmount = validRows.reduce((s, r) => s + (Number(r.unitPrice) || 0) * (Number(r.quantity) || 0), 0)
  const allRecognized = validRows.every((r) => productByName.has(r.productName.trim()))

  async function submitAll() {
    if (validRows.length === 0) { alert("有効な行がありません"); return }
    if (!allRecognized) { alert("商品マスタに無い商品名が含まれています。商品検索の候補から選んでください。"); return }

    if (!confirm(`${validRows.length} 行を一括登録します。\n合計仕入額: ${fmtYen(totalAmount)}\nよろしいですか？`)) return

    setSubmitting(true)
    setResults([])
    setProgress({ done: 0, total: validRows.length })
    const newResults: typeof results = []

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i]
      try {
        const product = productByName.get(row.productName.trim())!
        const qty = Number(row.quantity)
        const price = row.unitPrice === "" ? null : Number(row.unitPrice)

        // 1) products の在庫（と必要なら cost）更新
        const productUpdate: { stock: number; cost?: number } = { stock: Number(product.stock || 0) + qty }
        if (price !== null && updateCost) productUpdate.cost = price

        const { error: pe } = await supabase.from("products").update(productUpdate).eq("id", product.id)
        if (pe) throw new Error(pe.message)

        // 2) stock_receipts に履歴 insert
        const { error: re } = await supabase.from("stock_receipts").insert({
          product_id: product.id,
          quantity: qty,
          memo: row.memo || null,
          supplier_id: supplierId || null,
          unit_price: price,
        })
        if (re) throw new Error(re.message)

        newResults.push({ ok: true, msg: `✓ ${product.name} +${qty}${price !== null ? ` @${fmtYen(price)}` : ""}` })
      } catch (e) {
        newResults.push({ ok: false, msg: `✗ ${row.productName}: ${(e as Error).message}` })
      }
      setProgress({ done: i + 1, total: validRows.length })
      setResults([...newResults])
    }

    setSubmitting(false)
    // 成功した行を消去
    if (newResults.every((r) => r.ok)) {
      setRows(Array.from({ length: INITIAL_ROWS }, newRow))
    }
    fetchData()
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  return (
    <div className="space-y-5">
      {/* タイトル */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">仕入入力（一括）</h1>
        <p className="text-xs text-gray-400 mt-0.5">表に複数行入力して一度に登録できます</p>
      </div>

      {/* 共通設定 */}
      <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #e8eaed" }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-semibold">仕入先（共通、任意）</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              <option value="">— 仕入先を選択 —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.maker_name ? ` (${s.maker_name})` : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-semibold">入荷日</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
          </div>
        </div>
        <label className="flex items-center gap-2 mt-3 text-xs text-gray-600">
          <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} />
          単価を入力した行については、商品マスタの仕入価格 (cost) も更新する
        </label>
      </div>

      {/* 表 */}
      <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #e8eaed" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 900 }}>
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-2 py-2 text-center w-10">#</th>
                <th className="px-3 py-2 text-left">商品名（候補から選択）</th>
                <th className="px-2 py-2 text-right w-20">数量</th>
                <th className="px-2 py-2 text-right w-28">仕入単価</th>
                <th className="px-2 py-2 text-right w-28">小計</th>
                <th className="px-3 py-2 text-left">メモ</th>
                <th className="px-2 py-2 text-center w-10"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const matched = productByName.get(row.productName.trim())
                const subtotal = Number(row.unitPrice || 0) * Number(row.quantity || 0)
                const ng = row.productName.trim() && !matched
                return (
                  <tr key={i} className={"border-t border-gray-100 " + (ng ? "bg-red-50" : matched ? "bg-emerald-50/30" : "")}>
                    <td className="px-2 py-1.5 text-center text-xs text-gray-400">{i + 1}</td>
                    <td className="px-2 py-1.5">
                      <input
                        list="products-list"
                        value={row.productName}
                        onChange={(e) => onProductNameChange(i, e.target.value)}
                        placeholder="商品名を入力 or 候補から選択"
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:border-blue-400"
                      />
                      {matched && (
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          コード:{matched.product_code || "—"} / 在庫:{matched.stock ?? 0} / 現単価:{matched.cost ? fmtYen(matched.cost) : "—"}
                        </p>
                      )}
                      {ng && <p className="text-[10px] text-red-600 mt-0.5">⚠ 商品マスタに無い名前です</p>}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        value={row.quantity}
                        onChange={(e) => updateRow(i, { quantity: e.target.value })}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm text-right focus:outline-none focus:border-blue-400"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        value={row.unitPrice}
                        onChange={(e) => updateRow(i, { unitPrice: e.target.value })}
                        placeholder="¥"
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm text-right focus:outline-none focus:border-blue-400"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right text-sm font-bold text-gray-700">
                      {subtotal > 0 ? fmtYen(subtotal) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={row.memo}
                        onChange={(e) => updateRow(i, { memo: e.target.value })}
                        placeholder="伝票No 等"
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:border-blue-400"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button onClick={() => removeRow(i)} className="text-red-500 hover:text-red-700 text-lg leading-none">×</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t-2 border-gray-200">
                <td colSpan={4} className="px-3 py-3 text-right text-sm font-bold text-gray-700">合計</td>
                <td className="px-2 py-3 text-right text-base font-bold text-gray-900">{fmtYen(totalAmount)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* datalist (HTML5 autocomplete) */}
      <datalist id="products-list">
        {products.map((p) => (
          <option key={p.id} value={p.name}>{p.product_code || ""} {p.manufacturer || ""}</option>
        ))}
      </datalist>

      {/* アクション */}
      <div className="bg-white rounded-xl p-4 sticky bottom-0" style={{ border: "1px solid #e8eaed" }}>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={addRow} className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 text-sm">
            ＋ 行を追加
          </button>
          <button onClick={clearAll} className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 text-sm">
            クリア
          </button>
          <div className="flex-1 text-xs text-gray-500 text-right">
            有効: <strong className="text-gray-900">{validRows.length}行</strong> / 合計: <strong className="text-gray-900">{fmtYen(totalAmount)}</strong>
          </div>
          <button
            onClick={submitAll}
            disabled={submitting || validRows.length === 0 || !allRecognized}
            className="px-6 py-3 rounded-lg bg-gray-900 text-white font-bold text-sm hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? `登録中… ${progress.done}/${progress.total}` : `${validRows.length}行 一括登録`}
          </button>
        </div>
      </div>

      {/* 結果 */}
      {results.length > 0 && (
        <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #e8eaed" }}>
          <p className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-widest">登録結果</p>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {results.map((r, i) => (
              <p key={i} className={"text-xs py-1 px-2 rounded " + (r.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
                {r.msg}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* 直近入荷履歴 */}
      <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #e8eaed" }}>
        <p className="text-sm font-bold text-gray-700 mb-3">直近の入荷履歴（最新20件）</p>
        {recent.length === 0 ? (
          <p className="text-xs text-gray-400">履歴なし</p>
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {recent.map((rc) => {
              const product = products.find((p) => p.id === rc.product_id)
              const supplier = suppliers.find((s) => s.id === rc.supplier_id)
              return (
                <div key={rc.id} className="flex items-center justify-between py-1.5 px-2 text-xs border-b border-gray-100">
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-gray-700">{product?.name || "—"}</span>
                    <span className="text-gray-400 ml-2">{new Date(rc.created_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    {supplier && <span className="text-gray-400 ml-2">/ {supplier.name}</span>}
                  </div>
                  <div className="flex items-center gap-3 text-right shrink-0">
                    {rc.unit_price && <span className="text-gray-500">@{fmtYen(rc.unit_price)}</span>}
                    <span className="font-bold text-gray-900 w-12">+{rc.quantity}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
