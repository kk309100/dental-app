"use client"

import { useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import Barcode from "react-barcode"

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

const emptyForm: EditForm = {
  product_name: "", maker: "", category: "", shelf_no: "", min_stock: "", stock_quantity: "0", barcode: "",
}

export default function ClinicInventoryPage() {
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
  const barcodeRef = useRef<HTMLDivElement>(null)

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

  async function changeQty(id: string, delta: number) {
    const item = items.find((i) => i.id === id)
    if (!item) return
    const newQty = Math.max(0, item.stock_quantity + delta)
    setProcessingId(id)
    const { error } = await supabase
      .from("clinic_inventory_items")
      .update({ stock_quantity: newQty })
      .eq("id", id)
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
    const { error } = await supabase
      .from("clinic_inventory_items")
      .update(updates)
      .eq("id", editId)
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

  function printBarcode(item: Item) {
    setBarcodeItem(item)
  }

  function doPrint() {
    const content = barcodeRef.current
    if (!content) return
    const w = window.open("", "_blank", "width=400,height=300")
    if (!w) return
    w.document.write(`
      <html><head><title>バーコード印刷</title>
      <style>body{margin:20px;font-family:sans-serif;text-align:center} svg{max-width:100%}</style>
      </head><body>
      <div>${content.innerHTML}</div>
      </body></html>
    `)
    w.document.close()
    w.focus()
    w.print()
    w.close()
  }

  const isLow = (item: Item) => item.stock_quantity <= (item.min_stock ?? 0)

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 12px 80px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ fontSize: 18, fontWeight: "bold", color: "#111", margin: 0 }}>
          在庫管理
          <span style={{ fontSize: 11, fontWeight: "normal", color: "#888", marginLeft: 8 }}>
            {filtered.length}/{items.length}件
            {items.filter(isLow).length > 0 && (
              <span style={{ color: "#c0392b", marginLeft: 8 }}>発注必要 {items.filter(isLow).length}件</span>
            )}
          </span>
        </h1>
        <button onClick={() => { setAddForm(emptyForm); setShowAddModal(true) }} style={addBtn}>
          ＋ 商品追加
        </button>
      </div>

      {/* 検索バー */}
      <div style={{ marginBottom: 12 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="商品名・バーコードで検索"
          style={{ width: "100%", padding: "10px 14px", border: "1px solid #d0d0d0", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
        />
      </div>

      {loading ? (
        <p style={{ textAlign: "center", color: "#999", padding: "40px 0" }}>読み込み中…</p>
      ) : filtered.length === 0 ? (
        <p style={{ textAlign: "center", color: "#999", padding: "40px 0" }}>該当する商品がありません</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((item) => {
            const low = isLow(item)
            const busy = processingId === item.id
            const isEditing = editId === item.id

            if (isEditing) {
              return (
                <div key={item.id} style={{ background: "#f8faff", border: "1px solid #4f83e8", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <label style={labelStyle}>
                      商品名
                      <input value={editForm.product_name} onChange={(e) => setEditForm({ ...editForm, product_name: e.target.value })} style={inputStyle} />
                    </label>
                    <label style={labelStyle}>
                      メーカー
                      <input value={editForm.maker} onChange={(e) => setEditForm({ ...editForm, maker: e.target.value })} style={inputStyle} placeholder="例: GC" />
                    </label>
                    <label style={labelStyle}>
                      カテゴリ
                      <input value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} style={inputStyle} placeholder="例: セメント" />
                    </label>
                    <label style={labelStyle}>
                      棚番号
                      <input value={editForm.shelf_no} onChange={(e) => setEditForm({ ...editForm, shelf_no: e.target.value })} style={inputStyle} placeholder="例: 技工室" />
                    </label>
                    <label style={labelStyle}>
                      在庫数
                      <input type="number" min="0" value={editForm.stock_quantity} onChange={(e) => setEditForm({ ...editForm, stock_quantity: e.target.value })} style={inputStyle} />
                    </label>
                    <label style={labelStyle}>
                      最低在庫数
                      <input type="number" min="0" value={editForm.min_stock} onChange={(e) => setEditForm({ ...editForm, min_stock: e.target.value })} style={inputStyle} placeholder="例: 1" />
                    </label>
                    <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
                      バーコード
                      <input value={editForm.barcode} onChange={(e) => setEditForm({ ...editForm, barcode: e.target.value })} style={inputStyle} placeholder="例: 4901234567890" />
                    </label>
                  </div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button onClick={() => setEditId(null)} style={cancelBtn}>キャンセル</button>
                    <button onClick={saveEdit} disabled={busy} style={saveBtn}>
                      {busy ? "保存中…" : "保存する"}
                    </button>
                  </div>
                </div>
              )
            }

            return (
              <div
                key={item.id}
                style={{
                  background: "#fff",
                  border: low ? "1px solid #f5c6cb" : "1px solid #e0e0e0",
                  borderRadius: 10,
                  padding: "10px 14px",
                  opacity: busy ? 0.6 : 1,
                  transition: "opacity 0.15s",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: "bold", fontSize: 14, color: "#111" }}>{item.product_name}</span>
                      {low && (
                        <span style={{ fontSize: 10, fontWeight: "bold", background: "#fde8e8", color: "#c0392b", padding: "1px 6px", borderRadius: 4 }}>
                          発注必要
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: 3, flexWrap: "wrap" }}>
                      {item.maker && <span style={{ fontSize: 11, color: "#666" }}>{item.maker}</span>}
                      {item.category && <span style={{ fontSize: 11, color: "#888", background: "#f3f4f6", padding: "0 5px", borderRadius: 3 }}>{item.category}</span>}
                      {item.shelf_no && <span style={{ fontSize: 11, color: "#888" }}>棚: {item.shelf_no}</span>}
                      {item.barcode && <span style={{ fontSize: 11, color: "#aaa", fontFamily: "monospace" }}>{item.barcode}</span>}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, color: "#555" }}>
                      在庫: <strong style={{ fontSize: 16, color: low ? "#c0392b" : "#111" }}>{item.stock_quantity}</strong>
                      {item.min_stock !== null && <span style={{ marginLeft: 6, color: "#aaa" }}>（最低: {item.min_stock}）</span>}
                    </div>
                  </div>

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
                      <button onClick={() => printBarcode(item)}
                        style={{ padding: "6px 14px", background: "#fff8e1", color: "#b45309", border: "1px solid #fcd34d", borderRadius: 6, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                        バーコード
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 商品追加モーダル */}
      {showAddModal && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setShowAddModal(false) }}>
          <div style={modal}>
            <h2 style={{ fontSize: 16, fontWeight: "bold", marginBottom: 14, color: "#111" }}>商品追加</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <label style={labelStyle}>
                商品名 <span style={{ color: "#e53e3e" }}>*</span>
                <input value={addForm.product_name} onChange={(e) => setAddForm({ ...addForm, product_name: e.target.value })} style={inputStyle} placeholder="例: フジアイオノマー" />
              </label>
              <label style={labelStyle}>
                メーカー
                <input value={addForm.maker} onChange={(e) => setAddForm({ ...addForm, maker: e.target.value })} style={inputStyle} placeholder="例: GC" />
              </label>
              <label style={labelStyle}>
                カテゴリ
                <input value={addForm.category} onChange={(e) => setAddForm({ ...addForm, category: e.target.value })} style={inputStyle} placeholder="例: セメント" />
              </label>
              <label style={labelStyle}>
                棚番号
                <input value={addForm.shelf_no} onChange={(e) => setAddForm({ ...addForm, shelf_no: e.target.value })} style={inputStyle} placeholder="例: A-3" />
              </label>
              <label style={labelStyle}>
                初期在庫数
                <input type="number" min="0" value={addForm.stock_quantity} onChange={(e) => setAddForm({ ...addForm, stock_quantity: e.target.value })} style={inputStyle} />
              </label>
              <label style={labelStyle}>
                最低在庫数
                <input type="number" min="0" value={addForm.min_stock} onChange={(e) => setAddForm({ ...addForm, min_stock: e.target.value })} style={inputStyle} placeholder="例: 1" />
              </label>
              <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
                バーコード（任意）
                <input value={addForm.barcode} onChange={(e) => setAddForm({ ...addForm, barcode: e.target.value })} style={inputStyle} placeholder="例: 4901234567890" />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowAddModal(false)} style={cancelBtn}>キャンセル</button>
              <button onClick={addItem} disabled={addSaving} style={saveBtn}>
                {addSaving ? "追加中…" : "追加する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* バーコード表示モーダル */}
      {barcodeItem && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setBarcodeItem(null) }}>
          <div style={{ ...modal, maxWidth: 380, textAlign: "center" }}>
            <h2 style={{ fontSize: 14, fontWeight: "bold", marginBottom: 4, color: "#111" }}>{barcodeItem.product_name}</h2>
            <p style={{ fontSize: 11, color: "#888", marginBottom: 14 }}>{barcodeItem.barcode}</p>
            <div ref={barcodeRef} style={{ display: "inline-block", background: "#fff", padding: 8 }}>
              <Barcode
                value={barcodeItem.barcode!}
                width={1.8}
                height={60}
                fontSize={12}
                displayValue={true}
              />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
              <button onClick={() => setBarcodeItem(null)} style={cancelBtn}>閉じる</button>
              <button onClick={doPrint} style={saveBtn}>印刷する</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
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

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000,
  display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
}

const modal: React.CSSProperties = {
  background: "#fff", borderRadius: 12, padding: "20px 22px", width: "100%", maxWidth: 520,
  boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
}
