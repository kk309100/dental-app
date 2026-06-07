"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { supabase, fetchAll } from "@/lib/supabase"
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
  purchase_maker?: string | null
  default_supplier_id?: string | null
  image_url?: string | null
}

type Supplier = { id: string; name: string; short_name: string | null }

const PAGE_SIZE = 100

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [maker, setMaker] = useState("")
  const [category, setCategory] = useState("すべて")
  const [supplierFilter, setSupplierFilter] = useState("すべて")
  const [page, setPage] = useState(1)
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [editForm, setEditForm] = useState<Partial<Product>>({})
  const [expandedPriceId, setExpandedPriceId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState("")
  const [showInactive, setShowInactive] = useState(false)
  const [saving, setSaving] = useState(false)
  const [imageUploading, setImageUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const imgFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { fetchProducts(); fetchSuppliers() }, [])

  async function fetchProducts() {
    setLoading(true)
    const data = await fetchAll(
      "products",
      "id,name,product_code,manufacturer,category,stock,reorder_level,cost,price,active,location,purchase_maker,default_supplier_id,image_url",
      (q) => q.order("name", { ascending: true })
    )
    setProducts((data as Product[]) || [])
    setLoading(false)
  }

  async function fetchSuppliers() {
    const { data } = await supabase.from("suppliers").select("id,name,short_name").order("name").limit(1000)
    setSuppliers((data as Supplier[]) || [])
  }

  function openEdit(p: Product) {
    setEditProduct(p)
    setEditForm({ ...p })
  }

  function closeEdit() { setEditProduct(null); setEditForm({}) }

  async function saveEdit() {
    if (!editProduct) return
    setSaving(true)
    const payload: Record<string, unknown> = {
      name: editForm.name || editProduct.name,
      product_code: editForm.product_code || null,
      manufacturer: editForm.manufacturer || null,
      category: editForm.category || null,
      cost: editForm.cost != null ? Number(editForm.cost) || null : null,
      price: editForm.price != null ? Number(editForm.price) || null : null,
      stock: editForm.stock != null ? Number(editForm.stock) : null,
      reorder_level: editForm.reorder_level != null ? Number(editForm.reorder_level) || null : null,
      location: editForm.location || null,
      purchase_maker: editForm.purchase_maker || null,
      default_supplier_id: editForm.default_supplier_id || null,
      active: editForm.active !== false,
      image_url: editForm.image_url !== undefined ? (editForm.image_url || null) : editProduct.image_url,
    }
    const { error } = await supabase.from("products").update(payload).eq("id", editProduct.id)
    if (error) { alert("保存失敗: " + error.message); setSaving(false); return }
    setSaving(false)
    closeEdit()
    fetchProducts()
  }

  async function uploadProductImage(file: File) {
    if (!editProduct) return
    setImageUploading(true)
    try {
      // canvas でJPEG変換（HEIC・PNG・WebP対応）
      const jpeg = await new Promise<Blob>((resolve, reject) => {
        const url = URL.createObjectURL(file)
        const img = new Image()
        img.onload = () => {
          const MAX = 1600
          let w = img.naturalWidth, h = img.naturalHeight
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * MAX / w); w = MAX }
            else { w = Math.round(w * MAX / h); h = MAX }
          }
          const canvas = document.createElement("canvas")
          canvas.width = w; canvas.height = h
          const ctx = canvas.getContext("2d")
          if (!ctx) { URL.revokeObjectURL(url); reject(new Error("canvas取得失敗")); return }
          ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h)
          ctx.drawImage(img, 0, 0, w, h)
          URL.revokeObjectURL(url)
          canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("JPEG変換失敗")), "image/jpeg", 0.85)
        }
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("画像読み込み失敗")) }
        img.src = url
      })
      const form = new FormData()
      form.append("file", jpeg, `${editProduct.id}.jpg`)
      form.append("productId", editProduct.id)
      const res = await fetch("/api/admin/upload-product-image", { method: "POST", body: form })
      const json = await res.json()
      if (!res.ok) { alert(`アップロード失敗: ${json.error ?? res.statusText}`); return }
      setEditForm(f => ({ ...f, image_url: json.publicUrl }))
    } catch (e) {
      alert(`画像変換失敗: ${(e as Error).message}`)
    } finally {
      setImageUploading(false)
      if (imgFileRef.current) imgFileRef.current.value = ""
    }
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
          purchase_maker: pickKey(r, "ﾒｰｶｰ", "仕入れメーカー", "purchase_maker") || null,
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
        ﾒｰｶｰ: p.purchase_maker || "",
        active: p.active === false ? "0" : "1",
      })),
      ["商品名", "商品コード", "メーカー", "カテゴリ", "仕入価格", "定価", "発注点", "在庫", "棚番号", "ﾒｰｶｰ", "active"]
    )
    downloadCSV(`商品マスタ_${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  async function toggleActive(p: Product) {
    const newActive = p.active === false ? true : false
    await supabase.from("products").update({ active: newActive }).eq("id", p.id)
    fetchProducts()
  }

  const norm = (v: string) => String(v || "").toLowerCase().normalize("NFKC").replace(/\s+/g, "")

  const supplierName = (id: string | null | undefined) =>
    id ? suppliers.find(s => s.id === id)?.name || "" : ""

  const categories = useMemo(() => {
    const list = products.map((p) => p.category).filter((c): c is string => !!c && c.trim() !== "")
    return ["すべて", ...Array.from(new Set(list))]
  }, [products])

  const supplierOptions = useMemo(() => {
    const names = Array.from(new Set(
      products.map(p => p.default_supplier_id ? supplierName(p.default_supplier_id) : "").filter(Boolean)
    ))
    return ["すべて", "(未設定)", ...names]
  }, [products, suppliers])

  const filtered = useMemo(() => {
    const k = norm(search)
    const m = norm(maker)
    return products.filter((p) => {
      if (!showInactive && p.active === false) return false
      if (category !== "すべて" && p.category !== category) return false
      if (supplierFilter === "(未設定)" && p.default_supplier_id) return false
      if (supplierFilter !== "すべて" && supplierFilter !== "(未設定)") {
        if (supplierName(p.default_supplier_id) !== supplierFilter) return false
      }
      if (m && !norm(p.manufacturer || "").includes(m)) return false
      if (!k) return true
      const target = norm(`${p.name} ${p.product_code || ""} ${p.manufacturer || ""} ${p.purchase_maker || ""}`)
      return target.includes(k)
    })
  }, [products, search, maker, category, supplierFilter, showInactive, suppliers])

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

  useEffect(() => { if (page > totalPages) setPage(1) }, [totalPages, page])

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  return (
    <div className="space-y-2">
      {/* ヘッダー */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900" style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: 0 }}>
          商品マスタ
          <span className="ml-2 text-xs font-normal text-gray-400">該当 {filtered.length}/全{products.length}件</span>
        </h1>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importProductsCSV(f) }} />
          <button onClick={() => fileRef.current?.click()} disabled={importing}
            className="text-sm px-3 py-1.5 bg-white border border-gray-200 rounded hover:bg-gray-50">
            {importing ? "取込中…" : "📥 CSV取込"}
          </button>
          <button onClick={exportProductsCSV}
            className="text-sm px-3 py-1.5 bg-white border border-gray-200 rounded hover:bg-gray-50">
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
      <div className="flex gap-1.5 items-center bg-gray-50 p-2 rounded-lg flex-wrap" style={{ border: "1px solid #e8eaed" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="商品名・コード・ﾒｰｶｰ"
          className="flex-1 min-w-[160px] px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <input value={maker} onChange={(e) => setMaker(e.target.value)} placeholder="メーカー"
          className="w-28 px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white max-w-[180px]">
          {supplierOptions.map((s) => <option key={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          廃番含む
        </label>
      </div>

      {/* テーブル */}
      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0", maxHeight: "calc(100vh - 240px)" }}>
        <table className="w-full" style={{ borderCollapse: "collapse", fontSize: 13 }}>
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-100 text-[12px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-2 py-1.5 text-left" style={td0}>商品名</th>
              <th className="px-2 py-1.5 text-left w-24" style={td0}>コード</th>
              <th className="px-2 py-1.5 text-left w-28" style={td0}>メーカー</th>
              <th className="px-2 py-1.5 text-left w-24" style={td0}>カテゴリ</th>
              <th className="px-2 py-1.5 text-left w-28" style={td0}>仕入先</th>
              <th className="px-2 py-1.5 text-right w-14" style={td0}>仕入</th>
              <th className="px-2 py-1.5 text-right w-14" style={td0}>定価</th>
              <th className="px-2 py-1.5 text-right w-12" style={td0}>在庫</th>
              <th className="px-2 py-1.5 text-right w-12" style={td0}>発注点</th>
              <th className="px-2 py-1.5 text-left w-14" style={td0}>棚</th>
              <th className="px-2 py-1.5 text-center w-24" style={td0}>操作</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr><td colSpan={11} className="px-4 py-6 text-center text-gray-400">該当商品なし</td></tr>
            ) : pageItems.map((p, i) => (
              <React.Fragment key={p.id}>
                <tr className={"border-b border-gray-100 hover:bg-blue-50/40 " + (i % 2 === 0 ? "" : "bg-gray-50/40") + (p.active === false ? " opacity-40" : "")}>
                  <td className="px-2 py-1 text-[12px]" style={td0}>{p.name}</td>
                  <td className="px-2 py-1 text-[12px] text-gray-500 font-mono" style={td0}>{p.product_code || ""}</td>
                  <td className="px-2 py-1 text-[12px] text-gray-600" style={td0}>{p.manufacturer || ""}</td>
                  <td className="px-2 py-1 text-[12px] text-gray-500" style={td0}>{p.category || ""}</td>
                  <td className="px-2 py-1 text-[12px]" style={td0}>
                    {p.default_supplier_id
                      ? <span className="text-blue-700">{supplierName(p.default_supplier_id)}</span>
                      : p.purchase_maker
                        ? <span className="text-gray-400">{p.purchase_maker}</span>
                        : ""}
                  </td>
                  <td className="px-2 py-1 text-right text-[12px] text-gray-600" style={td0}>{p.cost ? p.cost.toLocaleString() : ""}</td>
                  <td className="px-2 py-1 text-right text-[12px] text-gray-700" style={td0}>{p.price ? p.price.toLocaleString() : ""}</td>
                  <td className={"px-2 py-1 text-right text-[12px] font-bold " + ((p.stock ?? 0) <= 0 ? "text-red-600" : (p.stock ?? 0) <= (p.reorder_level ?? 10) ? "text-orange-600" : "text-gray-700")} style={td0}>
                    {p.stock ?? 0}
                  </td>
                  <td className="px-2 py-1 text-right text-[12px] text-gray-400" style={td0}>{p.reorder_level ?? ""}</td>
                  <td className="px-2 py-1 text-[12px] text-gray-500 font-mono" style={td0}>{p.location || ""}</td>
                  <td className="px-1 py-1 text-center" style={td0}>
                    <button onClick={() => setExpandedPriceId(expandedPriceId === p.id ? null : p.id)}
                      className={"text-[11px] px-1.5 py-0.5 rounded mr-1 " + (expandedPriceId === p.id ? "bg-blue-600 text-white" : "border border-gray-200 hover:bg-blue-50 text-blue-700")}
                      title="仕入先別単価">💰</button>
                    <button onClick={() => openEdit(p)}
                      className="text-[11px] px-1.5 py-0.5 border border-gray-200 rounded hover:bg-gray-50 text-gray-600 mr-1">編集</button>
                    <button onClick={() => toggleActive(p)}
                      className={"text-[11px] px-1.5 py-0.5 rounded " + (p.active === false ? "bg-gray-200 text-gray-600" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100")}
                      title={p.active === false ? "廃番（クリックで復活）" : "販売中（クリックで廃番）"}>
                      {p.active === false ? "廃" : "活"}
                    </button>
                  </td>
                </tr>
                {expandedPriceId === p.id && (
                  <tr>
                    <td colSpan={11} className="p-0">
                      <ProductPriceMatrix productId={p.id} productName={p.name} standardCost={p.cost} standardPrice={p.price} />
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

      {/* 編集モーダル */}
      {editProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeEdit}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* モーダルヘッダー */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50">
              <h2 className="text-sm font-bold text-gray-800">商品編集</h2>
              <button onClick={closeEdit} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
            </div>

            <div className="overflow-y-auto" style={{ maxHeight: "75vh" }}>
              <div className="p-5 space-y-4">

                {/* 基本情報 */}
                <section>
                  <h3 className="text-[12px] font-bold text-gray-400 uppercase tracking-widest mb-2">基本情報</h3>
                  <div className="grid grid-cols-1 gap-2.5">
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5" style={{ fontSize: 13 }}>商品名 <span className="text-red-500">*</span></label>
                      <input value={editForm.name || ""} onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                        className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-600 mb-0.5" style={{ fontSize: 13 }}>商品コード</label>
                        <input value={editForm.product_code || ""} onChange={e => setEditForm({ ...editForm, product_code: e.target.value })}
                          className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm font-mono" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-0.5" style={{ fontSize: 13 }}>カテゴリ</label>
                        <input value={editForm.category || ""} onChange={e => setEditForm({ ...editForm, category: e.target.value })}
                          className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5" style={{ fontSize: 13 }}>メーカー（ブランド名）</label>
                      <input value={editForm.manufacturer || ""} onChange={e => setEditForm({ ...editForm, manufacturer: e.target.value })}
                        className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm" />
                    </div>
                  </div>
                </section>

                {/* 仕入先 */}
                <section>
                  <h3 className="text-[12px] font-bold text-gray-400 uppercase tracking-widest mb-2">仕入先</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5" style={{ fontSize: 13 }}>仕入先（マスタ連携）</label>
                      <select value={editForm.default_supplier_id || ""} onChange={e => setEditForm({ ...editForm, default_supplier_id: e.target.value || null })}
                        className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white">
                        <option value="">（未設定）</option>
                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5" style={{ fontSize: 13 }}>ﾒｰｶｰ略称（CSV用）</label>
                      <input value={editForm.purchase_maker || ""} onChange={e => setEditForm({ ...editForm, purchase_maker: e.target.value })}
                        className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm font-mono" />
                    </div>
                  </div>
                </section>

                {/* 価格 */}
                <section>
                  <h3 className="text-[12px] font-bold text-gray-400 uppercase tracking-widest mb-2">価格</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5" style={{ fontSize: 13 }}>仕入価格（原価）</label>
                      <input type="number" value={editForm.cost ?? ""} onChange={e => setEditForm({ ...editForm, cost: Number(e.target.value) || null })}
                        className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm text-right" min={0} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5" style={{ fontSize: 13 }}>定価（売価）</label>
                      <input type="number" value={editForm.price ?? ""} onChange={e => setEditForm({ ...editForm, price: Number(e.target.value) || null })}
                        className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm text-right" min={0} />
                    </div>
                  </div>
                </section>

                {/* 在庫管理 */}
                <section>
                  <h3 className="text-[12px] font-bold text-gray-400 uppercase tracking-widest mb-2">在庫管理</h3>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5" style={{ fontSize: 13 }}>現在在庫数</label>
                      <input type="number" value={editForm.stock ?? ""} onChange={e => setEditForm({ ...editForm, stock: Number(e.target.value) })}
                        className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm text-right" min={0} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5" style={{ fontSize: 13 }}>発注点（不足基準）</label>
                      <input type="number" value={editForm.reorder_level ?? ""} onChange={e => setEditForm({ ...editForm, reorder_level: Number(e.target.value) || null })}
                        className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm text-right" min={0} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5" style={{ fontSize: 13 }}>棚番号（置き場所）</label>
                      <input value={editForm.location || ""} onChange={e => setEditForm({ ...editForm, location: e.target.value })}
                        className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm font-mono" placeholder="A1-3" />
                    </div>
                  </div>
                </section>

                {/* 商品画像 */}
                <section>
                  <h3 className="text-[12px] font-bold text-gray-400 uppercase tracking-widest mb-2">商品画像</h3>
                  <div className="flex gap-3 items-start">
                    {/* サムネイル */}
                    <div className="w-20 h-20 flex-shrink-0 bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center border border-gray-200">
                      {editForm.image_url ? (
                        <img src={editForm.image_url} alt="" className="w-full h-full object-contain"
                          onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none" }} />
                      ) : (
                        <span className="text-2xl text-gray-300">🖼</span>
                      )}
                    </div>
                    <div className="flex-1 space-y-2">
                      {/* ファイルアップロード */}
                      <input ref={imgFileRef} type="file" accept="image/*" style={{ display: "none" }}
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadProductImage(f) }} />
                      <button type="button" onClick={() => imgFileRef.current?.click()} disabled={imageUploading}
                        className="w-full text-sm px-3 py-1.5 border-2 border-dashed border-blue-300 rounded text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50">
                        {imageUploading ? "アップロード中…" : "📷 写真をアップロード（JPG・PNG・HEIC）"}
                      </button>
                      {/* URL直入力 */}
                      <input
                        value={editForm.image_url || ""}
                        onChange={e => setEditForm({ ...editForm, image_url: e.target.value })}
                        placeholder="または画像URLを貼り付け（https://...）"
                        className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-xs text-gray-600"
                      />
                      {editForm.image_url && (
                        <button type="button" onClick={() => setEditForm({ ...editForm, image_url: "" })}
                          className="text-xs text-red-500 hover:text-red-700 underline">
                          画像を削除
                        </button>
                      )}
                    </div>
                  </div>
                </section>

                {/* ステータス */}
                <section>
                  <h3 className="text-[12px] font-bold text-gray-400 uppercase tracking-widest mb-2">ステータス</h3>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={editForm.active !== false}
                      onChange={e => setEditForm({ ...editForm, active: e.target.checked })}
                      className="w-4 h-4" />
                    <span className="text-sm text-gray-700">販売中（チェックを外すと廃番）</span>
                  </label>
                </section>
              </div>
            </div>

            {/* フッター */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50">
              <button onClick={closeEdit} className="text-sm px-4 py-2 border border-gray-200 rounded hover:bg-gray-100 text-gray-600">
                キャンセル
              </button>
              <button onClick={saveEdit} disabled={saving}
                className="text-sm px-6 py-2 bg-blue-600 text-white font-bold rounded hover:bg-blue-700 disabled:opacity-50">
                {saving ? "保存中…" : "保存する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const td0: React.CSSProperties = { borderRight: "1px solid #f0f0f0" }
