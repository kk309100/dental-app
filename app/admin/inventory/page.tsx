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
  category: string | null
  location?: string | null
}

export default function InventoryPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [maker, setMaker] = useState("")
  const [filter, setFilter] = useState<"all" | "low" | "zero">("all")
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data } = await supabase
      .from("products")
      .select("id,name,product_code,manufacturer,stock,reorder_level,cost,price,category,location")
      .order("name", { ascending: true })
      .limit(50000)
    setProducts((data as Product[]) || [])
    setLoading(false)
  }

  const isLow = (p: Product) => (p.stock ?? 0) <= (p.reorder_level ?? 10)
  const norm = (v: string) => String(v || "").toLowerCase().normalize("NFKC").replace(/\s+/g, "")

  const filtered = useMemo(() => {
    const k = norm(search)
    const m = norm(maker)
    return products.filter((p) => {
      if (filter === "low" && !isLow(p)) return false
      if (filter === "zero" && (p.stock ?? 0) > 0) return false
      if (m && !norm(p.manufacturer || "").includes(m)) return false
      if (!k) return true
      const target = norm(`${p.name} ${p.product_code || ""} ${p.manufacturer || ""}`)
      return target.includes(k)
    })
  }, [products, search, maker, filter])

  const lowCount = products.filter(isLow).length
  const zeroCount = products.filter((p) => (p.stock ?? 0) === 0).length

  async function updateStock(id: string, value: string) {
    const stock = Number(value)
    if (Number.isNaN(stock) || stock < 0) { alert("正しい在庫数"); return }
    const before = products.find(p => p.id === id)?.stock ?? 0
    if (stock === before) return
    setSavingId(id)
    await supabase.from("products").update({ stock }).eq("id", id)
    // 移動履歴を記録（テーブル無くても黙って続行）
    try {
      await supabase.from("stock_movements").insert({
        product_id: id,
        movement_type: "棚卸調整",
        quantity: stock - before,
        before_stock: before,
        after_stock: stock,
        ref_type: "manual",
        reason: "在庫画面で手動調整",
      })
    } catch { /* テーブル無い場合はスキップ */ }
    setSavingId(null)
    fetchData()
  }

  async function updateLocation(id: string, value: string) {
    setSavingId(id)
    await supabase.from("products").update({ location: value || null }).eq("id", id)
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
    <div className="space-y-2">
      {/* ヘッダー（コンパクト） */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900">
          在庫管理
          <span className="ml-2 text-xs font-normal text-gray-400">該当 {filtered.length}/全{products.length}件 ・ 不足 {lowCount} ・ 0個 {zeroCount}</span>
        </h1>
      </div>

      {/* 検索バー（１行に圧縮） */}
      <div className="flex gap-1.5 items-center bg-gray-50 p-2 rounded-lg" style={{ border: "1px solid #e8eaed" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="商品名・コード"
          className="flex-1 min-w-[160px] px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white"
        />
        <input
          value={maker}
          onChange={(e) => setMaker(e.target.value)}
          placeholder="メーカー"
          className="w-32 px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white"
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value as "all" | "low" | "zero")} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="all">すべて</option>
          <option value="low">在庫不足のみ</option>
          <option value="zero">在庫0のみ</option>
        </select>
      </div>

      {/* 密なテーブル（画面いっぱい） */}
      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0", maxHeight: "calc(100vh - 200px)" }}>
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-100 text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-2 py-1.5 text-left w-16" style={td0}>棚</th>
              <th className="px-2 py-1.5 text-left" style={td0}>商品名</th>
              <th className="px-2 py-1.5 text-left w-24" style={td0}>コード</th>
              <th className="px-2 py-1.5 text-left w-32" style={td0}>メーカー</th>
              <th className="px-2 py-1.5 text-left w-24" style={td0}>カテゴリ</th>
              <th className="px-2 py-1.5 text-right w-16" style={td0}>仕入</th>
              <th className="px-2 py-1.5 text-right w-16" style={td0}>定価</th>
              <th className="px-2 py-1.5 text-right w-16" style={td0}>在庫</th>
              <th className="px-2 py-1.5 text-right w-16" style={td0}>発注基準</th>
              <th className="px-2 py-1.5 text-center w-14" style={td0}>状態</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-6 text-center text-gray-400">該当商品なし</td></tr>
            ) : filtered.map((p, i) => {
              const low = isLow(p)
              const zero = (p.stock ?? 0) === 0
              return (
                <tr key={p.id} className={"border-b border-gray-100 hover:bg-blue-50/40 " + (i % 2 === 0 ? "" : "bg-gray-50/40") + (savingId === p.id ? " opacity-50" : "")}>
                  <td className="px-1 py-0.5" style={td0}>
                    <input
                      defaultValue={p.location || ""}
                      placeholder="A1-3"
                      onBlur={(e) => { if (e.target.value !== (p.location || "")) updateLocation(p.id, e.target.value) }}
                      className="w-14 px-1 py-0.5 border border-gray-200 rounded text-[11px] font-mono text-gray-700"
                    />
                  </td>
                  <td className="px-2 py-1 text-[12px]" style={td0}>{p.name}</td>
                  <td className="px-2 py-1 text-[11px] text-gray-500" style={td0}>{p.product_code || ""}</td>
                  <td className="px-2 py-1 text-[11px] text-gray-600" style={td0}>{p.manufacturer || ""}</td>
                  <td className="px-2 py-1 text-[11px] text-gray-500" style={td0}>{p.category || ""}</td>
                  <td className="px-2 py-1 text-right text-[11px] text-gray-600" style={td0}>{p.cost ? p.cost.toLocaleString() : ""}</td>
                  <td className="px-2 py-1 text-right text-[11px] text-gray-700" style={td0}>{p.price ? p.price.toLocaleString() : ""}</td>
                  <td className="px-1 py-0.5 text-right" style={td0}>
                    <input
                      type="number"
                      defaultValue={p.stock ?? 0}
                      onBlur={(e) => { if (Number(e.target.value) !== (p.stock ?? 0)) updateStock(p.id, e.target.value) }}
                      className="w-12 px-1 py-0.5 border border-gray-200 rounded text-right text-xs"
                    />
                  </td>
                  <td className="px-1 py-0.5 text-right" style={td0}>
                    <input
                      type="number"
                      defaultValue={p.reorder_level ?? 10}
                      onBlur={(e) => { if (Number(e.target.value) !== (p.reorder_level ?? 10)) updateReorderLevel(p.id, e.target.value) }}
                      className="w-10 px-1 py-0.5 border border-gray-200 rounded text-right text-xs"
                    />
                  </td>
                  <td className="px-1 py-1 text-center" style={td0}>
                    {zero ? <span className="text-[10px] font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">0</span> :
                     low ? <span className="text-[10px] font-bold text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded">不足</span> :
                     <span className="text-[10px] text-green-700">OK</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const td0: React.CSSProperties = { borderRight: "1px solid #f0f0f0" }
