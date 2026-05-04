"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"

type Product = {
  id: string
  name: string
  product_code: string | null
  manufacturer: string | null
  category: string | null
  stock: number | null
  reorder_level: number | null
  cost: number | null
  price: number | null
}

const PAGE_SIZE = 100

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [maker, setMaker] = useState("")
  const [category, setCategory] = useState("すべて")
  const [page, setPage] = useState(1)
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<Product>>({})

  useEffect(() => { fetchProducts() }, [])

  async function fetchProducts() {
    setLoading(true)
    const { data } = await supabase
      .from("products")
      .select("id,name,product_code,manufacturer,category,stock,reorder_level,cost,price")
      .order("name", { ascending: true })
    setProducts((data as Product[]) || [])
    setLoading(false)
  }

  const norm = (v: string) => String(v || "").toLowerCase().normalize("NFKC").replace(/\s+/g, "")

  const categories = useMemo(() => {
    const list = products.map((p) => p.category).filter((c): c is string => !!c && c.trim() !== "")
    return ["すべて", ...Array.from(new Set(list))]
  }, [products])

  const filtered = useMemo(() => {
    const k = norm(search)
    const m = norm(maker)
    return products.filter((p) => {
      if (category !== "すべて" && p.category !== category) return false
      if (m && !norm(p.manufacturer || "").includes(m)) return false
      if (!k) return true
      const target = norm(`${p.name} ${p.product_code || ""} ${p.manufacturer || ""}`)
      return target.includes(k)
    })
  }, [products, search, maker, category])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // ページ範囲リセット
  useEffect(() => { if (page > totalPages) setPage(1) }, [totalPages, page])

  function startEdit(p: Product) {
    setEditId(p.id)
    setEditForm({
      name: p.name, product_code: p.product_code || "", manufacturer: p.manufacturer || "",
      category: p.category || "", cost: p.cost, price: p.price,
    })
  }

  async function saveEdit() {
    if (!editId) return
    await supabase.from("products").update(editForm).eq("id", editId)
    setEditId(null)
    fetchProducts()
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  return (
    <div className="space-y-2">
      {/* ヘッダー */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900">
          商品マスタ
          <span className="ml-2 text-xs font-normal text-gray-400">該当 {filtered.length}/全{products.length}件</span>
        </h1>
      </div>

      {/* 検索バー */}
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
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      {/* 密テーブル */}
      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0", maxHeight: "calc(100vh - 240px)" }}>
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-100 text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-2 py-1.5 text-left" style={td0}>商品名</th>
              <th className="px-2 py-1.5 text-left w-24" style={td0}>コード</th>
              <th className="px-2 py-1.5 text-left w-32" style={td0}>メーカー</th>
              <th className="px-2 py-1.5 text-left w-24" style={td0}>カテゴリ</th>
              <th className="px-2 py-1.5 text-right w-16" style={td0}>仕入</th>
              <th className="px-2 py-1.5 text-right w-16" style={td0}>定価</th>
              <th className="px-2 py-1.5 text-right w-12" style={td0}>在庫</th>
              <th className="px-2 py-1.5 text-center w-16" style={td0}>操作</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400">該当商品なし</td></tr>
            ) : pageItems.map((p, i) => (
              <tr key={p.id} className={"border-b border-gray-100 hover:bg-blue-50/40 " + (i % 2 === 0 ? "" : "bg-gray-50/40")}>
                {editId === p.id ? (
                  <>
                    <td className="px-1 py-0.5" style={td0}><input value={editForm.name || ""} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full px-1.5 py-0.5 border border-gray-200 rounded text-xs" /></td>
                    <td className="px-1 py-0.5" style={td0}><input value={editForm.product_code || ""} onChange={(e) => setEditForm({ ...editForm, product_code: e.target.value })} className="w-full px-1.5 py-0.5 border border-gray-200 rounded text-xs" /></td>
                    <td className="px-1 py-0.5" style={td0}><input value={editForm.manufacturer || ""} onChange={(e) => setEditForm({ ...editForm, manufacturer: e.target.value })} className="w-full px-1.5 py-0.5 border border-gray-200 rounded text-xs" /></td>
                    <td className="px-1 py-0.5" style={td0}><input value={editForm.category || ""} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className="w-full px-1.5 py-0.5 border border-gray-200 rounded text-xs" /></td>
                    <td className="px-1 py-0.5" style={td0}><input type="number" value={editForm.cost ?? ""} onChange={(e) => setEditForm({ ...editForm, cost: Number(e.target.value) || null })} className="w-full px-1.5 py-0.5 border border-gray-200 rounded text-xs text-right" /></td>
                    <td className="px-1 py-0.5" style={td0}><input type="number" value={editForm.price ?? ""} onChange={(e) => setEditForm({ ...editForm, price: Number(e.target.value) || null })} className="w-full px-1.5 py-0.5 border border-gray-200 rounded text-xs text-right" /></td>
                    <td className="px-2 py-0.5 text-right text-[11px]" style={td0}>{p.stock ?? 0}</td>
                    <td className="px-1 py-0.5 text-center" style={td0}>
                      <button onClick={saveEdit} className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded mr-1">保存</button>
                      <button onClick={() => setEditId(null)} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">×</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-2 py-1 text-[12px]" style={td0}>{p.name}</td>
                    <td className="px-2 py-1 text-[11px] text-gray-500" style={td0}>{p.product_code || ""}</td>
                    <td className="px-2 py-1 text-[11px] text-gray-600" style={td0}>{p.manufacturer || ""}</td>
                    <td className="px-2 py-1 text-[11px] text-gray-500" style={td0}>{p.category || ""}</td>
                    <td className="px-2 py-1 text-right text-[11px] text-gray-600" style={td0}>{p.cost ? p.cost.toLocaleString() : ""}</td>
                    <td className="px-2 py-1 text-right text-[11px] text-gray-700" style={td0}>{p.price ? p.price.toLocaleString() : ""}</td>
                    <td className="px-2 py-1 text-right text-[11px]" style={td0}>{p.stock ?? 0}</td>
                    <td className="px-1 py-1 text-center" style={td0}>
                      <button onClick={() => startEdit(p)} className="text-[10px] px-2 py-0.5 border border-gray-200 rounded hover:bg-gray-50 text-gray-600">編集</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ページャ */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-2 text-xs">
          <button onClick={() => setPage(1)} disabled={page === 1} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-30">«</button>
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-30">‹</button>
          <span className="px-2 text-gray-500">{page} / {totalPages} ({filtered.length}件)</span>
          <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-30">›</button>
          <button onClick={() => setPage(totalPages)} disabled={page === totalPages} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-30">»</button>
        </div>
      )}
    </div>
  )
}

const td0: React.CSSProperties = { borderRight: "1px solid #f0f0f0" }
