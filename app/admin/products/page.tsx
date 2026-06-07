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
  const [linking, setLinking] = useState(false)
  const [linkMsg, setLinkMsg] = useState("")
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

  // 半角・全角・記号を除去した正規化（仕入先マッチング用）
  const normS = (v: string) =>
    String(v || "").normalize("NFKC").toLowerCase()
      .replace(/[\s　・\-_\/\(\)（）,.、。]/g, "")

  // purchase_maker → supplier マッチング
  function matchSupplier(purchaseMaker: string): Supplier | null {
    const pm = normS(purchaseMaker)
    if (!pm || pm.length < 1) return null

    // 1. short_name と完全一致
    const byShort = suppliers.find(s => s.short_name && normS(s.short_name) === pm)
    if (byShort) return byShort

    // 2. supplier.name と完全一致
    const byName = suppliers.find(s => normS(s.name) === pm)
    if (byName) return byName

    // 3. supplier.name が purchase_maker で始まる（例: "TP" → "TPオーソドンテックス・ジャパン"）
    if (pm.length >= 2) {
      const byPrefix = suppliers.find(s => normS(s.name).startsWith(pm))
      if (byPrefix) return byPrefix
    }

    // 4. purchase_maker が short_name で始まる（例: "TPオーソ" → "TP"）
    const byShortPrefix = suppliers.find(s => s.short_name && normS(s.short_name).length >= 2 && pm.startsWith(normS(s.short_name)))
    if (byShortPrefix) return byShortPrefix

    // 5. purchase_maker が supplier.name を含む or 逆（部分一致）
    if (pm.length >= 3) {
      const byContain = suppliers.find(s => normS(s.name).includes(pm) || pm.includes(normS(s.name).slice(0, Math.min(normS(s.name).length, pm.length))))
      if (byContain) return byContain
    }

    return null
  }

  async function autoLinkSuppliers() {
    const unlinked = products.filter(p => p.purchase_maker && !p.default_supplier_id)
    if (unlinked.length === 0) { setLinkMsg("⚠ リンク対象の商品がありません（全商品に仕入先が設定済み）"); return }

    // マッチング結果をプレビュー
    const matches: { product: Product; supplier: Supplier }[] = []
    const noMatch: Product[] = []
    for (const p of unlinked) {
      const s = matchSupplier(p.purchase_maker!)
      if (s) matches.push({ product: p, supplier: s })
      else noMatch.push(p)
    }

    if (matches.length === 0) {
      setLinkMsg(`⚠ マッチする仕入先が見つかりませんでした（未リンク: ${unlinked.length}件）`)
      return
    }

    // プレビュー表示して確認
    const preview = matches.slice(0, 5).map(m => `・${m.product.purchase_maker} → ${m.supplier.name}`).join("\n")
    const more = matches.length > 5 ? `\n…他${matches.length - 5}件` : ""
    if (!confirm(`${matches.length}件の商品を仕入先にリンクします。\n\n${preview}${more}\n\nよろしいですか？`)) return

    setLinking(true)
    setLinkMsg("")
    let linked = 0
    for (const { product, supplier } of matches) {
      const { error } = await supabase.from("products")
        .update({ default_supplier_id: supplier.id })
        .eq("id", product.id)
      if (!error) linked++
    }
    setLinkMsg(`✅ ${linked}件をリンクしました${noMatch.length > 0 ? `（未一致: ${noMatch.length}件）` : ""}`)
    setLinking(false)
    await fetchProducts()
  }

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
          <button onClick={autoLinkSuppliers} disabled={linking}
            className="text-sm px-3 py-1.5 rounded font-bold"
            style={{ background: linking ? "#d1fae5" : "#ecfdf5", color: "#065f46", border: "1px solid #a7f3d0", cursor: linking ? "not-allowed" : "pointer" }}
            title="purchase_makerをサプライヤーマスタに全角半角正規化＋前方一致でリンク">
            {linking ? "リンク中…" : "🔗 仕入先を自動リンク"}
          </button>
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

      {linkMsg && (
        <div className="text-xs px-3 py-2 rounded whitespace-pre-line"
          style={{ background: linkMsg.startsWith("✅") ? "#ecfdf5" : "#fff7ed", color: linkMsg.startsWith("✅") ? "#065f46" : "#92400e", border: "1px solid " + (linkMsg.startsWith("✅") ? "#bbf7d0" : "#fed7aa") }}>
          {linkMsg}
        </div>
      )}

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
                        ? (() => {
                            const matched = matchSupplier(p.purchase_maker!)
                            return matched
                              ? <span style={{ color: "#d97706" }} title={`"${p.purchase_maker}"→ 自動リンク候補: ${matched.name}`}>
                                  {p.purchase_maker} <span style={{ fontSize: 10 }}>≈{matched.name.slice(0, 8)}…</span>
                                </span>
                              : <span className="text-gray-400">{p.purchase_maker}</span>
                          })()
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
        <div style={{
          position: "fixed", inset: 0, zIndex: 50,
          background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "16px",
        }} onClick={closeEdit}>
          <div style={{
            background: "#fff", borderRadius: 20,
            boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
            width: "100%", maxWidth: 640,
            display: "flex", flexDirection: "column",
            maxHeight: "90vh", overflow: "hidden",
          }} onClick={e => e.stopPropagation()}>

            {/* ── モーダルヘッダー ── */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 20px",
              borderBottom: "1px solid #f3f4f6",
              background: "#f8fafc", borderRadius: "20px 20px 0 0",
              gap: 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: "#ecfdf5", border: "1.5px solid #a7f3d0",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
                }}>✏️</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>商品編集</div>
                  <div style={{
                    fontSize: 14, fontWeight: 700, color: "#111827",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 360,
                  }}>{editProduct.name}</div>
                </div>
              </div>
              <button onClick={closeEdit} style={{
                background: "#f3f4f6", border: "none", borderRadius: 8,
                width: 32, height: 32, fontSize: 16, color: "#6b7280",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>×</button>
            </div>

            {/* ── スクロールエリア ── */}
            <div style={{ overflowY: "auto", flex: 1 }}>
              <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 16 }}>

                {/* ── 基本情報 ── */}
                <EditSection label="基本情報">
                  <div style={grid1}>
                    <EditField label="商品名" required>
                      <input value={editForm.name || ""} onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                        style={fieldStyle} />
                    </EditField>
                  </div>
                  <div style={grid2}>
                    <EditField label="商品コード">
                      <input value={editForm.product_code || ""} onChange={e => setEditForm({ ...editForm, product_code: e.target.value })}
                        style={{ ...fieldStyle, fontFamily: "monospace" }} />
                    </EditField>
                    <EditField label="カテゴリ">
                      <input value={editForm.category || ""} onChange={e => setEditForm({ ...editForm, category: e.target.value })}
                        style={fieldStyle} />
                    </EditField>
                  </div>
                  <div style={grid1}>
                    <EditField label="メーカー（ブランド名）">
                      <input value={editForm.manufacturer || ""} onChange={e => setEditForm({ ...editForm, manufacturer: e.target.value })}
                        style={fieldStyle} />
                    </EditField>
                  </div>
                </EditSection>

                {/* ── 仕入先 ── */}
                <EditSection label="仕入先">
                  <div style={grid2}>
                    <EditField label="仕入先（マスタ連携）">
                      <select value={editForm.default_supplier_id || ""} onChange={e => setEditForm({ ...editForm, default_supplier_id: e.target.value || null })}
                        style={{ ...fieldStyle, background: "#fff" }}>
                        <option value="">（未設定）</option>
                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </EditField>
                    <EditField label="メーカー略称（CSV用）">
                      <input value={editForm.purchase_maker || ""} onChange={e => setEditForm({ ...editForm, purchase_maker: e.target.value })}
                        style={{ ...fieldStyle, fontFamily: "monospace" }} />
                    </EditField>
                  </div>
                </EditSection>

                {/* ── 価格 ── */}
                <EditSection label="価格">
                  <div style={grid2}>
                    <EditField label="仕入価格（原価）">
                      <div style={{ position: "relative" }}>
                        <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "#9ca3af", pointerEvents: "none" }}>¥</span>
                        <input type="number" value={editForm.cost ?? ""} onChange={e => setEditForm({ ...editForm, cost: Number(e.target.value) || null })}
                          style={{ ...fieldStyle, paddingLeft: 22, textAlign: "right" }} min={0} />
                      </div>
                    </EditField>
                    <EditField label="定価（売価）">
                      <div style={{ position: "relative" }}>
                        <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "#9ca3af", pointerEvents: "none" }}>¥</span>
                        <input type="number" value={editForm.price ?? ""} onChange={e => setEditForm({ ...editForm, price: Number(e.target.value) || null })}
                          style={{ ...fieldStyle, paddingLeft: 22, textAlign: "right" }} min={0} />
                      </div>
                    </EditField>
                  </div>
                  {/* 粗利プレビュー */}
                  {editForm.cost != null && editForm.price != null && editForm.cost > 0 && editForm.price > 0 && (
                    <div style={{ marginTop: 6, padding: "7px 12px", background: "#ecfdf5", borderRadius: 8, fontSize: 12, color: "#065f46", display: "flex", gap: 16 }}>
                      <span>粗利：¥{(Number(editForm.price) - Number(editForm.cost)).toLocaleString()}</span>
                      <span>利益率：{Math.round((1 - Number(editForm.cost) / Number(editForm.price)) * 100)}%</span>
                    </div>
                  )}
                </EditSection>

                {/* ── 在庫管理 ── */}
                <EditSection label="在庫管理">
                  <div style={grid3}>
                    <EditField label="現在在庫数">
                      <input type="number" value={editForm.stock ?? ""} onChange={e => setEditForm({ ...editForm, stock: Number(e.target.value) })}
                        style={{ ...fieldStyle, textAlign: "right" }} min={0} />
                    </EditField>
                    <EditField label="発注点（不足基準）">
                      <input type="number" value={editForm.reorder_level ?? ""} onChange={e => setEditForm({ ...editForm, reorder_level: Number(e.target.value) || null })}
                        style={{ ...fieldStyle, textAlign: "right" }} min={0} />
                    </EditField>
                    <EditField label="棚番号">
                      <input value={editForm.location || ""} onChange={e => setEditForm({ ...editForm, location: e.target.value })}
                        style={{ ...fieldStyle, fontFamily: "monospace" }} placeholder="A1-3" />
                    </EditField>
                  </div>
                </EditSection>

                {/* ── 商品画像 ── */}
                <EditSection label="商品画像">
                  <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                    {/* サムネイル */}
                    <div style={{
                      width: 84, height: 84, flexShrink: 0, borderRadius: 12,
                      background: "#f8fafc", border: "1.5px solid #e5e7eb",
                      overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {editForm.image_url ? (
                        <img src={editForm.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }}
                          onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none" }} />
                      ) : (
                        <span style={{ fontSize: 28, color: "#d1d5db" }}>🖼</span>
                      )}
                    </div>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                      <input ref={imgFileRef} type="file" accept="image/*" style={{ display: "none" }}
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadProductImage(f) }} />
                      <button type="button" onClick={() => imgFileRef.current?.click()} disabled={imageUploading}
                        style={{
                          width: "100%", padding: "9px 12px",
                          border: "2px dashed #a7f3d0", borderRadius: 10,
                          background: imageUploading ? "#f0fdf4" : "#f8fffe",
                          color: "#059669", fontSize: 13, fontWeight: 700,
                          cursor: imageUploading ? "not-allowed" : "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                          opacity: imageUploading ? 0.7 : 1,
                        }}>
                        <span>{imageUploading ? "⏳" : "📷"}</span>
                        {imageUploading ? "アップロード中…" : "写真をアップロード（JPG・PNG・HEIC）"}
                      </button>
                      <input
                        value={editForm.image_url || ""}
                        onChange={e => setEditForm({ ...editForm, image_url: e.target.value })}
                        placeholder="または画像URLを貼り付け（https://...）"
                        style={{ ...fieldStyle, fontSize: 12, color: "#6b7280" }}
                      />
                      {editForm.image_url && (
                        <button type="button" onClick={() => setEditForm({ ...editForm, image_url: "" })}
                          style={{ background: "none", border: "none", fontSize: 12, color: "#ef4444", cursor: "pointer", padding: 0, textAlign: "left", textDecoration: "underline" }}>
                          画像を削除
                        </button>
                      )}
                    </div>
                  </div>
                </EditSection>

                {/* ── ステータス ── */}
                <EditSection label="ステータス">
                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "8px 0" }}>
                    <div style={{
                      width: 44, height: 24, borderRadius: 12,
                      background: editForm.active !== false ? "#059669" : "#d1d5db",
                      position: "relative", transition: "background 0.2s", flexShrink: 0,
                    }}>
                      <div style={{
                        position: "absolute", top: 3,
                        left: editForm.active !== false ? 23 : 3,
                        width: 18, height: 18, borderRadius: "50%",
                        background: "#fff", transition: "left 0.2s",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                      }} />
                      <input type="checkbox" checked={editForm.active !== false}
                        onChange={e => setEditForm({ ...editForm, active: e.target.checked })}
                        style={{ position: "absolute", opacity: 0, width: "100%", height: "100%", cursor: "pointer", margin: 0 }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: editForm.active !== false ? "#059669" : "#6b7280" }}>
                        {editForm.active !== false ? "販売中" : "廃番（非表示）"}
                      </div>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1 }}>
                        {editForm.active !== false ? "医院の注文画面に表示されます" : "注文画面から非表示になります"}
                      </div>
                    </div>
                  </label>
                </EditSection>

              </div>
            </div>

            {/* ── フッター ── */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 20px",
              borderTop: "1px solid #f3f4f6",
              background: "#f8fafc", borderRadius: "0 0 20px 20px",
              gap: 10,
            }}>
              <button onClick={closeEdit} style={{
                padding: "9px 20px", borderRadius: 10,
                border: "1.5px solid #e5e7eb", background: "#fff",
                fontSize: 13, fontWeight: 600, color: "#6b7280", cursor: "pointer",
              }}>
                キャンセル
              </button>
              <button onClick={saveEdit} disabled={saving} style={{
                padding: "9px 28px", borderRadius: 10, border: "none",
                background: saving ? "#a7f3d0" : "#059669",
                color: "#fff", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer",
                boxShadow: saving ? "none" : "0 2px 8px rgba(5,150,105,0.30)",
                transition: "background 0.15s",
              }}>
                {saving ? "保存中…" : "✓ 保存する"}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}

const td0: React.CSSProperties = { borderRight: "1px solid #f0f0f0" }

// ── 編集モーダル用ヘルパー ─────────────────────────────────
const fieldStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px",
  borderRadius: 8, border: "1.5px solid #e5e7eb",
  fontSize: 13, color: "#111827", background: "#fff",
  outline: "none", boxSizing: "border-box",
}
const grid1: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr", gap: 10 }
const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }
const grid3: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }

function EditSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "#fff", borderRadius: 14,
      border: "1.5px solid #f3f4f6",
      overflow: "hidden",
      boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
    }}>
      <div style={{
        padding: "8px 14px", background: "#f8fafc",
        borderBottom: "1px solid #f3f4f6",
        fontSize: 11, fontWeight: 700, color: "#9ca3af",
        letterSpacing: "0.08em", textTransform: "uppercase" as const,
      }}>
        {label}
      </div>
      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {children}
      </div>
    </div>
  )
}

function EditField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>
        {label}{required && <span style={{ color: "#ef4444", marginLeft: 3 }}>*</span>}
      </label>
      {children}
    </div>
  )
}
