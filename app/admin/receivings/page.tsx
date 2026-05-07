"use client"

// 仕入納品一覧（過去の入荷履歴）
// データソース: stock_receipts
// - サブタブ: 一覧 / 日付別 / 仕入先別 / 商品別
// - ソート: 日付順 / 仕入先順 / 商品順 / 金額順
// - フィルタ: 期間 / 仕入先 / 商品名

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { GroupViewTabs, useGroupView, type GroupableRow } from "@/app/components/GroupViewTabs"
import { downloadCSV, toCSV } from "@/lib/csv"

type Receipt = {
  id: string
  product_id: string | null
  supplier_id: string | null
  quantity: number
  unit_price: number | null
  memo: string | null
  created_at: string
  supplier_invoice_item_id?: string | null
}
type Supplier = { id: string; name: string }
type Product = { id: string; name: string; product_code: string | null; manufacturer: string | null; category: string | null }

type SortKey = "date_desc" | "date_asc" | "supplier_asc" | "product_asc" | "amount_desc" | "amount_asc"

export default function ReceivingsListPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState("")
  const [supplierFilter, setSupplierFilter] = useState<string>("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [sortBy, setSortBy] = useState<SortKey>("date_desc")
  const [groupView, setGroupView] = useGroupView()

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [r, s, p] = await Promise.all([
      supabase.from("stock_receipts").select("*").order("created_at", { ascending: false }).limit(50000),
      supabase.from("suppliers").select("id,name").order("name").limit(50000),
      supabase.from("products").select("id,name,product_code,manufacturer,category").limit(50000),
    ])
    setReceipts((r.data as Receipt[]) || [])
    setSuppliers((s.data as Supplier[]) || [])
    setProducts((p.data as Product[]) || [])
    setLoading(false)
  }

  const supplierMap = useMemo(() => new Map(suppliers.map(s => [s.id, s])), [suppliers])
  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const supplierName = (id: string | null) => id ? (supplierMap.get(id)?.name || "(削除済み)") : "(未指定)"
  const productName = (id: string | null) => id ? (productMap.get(id)?.name || "(削除済み)") : "(未指定)"

  const norm = (v: string) => String(v || "").toLowerCase().normalize("NFKC")

  const filtered = useMemo(() => {
    const k = norm(search)
    return receipts.filter(r => {
      if (supplierFilter !== "all" && r.supplier_id !== supplierFilter) return false
      const d = r.created_at.slice(0, 10)
      if (from && d < from) return false
      if (to && d > to) return false
      if (!k) return true
      const target = norm(`${productName(r.product_id)} ${supplierName(r.supplier_id)} ${r.memo || ""}`)
      return target.includes(k)
    })
  }, [receipts, supplierFilter, from, to, search, suppliers, products])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      const aDate = a.created_at, bDate = b.created_at
      const aSup = supplierName(a.supplier_id), bSup = supplierName(b.supplier_id)
      const aProd = productName(a.product_id), bProd = productName(b.product_id)
      const aAmt = Number(a.unit_price || 0) * Number(a.quantity)
      const bAmt = Number(b.unit_price || 0) * Number(b.quantity)
      switch (sortBy) {
        case "date_desc": return bDate.localeCompare(aDate)
        case "date_asc": return aDate.localeCompare(bDate)
        case "supplier_asc": return aSup.localeCompare(bSup, "ja") || bDate.localeCompare(aDate)
        case "product_asc": return aProd.localeCompare(bProd, "ja") || bDate.localeCompare(aDate)
        case "amount_desc": return bAmt - aAmt
        case "amount_asc": return aAmt - bAmt
      }
    })
    return arr
  }, [filtered, sortBy, suppliers, products])

  // 集計
  const totals = useMemo(() => {
    const totalAmount = filtered.reduce((s, r) => s + Number(r.unit_price || 0) * Number(r.quantity), 0)
    return { count: filtered.length, totalAmount }
  }, [filtered])

  // GroupViewTabs 用の行データ
  const groupRows: GroupableRow[] = useMemo(() => sorted.map(r => ({
    id: r.id,
    date: r.created_at.slice(0, 10),
    party: supplierName(r.supplier_id),
    amount: Number(r.unit_price || 0) * Number(r.quantity),
    items: [{
      name: productName(r.product_id),
      quantity: Number(r.quantity),
      price: Number(r.unit_price || 0),
    }],
  })), [sorted, suppliers, products])

  function exportCSV() {
    const csv = toCSV(
      sorted.map(r => {
        const p = r.product_id ? productMap.get(r.product_id) : null
        return {
          入荷日: r.created_at.slice(0, 10),
          仕入先: supplierName(r.supplier_id),
          商品コード: p?.product_code || "",
          商品名: productName(r.product_id),
          メーカー: p?.manufacturer || "",
          数量: r.quantity,
          単価: r.unit_price || 0,
          金額: Number(r.unit_price || 0) * Number(r.quantity),
          メモ: r.memo || "",
        }
      }),
      ["入荷日", "仕入先", "商品コード", "商品名", "メーカー", "数量", "単価", "金額", "メモ"]
    )
    downloadCSV(`仕入納品一覧_${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  if (loading) return <p className="text-center py-12 text-gray-400">読み込み中…</p>

  return (
    <div className="space-y-2">
      {/* ヘッダ */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900">
          📋 仕入納品一覧
          <span className="ml-2 text-xs font-normal text-gray-400">
            該当 {totals.count} 件 ・ 合計 {fmtYen(totals.totalAmount)}
          </span>
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={exportCSV}
            className="px-3 py-1.5 bg-white border border-gray-200 rounded text-xs hover:bg-gray-50">📤 CSV出力</button>
          <Link href="/admin/receiving"
            className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded hover:bg-emerald-700">
            ＋ 入荷登録（手打ち or PDF読込）
          </Link>
          <Link href="/admin/supplier-invoices"
            className="px-3 py-1.5 bg-purple-100 text-purple-700 text-xs font-bold rounded hover:bg-purple-200">
            🔍 月次請求書付け合わせ
          </Link>
        </div>
      </div>

      {/* フィルタ */}
      <div className="flex gap-1.5 items-center bg-gray-50 p-2 rounded-lg flex-wrap" style={{ border: "1px solid #e8eaed" }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="商品名・仕入先・メモで検索"
          className="flex-1 min-w-[180px] px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}
          className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white max-w-[200px]">
          <option value="all">全仕入先</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <span className="text-xs text-gray-400">〜</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <select value={sortBy} onChange={e => setSortBy(e.target.value as SortKey)}
          className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="date_desc">📅 日付 新→古</option>
          <option value="date_asc">📅 日付 古→新</option>
          <option value="supplier_asc">🏭 仕入先順</option>
          <option value="product_asc">📦 商品順</option>
          <option value="amount_desc">💰 金額 大→小</option>
          <option value="amount_asc">💰 金額 小→大</option>
        </select>
      </div>

      {/* サブタブ + 一覧 */}
      <GroupViewTabs value={groupView} onChange={setGroupView} rows={groupRows} partyLabel="仕入先">
        <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0", maxHeight: "calc(100vh - 280px)" }}>
          <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
            <thead className="sticky top-0 bg-gray-100">
              <tr className="text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
                <th className="px-2 py-1.5 text-center w-24">入荷日</th>
                <th className="px-2 py-1.5 text-left w-40">仕入先</th>
                <th className="px-2 py-1.5 text-left w-24">商品コード</th>
                <th className="px-2 py-1.5 text-left">商品名</th>
                <th className="px-2 py-1.5 text-left w-28">メーカー</th>
                <th className="px-2 py-1.5 text-right w-14">数量</th>
                <th className="px-2 py-1.5 text-right w-20">単価</th>
                <th className="px-2 py-1.5 text-right w-24">金額</th>
                <th className="px-2 py-1.5 text-left w-32">メモ</th>
                <th className="px-2 py-1.5 text-center w-16">付け合わせ</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400">該当する入荷記録なし</td></tr>
              ) : sorted.map((r, i) => {
                const p = r.product_id ? productMap.get(r.product_id) : null
                const amount = Number(r.unit_price || 0) * Number(r.quantity)
                const matched = !!r.supplier_invoice_item_id
                return (
                  <tr key={r.id} className={"border-b border-gray-100 hover:bg-blue-50/40 " + (i % 2 === 0 ? "" : "bg-gray-50/30")}>
                    <td className="px-2 py-1.5 text-center text-[11px] text-gray-700">
                      {new Date(r.created_at).toLocaleDateString("ja-JP", { year: "2-digit", month: "2-digit", day: "2-digit" })}
                    </td>
                    <td className="px-2 py-1.5 text-[11px]">{supplierName(r.supplier_id)}</td>
                    <td className="px-2 py-1.5 text-[10px] text-gray-500 font-mono">{p?.product_code || "—"}</td>
                    <td className="px-2 py-1.5">{productName(r.product_id)}</td>
                    <td className="px-2 py-1.5 text-[10px] text-gray-500">{p?.manufacturer || "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.quantity}</td>
                    <td className="px-2 py-1.5 text-right text-[11px] text-gray-600 tabular-nums">{fmtYen(r.unit_price || 0)}</td>
                    <td className="px-2 py-1.5 text-right text-[12px] font-bold tabular-nums">{fmtYen(amount)}</td>
                    <td className="px-2 py-1.5 text-[10px] text-gray-500">{r.memo || ""}</td>
                    <td className="px-2 py-1.5 text-center">
                      {matched ? (
                        <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">✅</span>
                      ) : (
                        <span className="text-[10px] text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-gray-50 sticky bottom-0">
              <tr className="border-t-2 border-gray-300">
                <td colSpan={7} className="px-2 py-2 text-right text-xs font-bold text-gray-700">合計</td>
                <td className="px-2 py-2 text-right text-base font-bold text-gray-900 tabular-nums">{fmtYen(totals.totalAmount)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </GroupViewTabs>
    </div>
  )
}
