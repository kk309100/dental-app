"use client"

import { useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"

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

export default function ClinicInventoryPage() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [processingId, setProcessingId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

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
    // ローカルステートを即更新（再フェッチも実行）
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, stock_quantity: newQty } : i))
  }

  const isLow = (item: Item) => item.stock_quantity <= (item.min_stock ?? 0)

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 12px 80px" }}>
      <h1 style={{ fontSize: 18, fontWeight: "bold", marginBottom: 12, color: "#111" }}>
        在庫管理
        <span style={{ fontSize: 11, fontWeight: "normal", color: "#888", marginLeft: 8 }}>
          {filtered.length}/{items.length}件
          {items.filter(isLow).length > 0 && (
            <span style={{ color: "#c0392b", marginLeft: 8 }}>
              発注必要 {items.filter(isLow).length}件
            </span>
          )}
        </span>
      </h1>

      {/* 検索バー */}
      <div style={{ marginBottom: 12 }}>
        <input
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="商品名・バーコードで検索"
          style={{
            width: "100%",
            padding: "10px 14px",
            border: "1px solid #d0d0d0",
            borderRadius: 8,
            fontSize: 14,
            boxSizing: "border-box",
            outline: "none",
          }}
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
                  {/* 左：商品情報 */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: "bold", fontSize: 14, color: "#111" }}>{item.product_name}</span>
                      {low && (
                        <span style={{
                          fontSize: 10, fontWeight: "bold",
                          background: "#fde8e8", color: "#c0392b",
                          padding: "1px 6px", borderRadius: 4,
                        }}>
                          発注必要
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: 3, flexWrap: "wrap" }}>
                      {item.maker && (
                        <span style={{ fontSize: 11, color: "#666" }}>{item.maker}</span>
                      )}
                      {item.category && (
                        <span style={{ fontSize: 11, color: "#888", background: "#f3f4f6", padding: "0 5px", borderRadius: 3 }}>{item.category}</span>
                      )}
                      {item.shelf_no && (
                        <span style={{ fontSize: 11, color: "#888" }}>棚: {item.shelf_no}</span>
                      )}
                      {item.barcode && (
                        <span style={{ fontSize: 11, color: "#aaa", fontFamily: "monospace" }}>{item.barcode}</span>
                      )}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, color: "#555" }}>
                      在庫: <strong style={{ fontSize: 16, color: low ? "#c0392b" : "#111" }}>{item.stock_quantity}</strong>
                      {item.min_stock !== null && (
                        <span style={{ marginLeft: 6, color: "#aaa" }}>（最低: {item.min_stock}）</span>
                      )}
                    </div>
                  </div>

                  {/* 右：操作ボタン */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, shrink: 0 } as React.CSSProperties}>
                    <button
                      onClick={() => changeQty(item.id, -1)}
                      disabled={busy || item.stock_quantity <= 0}
                      style={{
                        padding: "6px 14px",
                        background: "#e8f0fe",
                        color: "#1a56db",
                        border: "none",
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: "bold",
                        cursor: "pointer",
                        opacity: (busy || item.stock_quantity <= 0) ? 0.4 : 1,
                        whiteSpace: "nowrap",
                      }}
                    >
                      使用する
                    </button>
                    <button
                      onClick={() => changeQty(item.id, 1)}
                      disabled={busy}
                      style={{
                        padding: "6px 14px",
                        background: "#e6f4ea",
                        color: "#137333",
                        border: "none",
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: "bold",
                        cursor: "pointer",
                        opacity: busy ? 0.4 : 1,
                        whiteSpace: "nowrap",
                      }}
                    >
                      補充する
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
