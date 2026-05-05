"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { downloadCSV, toCSV } from "@/lib/csv"

type Product = {
  id: string
  name: string
  product_code: string | null
  manufacturer: string | null
  category: string | null
  stock: number | null
  cost: number | null
  price: number | null
  active?: boolean | null
  location?: string | null
}

export default function InventoryValuationPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [groupBy, setGroupBy] = useState<"none" | "category" | "manufacturer">("none")

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data } = await supabase.from("products").select("*").or("active.is.null,active.eq.true")
    setProducts((data as Product[]) || [])
    setLoading(false)
  }

  const enriched = useMemo(() => products.map(p => {
    const stock = Number(p.stock || 0)
    const cost = Number(p.cost || 0)
    const price = Number(p.price || 0)
    const valueAtCost = stock * cost
    const valueAtRetail = stock * price
    const potentialProfit = valueAtRetail - valueAtCost
    return { ...p, stock, cost, price, valueAtCost, valueAtRetail, potentialProfit }
  }), [products])

  const filtered = useMemo(() => enriched.filter(p => {
    if (!search) return true
    const k = search.toLowerCase().normalize("NFKC")
    const target = `${p.name} ${p.product_code || ""} ${p.manufacturer || ""} ${p.category || ""}`.toLowerCase().normalize("NFKC")
    return target.includes(k)
  }), [enriched, search])

  const totals = useMemo(() => filtered.reduce(
    (s, p) => ({
      stock: s.stock + p.stock,
      valueAtCost: s.valueAtCost + p.valueAtCost,
      valueAtRetail: s.valueAtRetail + p.valueAtRetail,
      profit: s.profit + p.potentialProfit,
    }),
    { stock: 0, valueAtCost: 0, valueAtRetail: 0, profit: 0 }
  ), [filtered])

  // グループ集計
  const groups = useMemo(() => {
    if (groupBy === "none") return null
    const m = new Map<string, { name: string; stock: number; valueAtCost: number; valueAtRetail: number; itemCount: number }>()
    filtered.forEach(p => {
      const key = (groupBy === "category" ? p.category : p.manufacturer) || "(未分類)"
      const e = m.get(key) || { name: key, stock: 0, valueAtCost: 0, valueAtRetail: 0, itemCount: 0 }
      e.stock += p.stock
      e.valueAtCost += p.valueAtCost
      e.valueAtRetail += p.valueAtRetail
      e.itemCount += 1
      m.set(key, e)
    })
    return Array.from(m.values()).sort((a, b) => b.valueAtCost - a.valueAtCost)
  }, [filtered, groupBy])

  function exportCSV() {
    const csv = toCSV(filtered.map(p => ({
      商品名: p.name,
      商品コード: p.product_code || "",
      メーカー: p.manufacturer || "",
      カテゴリ: p.category || "",
      在庫数: p.stock,
      仕入単価: p.cost,
      定価: p.price,
      在庫評価額_原価: p.valueAtCost,
      在庫評価額_定価: p.valueAtRetail,
      含み益: p.potentialProfit,
    })))
    downloadCSV(`在庫評価_${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900">
          在庫評価
          <span className="ml-2 text-xs font-normal text-gray-400">原価ベースの在庫資産評価額（経理視点）</span>
        </h1>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KPI label="在庫商品数" value={filtered.length} unit="種" />
        <KPI label="在庫数合計" value={totals.stock} unit="個" />
        <KPI label="在庫評価額（原価）" amount={totals.valueAtCost} highlight color="#3b82f6" />
        <KPI label="想定売上額（定価）" amount={totals.valueAtRetail} color="#10b981" />
      </div>

      <div className="flex gap-1.5 items-center bg-gray-50 p-2 rounded-lg flex-wrap" style={{ border: "1px solid #e8eaed" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="商品名・コード・メーカー"
          className="flex-1 min-w-[180px] px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <select value={groupBy} onChange={e => setGroupBy(e.target.value as typeof groupBy)}
          className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="none">明細表示</option>
          <option value="category">カテゴリ別集計</option>
          <option value="manufacturer">メーカー別集計</option>
        </select>
        <button onClick={exportCSV} className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded hover:bg-gray-50">📤 CSV</button>
      </div>

      {groups ? (
        <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0" }}>
          <table className="w-full text-xs">
            <thead className="bg-gray-100">
              <tr className="text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
                <th className="px-3 py-1.5 text-left">{groupBy === "category" ? "カテゴリ" : "メーカー"}</th>
                <th className="px-2 py-1.5 text-right w-20">商品数</th>
                <th className="px-2 py-1.5 text-right w-20">在庫数</th>
                <th className="px-2 py-1.5 text-right w-32">原価評価額</th>
                <th className="px-2 py-1.5 text-right w-32">定価評価額</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.name} className="border-b border-gray-100 hover:bg-blue-50/40">
                  <td className="px-3 py-1.5 font-bold">{g.name}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{g.itemCount}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{g.stock}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-bold text-blue-700">{fmtYen(g.valueAtCost)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">{fmtYen(g.valueAtRetail)}</td>
                </tr>
              ))}
              <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold">
                <td className="px-3 py-2">合計</td>
                <td className="px-2 py-2 text-right tabular-nums">{filtered.length}</td>
                <td className="px-2 py-2 text-right tabular-nums">{totals.stock}</td>
                <td className="px-2 py-2 text-right tabular-nums text-blue-700">{fmtYen(totals.valueAtCost)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-emerald-700">{fmtYen(totals.valueAtRetail)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0", maxHeight: "calc(100vh - 280px)" }}>
          <table className="w-full text-xs">
            <thead className="bg-gray-100 sticky top-0">
              <tr className="text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
                <th className="px-2 py-1.5 text-left">商品名</th>
                <th className="px-2 py-1.5 text-left w-32">メーカー</th>
                <th className="px-2 py-1.5 text-right w-16">在庫</th>
                <th className="px-2 py-1.5 text-right w-20">仕入</th>
                <th className="px-2 py-1.5 text-right w-20">定価</th>
                <th className="px-2 py-1.5 text-right w-28">原価評価</th>
                <th className="px-2 py-1.5 text-right w-28">定価評価</th>
                <th className="px-2 py-1.5 text-right w-28">含み益</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="border-b border-gray-100 hover:bg-blue-50/40">
                  <td className="px-2 py-1">{p.name}</td>
                  <td className="px-2 py-1 text-gray-500">{p.manufacturer || ""}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{p.stock}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{p.cost > 0 ? fmtYen(p.cost) : "—"}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{p.price > 0 ? fmtYen(p.price) : "—"}</td>
                  <td className="px-2 py-1 text-right tabular-nums font-bold text-blue-700">{fmtYen(p.valueAtCost)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-emerald-700">{fmtYen(p.valueAtRetail)}</td>
                  <td className={"px-2 py-1 text-right tabular-nums font-bold " + (p.potentialProfit >= 0 ? "text-emerald-700" : "text-red-600")}>{fmtYen(p.potentialProfit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function KPI({ label, value, amount, unit, color = "#374151", highlight = false }: { label: string; value?: number; amount?: number; unit?: string; color?: string; highlight?: boolean }) {
  return (
    <div className="bg-white rounded p-3" style={{ border: "1px solid #e8eaed" }}>
      <p className="text-[10px] text-gray-500 font-bold">{label}</p>
      <p className={"tabular-nums mt-1 " + (highlight ? "text-xl font-bold" : "text-base font-bold")} style={{ color }}>
        {amount !== undefined ? fmtYen(amount) : `${(value || 0).toLocaleString()}${unit || ""}`}
      </p>
    </div>
  )
}
