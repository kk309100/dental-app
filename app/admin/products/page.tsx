"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { parseCSV, toCSV, downloadCSV } from "@/lib/csv"
import ProductPriceMatrix from "@/app/components/ProductPriceMatrix"

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
  active?: boolean | null
  location?: string | null
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
  const [expandedPriceId, setExpandedPriceId] = useState<string | null>(null)  // 価格マトリクス展開中の商品ID
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState("")
  const [showInactive, setShowInactive] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { fetchProducts() }, [])

  async function fetchProducts() {
    setLoading(true)
    const { data } = await supabase
      .from("products")
      .select("id,name,product_code,manufacturer,category,stock,reorder_level,cost,price,active,location")
      .order("name", { ascending: true })
      .limit(50000)
    setProducts((data as Product[]) || [])
    setLoading(false)
  }

  async function importProductsCSV(file: File) {
    setImporting(true); setImportMsg("")
    try {
      const text = await file.text()
      const rows = parseCSV(text)
      if (rows.length === 0) { setImportMsg("CSVが空です"); setImporting(false); return }
      const pickKey = (r: Record<string, string>, ...keys: string[]) => {
        for (const k of keys) if (r[k] !== undefined && r[k] !== "") return r[k]
        return ""
      }
      // 既存マスタ（コード優先・名前fallback）
      const byCode = new Map(products.filter(p => p.product_code).map(p => [norm(p.product_code!), p]))
      const byName = new Map(products.map(p => [norm(p.name), p]))

      let created = 0, updated = 0, skipped = 0
      const errors: string[] = []
      for (const r of rows) {
        const name = pickKey(r, "商品名", "name").trim()
        const code = pickKey(r, "商品コード", "コード", "product_code").trim()
        if (!name && !code) { skipped++; continue }
        const payload: Record<string, unknown> = {
          name: name || code,
          product_code: code || null,
          manufacturer: pickKey(r, "メーカー", "manufacturer") || null,
          category: pickKey(r, "カテゴリ", "category") || null,
          cost: Number(pickKey(r, "仕入価格", "原価", "cost").replace(/[¥,]/g, "")) || null,
          price: Number(pickKey(r, "定価", "売価", "price").replace(/[¥,]/g, "")) || null,
          reorder_level: Number(pickKey(r, "発注点", "reorder_level")) || null,
          location: pickKey(r, "棚番号", "ロケーション", "location") || null,
        }
        const existing = (code && byCode.get(norm(code))) || byName.get(norm(name))
        if (existing) {
          const { error } = await supabase.from("products").update(payload).eq("id", existing.id)
          if (error) { errors.push(`${name}: ${error.message}`); continue }
          updated++
        } else {
          const { error } = await supabase.from("products").insert(payload)
          if (error) { errors.push(`${name}: ${error.message}`); continue }
          created++
        }
      }
      let msg = `✅ 取込完了: 新規${created}件 / 更新${updated}件 / スキップ${skipped}件`
      if (errors.length) msg += `\n⚠ エラー${errors.length}件: ${errors.slice(0, 3).join(" / ")}`
      setImportMsg(msg)
      await fetchProducts()
    } catch (e) {
      setImportMsg(`取込失敗: ${(e as Error).message}`)
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  function exportProductsCSV() {
    const csv = toCSV(
      products.map(p => ({
        商品名: p.name,
        商品コード: p.product_code || "",
        メーカー: p.manufacturer || "",
        カテゴリ: p.category || "",
        仕入価格: p.cost || "",
        定価: p.price || "",
        発注点: p.reorder_level || "",
        在庫: p.stock || 0,
        棚番号: p.location || "",
        active: p.active === false ? "0" : "1",
      })),
      ["商品名", "商品コード", "メーカー", "カテゴリ", "仕入価格", "定価", "発注点", "在庫", "棚番号", "active"]
    )
    downloadCSV(`商品マスタ_${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  async function toggleActive(p: Product) {
    const newActive = p.active === false ? true : false
    const { error } = await supabase.from("products").update({ active: newActive }).eq("id", p.id)
    if (error) { alert("更新失敗: " + error.message); return }
    fetchProducts()
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
      if (!showInactive && p.active === false) return false
      if (category !== "すべて" && p.category !== category) return false
      if (m && !norm(p.manufacturer || "").includes(m)) return false
      if (!k) return true
      const target = norm(`${p.name} ${p.product_code || ""} ${p.manufacturer || ""}`)
      return target.includes(k)
    })
  }, [products, search, maker, category, showInactive])

  // 重複検出（同じ商品コード or 同じ名前）
  const duplicates = useMemo(() => {
    const codeMap = new Map<string, number>()
    const nameMap = new Map<string, number>()
    products.forEach(p => {
      if (p.product_code) {
        const k = norm(p.product_code)
        codeMap.set(k, (codeMap.get(k) || 0) + 1)
      }
      const n = norm(p.name)
      if (n) nameMap.set(n, (nameMap.get(n) || 0) + 1)
    })
    const dupCodes = Array.from(codeMap.entries()).filter(([, n]) => n >= 2).length
    const dupNames = Array.from(nameMap.entries()).filter(([, n]) => n >= 2).length
    return { dupCodes, dupNames }
  }, [products])

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
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importProductsCSV(f) }} />
          <button onClick={() => fileRef.current?.click()} disabled={importing}
            className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded hover:bg-gray-50">
            {importing ? "取込中…" : "📥 CSV取込"}
          </button>
          <button onClick={exportProductsCSV}
            className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded hover:bg-gray-50">
            📤 CSV出力
          </button>
        </div>
      </div>

      {importMsg && (
        <div className="text-xs px-3 py-2 rounded whitespace-pre-line"
          style={{ background: importMsg.startsWith("✅") ? "#ecfdf5" : "#fff5f5", color: importMsg.startsWith("✅") ? "#065f46" : "#dc2626", border: "1px solid " + (importMsg.startsWith("✅") ? "#bbf7d0" : "#fcc") }}>
          {importMsg}
        </div>
      )}

      {(duplicates.dupCodes > 0 || duplicates.dupNames > 0) && (
        <div className="text-xs px-3 py-2 rounded bg-amber-50 text-amber-700" style={{ border: "1px solid #fde68a" }}>
          ⚠ 重複検出: 商品コード重複 {duplicates.dupCodes}組 / 商品名重複 {duplicates.dupNames}組
        </div>
      )}

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
        <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer ml-2">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          廃番含む
        </label>
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
              <th className="px-2 py-1.5 text-center w-24" style={td0}>操作</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400">該当商品なし</td></tr>
            ) : pageItems.map((p, i) => (
              <React.Fragment key={p.id}>
              <tr className={"border-b border-gray-100 hover:bg-blue-50/40 " + (i % 2 === 0 ? "" : "bg-gray-50/40")}>
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
                      <button onClick={() => setExpandedPriceId(expandedPriceId === p.id ? null : p.id)}
                        className={"text-[10px] px-1.5 py-0.5 rounded mr-1 " + (expandedPriceId === p.id ? "bg-blue-600 text-white" : "border border-gray-200 hover:bg-blue-50 text-blue-700")}
                        title="仕入先別/医院別の単価を表示">
                        💰
                      </button>
                      <button onClick={() => startEdit(p)} className="text-[10px] px-1.5 py-0.5 border border-gray-200 rounded hover:bg-gray-50 text-gray-600 mr-1">編</button>
                      <button onClick={() => toggleActive(p)}
                        className={"text-[10px] px-1.5 py-0.5 rounded " + (p.active === false ? "bg-gray-200 text-gray-600" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100")}
                        title={p.active === false ? "廃番（クリックで復活）" : "販売中（クリックで廃番）"}>
                        {p.active === false ? "廃" : "活"}
                      </button>
                    </td>
                  </>
                )}
              </tr>
              {expandedPriceId === p.id && (
                <tr>
                  <td colSpan={8} className="p-0">
                    <ProductPriceMatrix
                      productId={p.id}
                      productName={p.name}
                      standardCost={p.cost}
                      standardPrice={p.price}
                    />
                  </td>
                </tr>
              )}
              </React.Fragment>
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
