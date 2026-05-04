"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"

type Product = {
  id: string
  name: string
  product_code: string | null
  manufacturer: string | null
  stock: number | null
  reorder_level: number | null
  cost: number | null
  price: number | null
}

export default function InventoryPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | "low" | "zero">("all")
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data } = await supabase
      .from("products")
      .select("id,name,product_code,manufacturer,stock,reorder_level,cost,price")
      .order("name", { ascending: true })
    setProducts((data as Product[]) || [])
    setLoading(false)
  }

  function isLow(p: Product) {
    return (p.stock ?? 0) <= (p.reorder_level ?? 10)
  }

  const filtered = useMemo(() => {
    const k = search.toLowerCase().normalize("NFKC")
    return products.filter((p) => {
      if (filter === "low" && !isLow(p)) return false
      if (filter === "zero" && (p.stock ?? 0) > 0) return false
      if (!k) return true
      const target = `${p.name} ${p.product_code || ""} ${p.manufacturer || ""}`.toLowerCase().normalize("NFKC")
      return target.includes(k)
    })
  }, [products, search, filter])

  const lowCount = products.filter(isLow).length
  const zeroCount = products.filter((p) => (p.stock ?? 0) === 0).length

  async function updateStock(id: string, value: string) {
    const stock = Number(value)
    if (Number.isNaN(stock) || stock < 0) { alert("正しい在庫数"); return }
    setSavingId(id)
    const { error } = await supabase.from("products").update({ stock }).eq("id", id)
    if (error) alert("更新失敗: " + error.message)
    setSavingId(null)
    fetchData()
  }

  async function updateReorderLevel(id: string, value: string) {
    const level = Number(value)
    if (Number.isNaN(level) || level < 0) return
    setSavingId(id)
    await supabase.from("products").update({ reorder_level: level }).eq("id", id)
    setSavingId(null)
    fetchData()
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  return (
    <div className="space-y-5">
      {/* タイトル */}
      <div className="flex items-center gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">在庫管理</h1>
          <p className="text-xs text-gray-400 mt-0.5">{products.length}品 ・ 在庫不足 {lowCount}品 ・ 在庫0 {zeroCount}品</p>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="登録商品" val={`${products.length}品`} sub="" />
        <Kpi label="在庫不足" val={`${lowCount}品`} sub="発注基準以下" color={lowCount > 0 ? "#dc2626" : "#10b981"} />
        <Kpi label="在庫切れ" val={`${zeroCount}品`} sub="0個" color={zeroCount > 0 ? "#d97706" : "#10b981"} />
      </div>

      {/* フィルタ */}
      <div className="flex gap-2 flex-wrap items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="商品名・コード・メーカーで検索"
          className="flex-1 min-w-[200px] px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value as "all" | "low" | "zero")} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
          <option value="all">すべて ({products.length})</option>
          <option value="low">在庫不足のみ ({lowCount})</option>
          <option value="zero">在庫0のみ ({zeroCount})</option>
        </select>
      </div>

      {/* テーブル */}
      <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #e8eaed" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 800 }}>
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider border-b border-gray-100">
                <th className="px-3 py-2 text-left">商品名</th>
                <th className="px-3 py-2 text-left hidden md:table-cell">コード</th>
                <th className="px-3 py-2 text-left hidden md:table-cell">メーカー</th>
                <th className="px-3 py-2 text-right">在庫</th>
                <th className="px-3 py-2 text-right">発注基準</th>
                <th className="px-3 py-2 text-center">状態</th>
                <th className="px-3 py-2 text-right hidden lg:table-cell">仕入</th>
                <th className="px-3 py-2 text-right hidden lg:table-cell">販売</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">該当商品なし</td></tr>
              ) : filtered.slice(0, 200).map((p, i) => {
                const low = isLow(p)
                const zero = (p.stock ?? 0) === 0
                return (
                  <tr key={p.id} className={"border-t border-gray-50 hover:bg-blue-50/20 " + (i % 2 === 0 ? "" : "bg-gray-50/30") + (savingId === p.id ? " opacity-50" : "")}>
                    <td className="px-3 py-2 font-medium text-gray-900">{p.name}</td>
                    <td className="px-3 py-2 text-xs text-gray-500 hidden md:table-cell">{p.product_code || "—"}</td>
                    <td className="px-3 py-2 text-xs text-gray-500 hidden md:table-cell">{p.manufacturer || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        defaultValue={p.stock ?? 0}
                        onBlur={(e) => { if (Number(e.target.value) !== (p.stock ?? 0)) updateStock(p.id, e.target.value) }}
                        className="w-16 px-1 py-1 border border-gray-200 rounded text-right text-sm focus:outline-none focus:border-blue-400"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        defaultValue={p.reorder_level ?? 10}
                        onBlur={(e) => { if (Number(e.target.value) !== (p.reorder_level ?? 10)) updateReorderLevel(p.id, e.target.value) }}
                        className="w-14 px-1 py-1 border border-gray-200 rounded text-right text-sm focus:outline-none focus:border-blue-400"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      {zero ? <Badge color="red">在庫0</Badge> : low ? <Badge color="orange">不足</Badge> : <Badge color="green">OK</Badge>}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-gray-600 hidden lg:table-cell">{p.cost ? fmtYen(p.cost) : "—"}</td>
                    <td className="px-3 py-2 text-right text-xs text-gray-600 hidden lg:table-cell">{p.price ? fmtYen(p.price) : "—"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {filtered.length > 200 && (
          <p className="px-4 py-3 text-xs text-gray-500 text-center bg-gray-50 border-t border-gray-100">
            表示 200/{filtered.length}件 ・ 検索で絞り込んでください
          </p>
        )}
      </div>
    </div>
  )
}

function Kpi({ label, val, sub, color = "#111" }: { label: string; val: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl p-3 sm:p-4" style={{ border: "1px solid #e8eaed" }}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-bold" style={{ color }}>{val}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function Badge({ children, color }: { children: React.ReactNode; color: "red" | "orange" | "green" }) {
  const styles = {
    red: { bg: "#fef2f2", text: "#dc2626", border: "#fecaca" },
    orange: { bg: "#fef3c7", text: "#d97706", border: "#fcd34d" },
    green: { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" },
  }
  const s = styles[color]
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}` }}>
      {children}
    </span>
  )
}
