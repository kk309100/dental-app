"use client"

import { useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import Barcode from "react-barcode"
import { Html5Qrcode } from "html5-qrcode"
import { useRouter } from "next/navigation"

type Item = {
  id: string
  product_name: string
  maker: string | null
  barcode: string | null
  stock_quantity: number
  min_stock: number | null
  category: string | null
  shelf_no: string | null
}

type EditForm = {
  product_name: string
  maker: string
  category: string
  shelf_no: string
  min_stock: string
  stock_quantity: string
  barcode: string
}

type CartEntry = {
  item: Item
  change: number  // 負=使用、正=補充
}

const emptyForm: EditForm = {
  product_name: "", maker: "", category: "", shelf_no: "", min_stock: "", stock_quantity: "0", barcode: "",
}

export default function ClinicInventoryPage() {
  const router = useRouter()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm>(emptyForm)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState<EditForm>(emptyForm)
  const [addSaving, setAddSaving] = useState(false)
  const [barcodeItem, setBarcodeItem] = useState<Item | null>(null)
  const [groupByShelf, setGroupByShelf] = useState(false)
  const [collapsedShelves, setCollapsedShelves] = useState<Set<string>>(new Set())
  // バーコード選択印刷
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // スキャン（ハイライト用）
  const [scanning, setScanning] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({})
  // スキャンカート
  const [cartMode, setCartMode] = useState(false)
  const [cartScanning, setCartScanning] = useState(false)
  const [cart, setCart] = useState<CartEntry[]>([])
  const [showCart, setShowCart] = useState(false)
  const [cartToast, setCartToast] = useState<string | null>(null)
  const [applyingCart, setApplyingCart] = useState(false)
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null)
  const cartScannerRef = useRef<Html5Qrcode | null>(null)
  // 印刷
  const barcodeRef = useRef<HTMLDivElement>(null)
  const bulkBarcodeRef = useRef<HTMLDivElement>(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data } = await supabase
      .from("clinic_inventory_items")
      .select("id,product_name,maker,barcode,stock_quantity,min_stock,category,shelf_no")
      .order("product_name", { ascending: true })
    setItems((data as Item[]) || [])
    setLoading(false)
  }

  const norm = (v: string) => String(v || "").toLowerCase().normalize("NFKC").replace(/\s+/g, "")

  const filtered = items.filter((item) => {
    if (!search) return true
    const k = norm(search)
    return (
      norm(item.product_name).includes(k) ||
      norm(item.barcode || "").includes(k) ||
      norm(item.maker || "").includes(k) ||
      norm(item.category || "").includes(k) ||
      norm(item.shelf_no || "").includes(k)
    )
  })

  const groupedByShelves: { shelf: string; items: Item[] }[] = (() => {
    const map = new Map<string, Item[]>()
    for (const item of filtered) {
      const key = item.shelf_no?.trim() || "棚未設定"
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(item)
    }
    const entries = Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "棚未設定") return 1
      if (b === "棚未設定") return -1
      return a.localeCompare(b, "ja")
    })
    return entries.map(([shelf, items]) => ({ shelf, items }))
  })()

  function toggleShelf(shelf: string) {
    setCollapsedShelves((prev) => {
      const next = new Set(prev)
      next.has(shelf) ? next.delete(shelf) : next.add(shelf)
      return next
    })
  }

  async function changeQty(id: string, delta: number) {
    const item = items.find((i) => i.id === id)
    if (!item) return
    const newQty = Math.max(0, item.stock_quantity + delta)
    setProcessingId(id)
    const { error } = await supabase.from("clinic_inventory_items").update({ stock_quantity: newQty }).eq("id", id)
    setProcessingId(null)
    if (error) { alert("エラー: " + error.message); return }
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, stock_quantity: newQty } : i))
  }

  function startEdit(item: Item) {
    setEditId(item.id)
    setEditForm({
      product_name: item.product_name,
      maker: item.maker || "",
      category: item.category || "",
      shelf_no: item.shelf_no || "",
      min_stock: item.min_stock !== null ? String(item.min_stock) : "",
      stock_quantity: String(item.stock_quantity),
      barcode: item.barcode || "",
    })
  }

  async function saveEdit() {
    if (!editId) return
    setProcessingId(editId)
    const updates = {
      product_name: editForm.product_name.trim(),
      maker: editForm.maker.trim() || null,
      category: editForm.category.trim() || null,
      shelf_no: editForm.shelf_no.trim() || null,
      min_stock: editForm.min_stock !== "" ? Number(editForm.min_stock) : null,
      stock_quantity: Number(editForm.stock_quantity) || 0,
      barcode: editForm.barcode.trim() || null,
    }
    const { error } = await supabase.from("clinic_inventory_items").update(updates).eq("id", editId)
    setProcessingId(null)
    if (error) { alert("保存エラー: " + error.message); return }
    setItems((prev) => prev.map((i) => i.id === editId ? { ...i, ...updates } : i))
    setEditId(null)
  }

  async function addItem() {
    if (!addForm.product_name.trim()) { alert("商品名を入力してください"); return }
    setAddSaving(true)
    const row = {
      product_name: addForm.product_name.trim(),
      maker: addForm.maker.trim() || null,
      category: addForm.category.trim() || null,
      shelf_no: addForm.shelf_no.trim() || null,
      min_stock: addForm.min_stock !== "" ? Number(addForm.min_stock) : null,
      stock_quantity: Number(addForm.stock_quantity) || 0,
      barcode: addForm.barcode.trim() || null,
    }
    const { error } = await supabase.from("clinic_inventory_items").insert(row)
    setAddSaving(false)
    if (error) { alert("追加エラー: " + error.message); return }
    setShowAddModal(false)
    setAddForm(emptyForm)
    fetchData()
  }

  // ── 通常スキャン（ハイライト） ──
  async function startScan() {
    setScanning(true)
    const scanner = new Html5Qrcode("inv-reader")
    try {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 220 },
        async (code) => {
          await scanner.stop()
          setScanning(false)
          const found = items.find((i) => String(i.barcode || "") === code)
          if (found) {
            setSearch("")
            setHighlightId(found.id)
            setTimeout(() => { itemRefs.current[found.id]?.scrollIntoView({ behavior: "smooth", block: "center" }) }, 100)
            setTimeout(() => setHighlightId(null), 3000)
          } else {
            alert(`商品が見つかりません\n（${code}）`)
          }
        },
        () => {}
      )
    } catch {
      setScanning(false)
      alert("カメラの起動に失敗しました。カメラへのアクセスを許可してください。")
    }
  }

  // ── スキャンカート ──
  async function startCartScan() {
    setCartScanning(true)
    setUnknownBarcode(null)
    const scanner = new Html5Qrcode("cart-reader")
    cartScannerRef.current = scanner
    try {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 220 },
        async (code) => {
          await scanner.stop()
          cartScannerRef.current = null
          setCartScanning(false)
          const found = items.find((i) => String(i.barcode || "") === code)
          if (found) {
            setCart((prev) => {
              const existing = prev.find((e) => e.item.id === found.id)
              if (existing) {
                return prev.map((e) => e.item.id === found.id ? { ...e, change: e.change - 1 } : e)
              }
              return [...prev, { item: found, change: -1 }]
            })
            setCartToast(found.product_name)
            setTimeout(() => setCartToast(null), 2000)
          } else {
            setUnknownBarcode(code)
          }
        },
        () => {}
      )
    } catch {
      setCartScanning(false)
      alert("カメラの起動に失敗しました。")
    }
  }

  async function stopCartScan() {
    try { await cartScannerRef.current?.stop() } catch { /* ignore */ }
    cartScannerRef.current = null
    setCartScanning(false)
  }

  function enterCartMode() {
    setCartMode(true)
    setCart([])
    setShowCart(false)
  }

  function exitCartMode() {
    stopCartScan()
    setCartMode(false)
    setCart([])
    setShowCart(false)
    setUnknownBarcode(null)
  }

  function cartChangeQty(id: string, delta: number) {
    setCart((prev) => prev.map((e) => e.item.id === id ? { ...e, change: e.change + delta } : e))
  }

  function cartSetChange(id: string, val: string) {
    const n = parseInt(val, 10)
    if (isNaN(n)) return
    setCart((prev) => prev.map((e) => e.item.id === id ? { ...e, change: n } : e))
  }

  function removeFromCart(id: string) {
    setCart((prev) => prev.filter((e) => e.item.id !== id))
  }

  async function applyCart() {
    if (cart.length === 0) return
    setApplyingCart(true)
    for (const entry of cart) {
      const newQty = Math.max(0, entry.item.stock_quantity + entry.change)
      await supabase.from("clinic_inventory_items").update({ stock_quantity: newQty }).eq("id", entry.item.id)
    }
    setApplyingCart(false)
    setShowCart(false)
    setCart([])
    await fetchData()
    alert("在庫を更新しました")
  }

  // ── バーコード印刷 ──
  function toggleSelect(id: string, hasBarcode: boolean) {
    if (!hasBarcode) return
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function exitSelectMode() { setSelectMode(false); setSelectedIds(new Set()) }
  function selectAllWithBarcode() { setSelectedIds(new Set(filtered.filter((i) => i.barcode).map((i) => i.id))) }

  function doPrintSingle() {
    const content = barcodeRef.current
    if (!content) return
    const w = window.open("", "_blank", "width=400,height=300")
    if (!w) return
    w.document.write(`<html><head><title>バーコード印刷</title>
      <style>body{margin:20px;font-family:sans-serif;text-align:center}svg{max-width:100%}</style>
      </head><body><div>${content.innerHTML}</div></body></html>`)
    w.document.close(); w.focus(); w.print(); w.close()
  }

  function doPrintBulk() {
    const content = bulkBarcodeRef.current
    if (!content) return
    const w = window.open("", "_blank", "width=700,height=600")
    if (!w) return
    w.document.write(`<html><head><title>バーコード一括印刷</title>
      <style>body{margin:16px;font-family:sans-serif}.grid{display:flex;flex-wrap:wrap;gap:12px}
      .cell{border:1px solid #ddd;padding:8px 12px;border-radius:6px;text-align:center;break-inside:avoid}
      .name{font-size:11px;font-weight:bold;margin-bottom:4px}svg{max-width:100%}
      @media print{@page{margin:10mm}}</style>
      </head><body><div class="grid">${content.innerHTML}</div></body></html>`)
    w.document.close(); w.focus(); w.print(); w.close()
  }

  const isLow = (item: Item) => item.stock_quantity <= (item.min_stock ?? 0)

  function renderItemCard(item: Item) {
    const low = isLow(item)
    const busy = processingId === item.id
    const isEditing = editId === item.id
    const hasBarcode = !!item.barcode
    const isSelected = selectedIds.has(item.id)
    const isHighlighted = highlightId === item.id

    if (isEditing) {
      return (
        <div key={item.id} style={{ background: "#f8faff", border: "1px solid #4f83e8", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <label style={labelStyle}>商品名<input value={editForm.product_name} onChange={(e) => setEditForm({ ...editForm, product_name: e.target.value })} style={inputStyle} /></label>
            <label style={labelStyle}>メーカー<input value={editForm.maker} onChange={(e) => setEditForm({ ...editForm, maker: e.target.value })} style={inputStyle} placeholder="例: GC" /></label>
            <label style={labelStyle}>カテゴリ<input value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} style={inputStyle} placeholder="例: セメント" /></label>
            <label style={labelStyle}>棚番号<input value={editForm.shelf_no} onChange={(e) => setEditForm({ ...editForm, shelf_no: e.target.value })} style={inputStyle} placeholder="例: 技工室" /></label>
            <label style={labelStyle}>在庫数<input type="number" min="0" value={editForm.stock_quantity} onChange={(e) => setEditForm({ ...editForm, stock_quantity: e.target.value })} style={inputStyle} /></label>
            <label style={labelStyle}>最低在庫数<input type="number" min="0" value={editForm.min_stock} onChange={(e) => setEditForm({ ...editForm, min_stock: e.target.value })} style={inputStyle} placeholder="例: 1" /></label>
            <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>バーコード<input value={editForm.barcode} onChange={(e) => setEditForm({ ...editForm, barcode: e.target.value })} style={inputStyle} placeholder="例: 4901234567890" /></label>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setEditId(null)} style={cancelBtn}>キャンセル</button>
            <button onClick={saveEdit} disabled={busy} style={saveBtn}>{busy ? "保存中…" : "保存する"}</button>
          </div>
        </div>
      )
    }

    return (
      <div
        key={item.id}
        ref={(el) => { itemRefs.current[item.id] = el }}
        onClick={selectMode && hasBarcode ? () => toggleSelect(item.id, hasBarcode) : undefined}
        style={{
          background: isHighlighted ? "#fffbe6" : isSelected ? "#eef4ff" : "#fff",
          border: isHighlighted ? "2px solid #f59e0b" : isSelected ? "2px solid #1a56db" : low ? "1px solid #f5c6cb" : "1px solid #e0e0e0",
          borderRadius: 10, padding: "10px 14px",
          opacity: busy ? 0.6 : (selectMode && !hasBarcode ? 0.45 : 1),
          transition: "opacity 0.15s, border 0.1s, background 0.3s",
          cursor: selectMode && hasBarcode ? "pointer" : "default",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          {selectMode && (
            <div style={{ paddingTop: 2, flexShrink: 0 }}>
              <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(item.id, hasBarcode)} disabled={!hasBarcode}
                style={{ width: 18, height: 18, cursor: hasBarcode ? "pointer" : "not-allowed" }}
                onClick={(e) => e.stopPropagation()} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontWeight: "bold", fontSize: 14, color: "#111" }}>{item.product_name}</span>
              {low && <span style={{ fontSize: 10, fontWeight: "bold", background: "#fde8e8", color: "#c0392b", padding: "1px 6px", borderRadius: 4 }}>発注必要</span>}
              {selectMode && !hasBarcode && <span style={{ fontSize: 10, color: "#aaa" }}>バーコードなし</span>}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 3, flexWrap: "wrap" }}>
              {item.maker && <span style={{ fontSize: 11, color: "#666" }}>{item.maker}</span>}
              {item.category && <span style={{ fontSize: 11, color: "#888", background: "#f3f4f6", padding: "0 5px", borderRadius: 3 }}>{item.category}</span>}
              {!groupByShelf && item.shelf_no && <span style={{ fontSize: 11, color: "#888" }}>棚: {item.shelf_no}</span>}
              {item.barcode && <span style={{ fontSize: 11, color: "#aaa", fontFamily: "monospace" }}>{item.barcode}</span>}
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: "#555" }}>
              在庫: <strong style={{ fontSize: 16, color: low ? "#c0392b" : "#111" }}>{item.stock_quantity}</strong>
              {item.min_stock !== null && <span style={{ marginLeft: 6, color: "#aaa" }}>（最低: {item.min_stock}）</span>}
            </div>
          </div>
          {!selectMode && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 } as React.CSSProperties}>
              <button onClick={() => changeQty(item.id, -1)} disabled={busy || item.stock_quantity <= 0}
                style={{ padding: "6px 14px", background: "#e8f0fe", color: "#1a56db", border: "none", borderRadius: 6, fontSize: 12, fontWeight: "bold", cursor: "pointer", opacity: (busy || item.stock_quantity <= 0) ? 0.4 : 1, whiteSpace: "nowrap" }}>
                使用する
              </button>
              <button onClick={() => changeQty(item.id, 1)} disabled={busy}
                style={{ padding: "6px 14px", background: "#e6f4ea", color: "#137333", border: "none", borderRadius: 6, fontSize: 12, fontWeight: "bold", cursor: "pointer", opacity: busy ? 0.4 : 1, whiteSpace: "nowrap" }}>
                補充する
              </button>
              <button onClick={() => startEdit(item)} disabled={busy}
                style={{ padding: "6px 14px", background: "#f5f5f5", color: "#555", border: "1px solid #ddd", borderRadius: 6, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                編集
              </button>
              {item.barcode && (
                <button onClick={() => setBarcodeItem(item)}
                  style={{ padding: "6px 14px", background: "#fff8e1", color: "#b45309", border: "1px solid #fcd34d", borderRadius: 6, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                  バーコード
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  const selectedItems = items.filter((i) => selectedIds.has(i.id) && i.barcode)

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 12px 100px" }}>
      {/* ヘッダー */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => router.push("/menu")} style={backBtn}>← メニューへ</button>
        <h1 style={{ fontSize: 18, fontWeight: "bold", color: "#111", margin: 0 }}>
          在庫管理
          <span style={{ fontSize: 11, fontWeight: "normal", color: "#888", marginLeft: 8 }}>
            {filtered.length}/{items.length}件
            {items.filter(isLow).length > 0 && <span style={{ color: "#c0392b", marginLeft: 8 }}>発注必要 {items.filter(isLow).length}件</span>}
          </span>
        </h1>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!selectMode && !cartMode && (
            <>
              <button onClick={startScan} disabled={scanning} style={outlineBtn}>📷 スキャン</button>
              <button onClick={enterCartMode} style={{ ...outlineBtn, color: "#059669", borderColor: "#059669" }}>📋 スキャンリスト</button>
              <button onClick={() => setGroupByShelf((v) => !v)}
                style={{ ...outlineBtn, background: groupByShelf ? "#1a56db" : "#fff", color: groupByShelf ? "#fff" : "#1a56db" }}>
                棚別
              </button>
              <button onClick={() => setSelectMode(true)} style={outlineBtn}>選択印刷</button>
              <button onClick={() => { setAddForm(emptyForm); setShowAddModal(true) }} style={addBtn}>＋ 追加</button>
            </>
          )}
          {selectMode && (
            <>
              <button onClick={selectAllWithBarcode} style={outlineBtn}>全選択</button>
              <button onClick={exitSelectMode} style={cancelBtn}>キャンセル</button>
            </>
          )}
          {cartMode && (
            <button onClick={exitCartMode} style={cancelBtn}>リスト終了</button>
          )}
        </div>
      </div>

      {/* ── スキャンカートモード ── */}
      {cartMode && (
        <div style={{ marginBottom: 16, border: "2px solid #059669", borderRadius: 12, overflow: "hidden", background: "#f0fdf4" }}>
          <div style={{ padding: "10px 14px", background: "#059669", color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontWeight: "bold", fontSize: 14 }}>📋 スキャンリスト</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {cart.length > 0 && (
                <button onClick={() => setShowCart(true)}
                  style={{ background: "#fff", color: "#059669", border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 13, fontWeight: "bold", cursor: "pointer" }}>
                  リストを見る（{cart.length}件）
                </button>
              )}
            </div>
          </div>

          {/* カメラ */}
          {cartScanning && (
            <div>
              <div id="cart-reader" style={{ width: "100%" }} />
              <div style={{ padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#374151" }}>バーコードをカメラに向けてください</span>
                <button onClick={stopCartScan} style={{ ...cancelBtn, fontSize: 12, padding: "4px 12px" }}>停止</button>
              </div>
            </div>
          )}

          {/* 未登録バーコード警告 */}
          {unknownBarcode && !cartScanning && (
            <div style={{ padding: "8px 14px", background: "#fef3c7", borderTop: "1px solid #fcd34d" }}>
              <span style={{ fontSize: 12, color: "#92400e" }}>⚠️ 未登録のバーコード: <code>{unknownBarcode}</code></span>
            </div>
          )}

          {/* スキャンボタン */}
          {!cartScanning && (
            <div style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center" }}>
              <button onClick={startCartScan} style={{ ...saveBtn, background: "#059669", flex: 1, textAlign: "center" }}>
                📷 スキャンする
              </button>
            </div>
          )}

          {/* トースト */}
          {cartToast && (
            <div style={{ padding: "8px 14px", background: "#dcfce7", borderTop: "1px solid #86efac", fontSize: 13, color: "#166534", fontWeight: "bold" }}>
              ✓ {cartToast} をリストに追加しました
            </div>
          )}

          {/* インラインリスト（コンパクト） */}
          {cart.length > 0 && !showCart && (
            <div style={{ padding: "0 14px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
              {cart.map((entry) => {
                const newQty = Math.max(0, entry.item.stock_quantity + entry.change)
                return (
                  <div key={entry.item.id} style={{ background: "#fff", border: "1px solid #d1fae5", borderRadius: 8, padding: "8px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: "bold", fontSize: 13, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.item.product_name}</div>
                      <div style={{ fontSize: 11, color: "#888" }}>
                        現在: {entry.item.stock_quantity} →
                        <strong style={{ color: newQty < (entry.item.min_stock ?? 0) ? "#c0392b" : "#059669", marginLeft: 4 }}>{newQty}</strong>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <button onClick={() => cartChangeQty(entry.item.id, -1)}
                        style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #ddd", background: "#f5f5f5", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                      <input type="number" value={entry.change}
                        onChange={(e) => cartSetChange(entry.item.id, e.target.value)}
                        style={{ width: 44, textAlign: "center", border: "1px solid #ddd", borderRadius: 6, padding: "2px 4px", fontSize: 13 }} />
                      <button onClick={() => cartChangeQty(entry.item.id, 1)}
                        style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #ddd", background: "#f5f5f5", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>＋</button>
                    </div>
                    <button onClick={() => removeFromCart(entry.item.id)}
                      style={{ background: "none", border: "none", color: "#ef4444", fontSize: 18, cursor: "pointer", padding: "0 4px", flexShrink: 0 }}>🗑</button>
                  </div>
                )
              })}
              <button onClick={applyCart} disabled={applyingCart}
                style={{ ...saveBtn, background: "#059669", marginTop: 4, width: "100%", textAlign: "center" }}>
                {applyingCart ? "適用中…" : `✓ 在庫に反映する（${cart.length}件）`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 通常スキャナー */}
      {scanning && !cartMode && (
        <div style={{ marginBottom: 12, border: "1px solid #c5d5f5", borderRadius: 10, overflow: "hidden", background: "#f8faff" }}>
          <div id="inv-reader" style={{ width: "100%" }} />
          <div style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#555" }}>バーコードをカメラに向けてください</span>
          </div>
        </div>
      )}

      {/* 検索バー */}
      <div style={{ marginBottom: 12 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="商品名・バーコードで検索"
          style={{ width: "100%", padding: "10px 14px", border: "1px solid #d0d0d0", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
      </div>

      {/* 商品リスト */}
      {loading ? (
        <p style={{ textAlign: "center", color: "#999", padding: "40px 0" }}>読み込み中…</p>
      ) : filtered.length === 0 ? (
        <p style={{ textAlign: "center", color: "#999", padding: "40px 0" }}>該当する商品がありません</p>
      ) : groupByShelf ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {groupedByShelves.map(({ shelf, items: shelfItems }) => {
            const collapsed = collapsedShelves.has(shelf)
            const lowCount = shelfItems.filter(isLow).length
            return (
              <div key={shelf}>
                <button onClick={() => toggleShelf(shelf)} style={{
                  width: "100%", textAlign: "left", display: "flex", alignItems: "center",
                  justifyContent: "space-between", padding: "8px 12px", marginBottom: 6,
                  background: "#f0f4ff", border: "1px solid #c5d5f5", borderRadius: 8,
                  cursor: "pointer", fontWeight: "bold", fontSize: 14, color: "#1a56db",
                }}>
                  <span>
                    📦 {shelf}
                    <span style={{ fontSize: 11, fontWeight: "normal", color: "#888", marginLeft: 8 }}>
                      {shelfItems.length}件
                      {lowCount > 0 && <span style={{ color: "#c0392b", marginLeft: 6 }}>発注必要 {lowCount}件</span>}
                    </span>
                  </span>
                  <span style={{ fontSize: 12, color: "#888" }}>{collapsed ? "▶" : "▼"}</span>
                </button>
                {!collapsed && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {shelfItems.map((item) => renderItemCard(item))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((item) => renderItemCard(item))}
        </div>
      )}

      {/* 一括印刷フッターバー */}
      {selectMode && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 200,
          background: "#1a56db", color: "#fff", padding: "12px 20px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          boxShadow: "0 -2px 12px rgba(0,0,0,0.15)",
        }}>
          <span style={{ fontSize: 14, fontWeight: "bold" }}>
            {selectedIds.size}件選択中
            {selectedIds.size > 0 && <span style={{ fontWeight: "normal", fontSize: 12, marginLeft: 8, opacity: 0.8 }}>（バーコードありのみ印刷）</span>}
          </span>
          <button onClick={doPrintBulk} disabled={selectedIds.size === 0}
            style={{ padding: "8px 24px", background: "#fff", color: "#1a56db", border: "none", borderRadius: 8, fontSize: 14, fontWeight: "bold", cursor: selectedIds.size === 0 ? "not-allowed" : "pointer", opacity: selectedIds.size === 0 ? 0.5 : 1 }}>
            まとめて印刷
          </button>
        </div>
      )}

      {/* 一括印刷用非表示バーコード */}
      <div ref={bulkBarcodeRef} style={{ display: "none" }}>
        {selectedItems.map((item) => (
          <div key={item.id} className="cell">
            <div className="name">{item.product_name}</div>
            <Barcode value={item.barcode!} width={1.5} height={50} fontSize={10} displayValue={true} />
          </div>
        ))}
      </div>

      {/* スキャンリスト詳細モーダル */}
      {showCart && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setShowCart(false) }}>
          <div style={{ ...modal, maxWidth: 560, maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h2 style={{ fontSize: 16, fontWeight: "bold", color: "#111", margin: 0 }}>スキャンリスト（{cart.length}件）</h2>
              <button onClick={() => setShowCart(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#888" }}>✕</button>
            </div>
            <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              {cart.length === 0 ? (
                <p style={{ textAlign: "center", color: "#aaa", padding: "24px 0" }}>リストが空です</p>
              ) : cart.map((entry) => {
                const newQty = Math.max(0, entry.item.stock_quantity + entry.change)
                const willBeLow = newQty <= (entry.item.min_stock ?? 0)
                return (
                  <div key={entry.item.id} style={{ border: "1px solid #e0e0e0", borderRadius: 10, padding: "12px 14px", background: "#fff" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: "bold", fontSize: 14, color: "#111" }}>{entry.item.product_name}</div>
                        <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                          {entry.item.maker && <span style={{ marginRight: 8 }}>{entry.item.maker}</span>}
                          {entry.item.shelf_no && <span>棚: {entry.item.shelf_no}</span>}
                        </div>
                        <div style={{ marginTop: 6, fontSize: 13 }}>
                          現在在庫: <strong>{entry.item.stock_quantity}</strong>
                          <span style={{ margin: "0 8px", color: "#aaa" }}>→</span>
                          適用後: <strong style={{ color: willBeLow ? "#c0392b" : "#059669" }}>{newQty}</strong>
                          {willBeLow && <span style={{ fontSize: 10, background: "#fde8e8", color: "#c0392b", padding: "1px 6px", borderRadius: 4, marginLeft: 6 }}>発注必要</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        <div style={{ fontSize: 11, color: "#888", textAlign: "center", marginRight: 4 }}>変更量</div>
                        <button onClick={() => cartChangeQty(entry.item.id, -1)}
                          style={{ width: 32, height: 32, borderRadius: 6, border: "1px solid #ddd", background: "#f5f5f5", cursor: "pointer", fontSize: 18 }}>−</button>
                        <input type="number" value={entry.change} onChange={(e) => cartSetChange(entry.item.id, e.target.value)}
                          style={{ width: 52, textAlign: "center", border: "1px solid #ddd", borderRadius: 6, padding: "4px", fontSize: 14, fontWeight: "bold" }} />
                        <button onClick={() => cartChangeQty(entry.item.id, 1)}
                          style={{ width: 32, height: 32, borderRadius: 6, border: "1px solid #ddd", background: "#f5f5f5", cursor: "pointer", fontSize: 18 }}>＋</button>
                        <button onClick={() => removeFromCart(entry.item.id)}
                          style={{ background: "none", border: "none", color: "#ef4444", fontSize: 20, cursor: "pointer", padding: "0 4px" }}>🗑</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {cart.length > 0 && (
              <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => { setCart([]); setShowCart(false) }} style={cancelBtn}>クリア</button>
                <button onClick={applyCart} disabled={applyingCart}
                  style={{ ...saveBtn, background: "#059669" }}>
                  {applyingCart ? "適用中…" : `在庫に反映する（${cart.length}件）`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 商品追加モーダル */}
      {showAddModal && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setShowAddModal(false) }}>
          <div style={modal}>
            <h2 style={{ fontSize: 16, fontWeight: "bold", marginBottom: 14, color: "#111" }}>商品追加</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <label style={labelStyle}>商品名 <span style={{ color: "#e53e3e" }}>*</span><input value={addForm.product_name} onChange={(e) => setAddForm({ ...addForm, product_name: e.target.value })} style={inputStyle} placeholder="例: フジアイオノマー" /></label>
              <label style={labelStyle}>メーカー<input value={addForm.maker} onChange={(e) => setAddForm({ ...addForm, maker: e.target.value })} style={inputStyle} placeholder="例: GC" /></label>
              <label style={labelStyle}>カテゴリ<input value={addForm.category} onChange={(e) => setAddForm({ ...addForm, category: e.target.value })} style={inputStyle} placeholder="例: セメント" /></label>
              <label style={labelStyle}>棚番号<input value={addForm.shelf_no} onChange={(e) => setAddForm({ ...addForm, shelf_no: e.target.value })} style={inputStyle} placeholder="例: A-3" /></label>
              <label style={labelStyle}>初期在庫数<input type="number" min="0" value={addForm.stock_quantity} onChange={(e) => setAddForm({ ...addForm, stock_quantity: e.target.value })} style={inputStyle} /></label>
              <label style={labelStyle}>最低在庫数<input type="number" min="0" value={addForm.min_stock} onChange={(e) => setAddForm({ ...addForm, min_stock: e.target.value })} style={inputStyle} placeholder="例: 1" /></label>
              <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>バーコード（任意）<input value={addForm.barcode} onChange={(e) => setAddForm({ ...addForm, barcode: e.target.value })} style={inputStyle} placeholder="例: 4901234567890" /></label>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowAddModal(false)} style={cancelBtn}>キャンセル</button>
              <button onClick={addItem} disabled={addSaving} style={saveBtn}>{addSaving ? "追加中…" : "追加する"}</button>
            </div>
          </div>
        </div>
      )}

      {/* バーコード単体表示モーダル */}
      {barcodeItem && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setBarcodeItem(null) }}>
          <div style={{ ...modal, maxWidth: 380, textAlign: "center" }}>
            <h2 style={{ fontSize: 14, fontWeight: "bold", marginBottom: 4, color: "#111" }}>{barcodeItem.product_name}</h2>
            <p style={{ fontSize: 11, color: "#888", marginBottom: 14 }}>{barcodeItem.barcode}</p>
            <div ref={barcodeRef} style={{ display: "inline-block", background: "#fff", padding: 8 }}>
              <Barcode value={barcodeItem.barcode!} width={1.8} height={60} fontSize={12} displayValue={true} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
              <button onClick={() => setBarcodeItem(null)} style={cancelBtn}>閉じる</button>
              <button onClick={doPrintSingle} style={saveBtn}>印刷する</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const backBtn: React.CSSProperties = {
  padding: "8px 14px", background: "#f5f5f5", color: "#555", border: "1px solid #e0e0e0",
  borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: "bold", whiteSpace: "nowrap",
}

const labelStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: "#666", fontWeight: "bold",
}
const inputStyle: React.CSSProperties = {
  padding: "6px 8px", border: "1px solid #c5d5f5", borderRadius: 6, fontSize: 13, background: "#fff",
}
const saveBtn: React.CSSProperties = {
  padding: "7px 20px", background: "#1a56db", color: "#fff", border: "none",
  borderRadius: 7, fontSize: 13, fontWeight: "bold", cursor: "pointer",
}
const cancelBtn: React.CSSProperties = {
  padding: "7px 16px", background: "#fff", color: "#555", border: "1px solid #ddd",
  borderRadius: 7, fontSize: 13, cursor: "pointer",
}
const addBtn: React.CSSProperties = {
  padding: "8px 18px", background: "#1a56db", color: "#fff", border: "none",
  borderRadius: 8, fontSize: 13, fontWeight: "bold", cursor: "pointer",
}
const outlineBtn: React.CSSProperties = {
  padding: "8px 16px", background: "#fff", color: "#1a56db", border: "1.5px solid #1a56db",
  borderRadius: 8, fontSize: 13, fontWeight: "bold", cursor: "pointer",
}
const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000,
  display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
}
const modal: React.CSSProperties = {
  background: "#fff", borderRadius: 12, padding: "20px 22px", width: "100%", maxWidth: 520,
  boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
}
