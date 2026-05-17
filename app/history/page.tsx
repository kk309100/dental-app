"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

export default function HistoryPage() {
  const router = useRouter()

  const [clinicId, setClinicId] = useState("")
  const [clinicName, setClinicName] = useState("")
  const [orders, setOrders] = useState<any[]>([])
  const [orderItems, setOrderItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("すべて")
  const [openOrderId, setOpenOrderId] = useState<string | null>(null)
  const [reorderingId, setReorderingId] = useState<string | null>(null)
  const [reorderDone, setReorderDone] = useState(false)

  useEffect(() => { checkLogin() }, [])

  async function checkLogin() {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) { router.push("/login"); return }

    const { data: profile } = await supabase
      .from("profiles").select("*").eq("id", userData.user.id).single()
    if (!profile) { router.push("/login"); return }
    if (profile.role === "admin") { router.push("/admin"); return }

    setClinicId(profile.clinic_id)
    const { data: clinic } = await supabase
      .from("clinics").select("*").eq("id", profile.clinic_id).single()
    setClinicName(clinic?.name || "")
    await fetchHistory(profile.clinic_id)
    setLoading(false)
  }

  async function fetchHistory(targetClinicId: string) {
    const { data: ordersData } = await supabase
      .from("orders").select("*").eq("clinic_id", targetClinicId)
      .order("created_at", { ascending: false })
    const { data: itemsData } = await supabase.from("order_items").select("*")
    setOrders(ordersData || [])
    setOrderItems(itemsData || [])
  }

  function getItems(orderId: string) {
    return orderItems.filter((item) => item.order_id === orderId)
  }

  const norm = (v: any) => String(v || "").toLowerCase().normalize("NFKC").replace(/\s+/g, "")

  const statuses = useMemo(() => {
    const list = orders.map((o) => o.status).filter((s) => s && String(s).trim())
    return ["すべて", ...Array.from(new Set(list))]
  }, [orders])

  const filteredOrders = useMemo(() => {
    const k = norm(search)
    return orders.filter((order) => {
      const itemNames = getItems(order.id).map((i) => i.product_name || "").join(" ")
      const target = norm(`${order.delivery_number || ""} ${order.status || ""} ${itemNames}`)
      return (!k || target.includes(k)) && (statusFilter === "すべて" || order.status === statusFilter)
    })
  }, [orders, orderItems, search, statusFilter])

  async function reorder(order: any) {
    const items = getItems(order.id)
    if (items.length === 0) { alert("再注文できる商品がありません"); return }
    setReorderingId(order.id)

    const now = new Date()
    const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, "0"), d = String(now.getDate()).padStart(2, "0")
    const { data: existing } = await supabase.from("orders").select("id")
      .gte("created_at", `${y}-${m}-${d}T00:00:00`).lte("created_at", `${y}-${m}-${d}T23:59:59`)
    const deliveryNumber = `DN-${y}${m}${d}-${String((existing?.length || 0) + 1).padStart(4, "0")}`
    const totalPrice = items.reduce((sum, i) => sum + Number(i.price || 0) * Number(i.quantity || 0), 0)

    const { data: newOrder, error } = await supabase.from("orders")
      .insert([{ clinic_id: clinicId, status: "注文受付", total_price: totalPrice, delivery_number: deliveryNumber }])
      .select().single()
    if (error) { alert("再注文でエラーが出ました"); setReorderingId(null); return }

    await supabase.from("order_items").insert(
      items.map((i) => ({ order_id: newOrder.id, product_id: i.product_id, product_name: i.product_name, quantity: i.quantity, price: i.price }))
    )
    setReorderingId(null)
    setReorderDone(true)
    await fetchHistory(clinicId)
  }

  function fmtDate(str: string) {
    const d = new Date(str)
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  }

  function statusStyle(status: string): React.CSSProperties {
    const isDone = status === "納品済み" || status === "納品済"
    const isCancel = status === "キャンセル" || status === "取消"
    return {
      padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: "bold", whiteSpace: "nowrap",
      background: isDone ? "#dcfce7" : isCancel ? "#fee2e2" : "#e0f2fe",
      color: isDone ? "#166534" : isCancel ? "#991b1b" : "#075985",
    }
  }

  if (loading) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh", color: "#999" }}>読み込み中…</div>

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "12px 16px 60px" }}>
      {/* ヘッダー */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <button onClick={() => router.push("/menu")} style={backBtn}>← メニューへ</button>
        <span style={{ fontSize: 12, color: "#888" }}>{clinicName}</span>
      </div>

      <h1 style={{ fontSize: 20, fontWeight: "bold", color: "#111", marginBottom: 16 }}>注文履歴</h1>

      {/* 検索・フィルター */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="納品書番号・商品名で検索"
          style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" as const }} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", fontSize: 13, background: "#fff", flexShrink: 0 }}>
          {statuses.map((s: any) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* 件数 */}
      <p style={{ fontSize: 12, color: "#999", marginBottom: 12 }}>
        {filteredOrders.length}件 / 全{orders.length}件
      </p>

      {/* 再注文完了トースト */}
      {reorderDone && (
        <div style={{ background: "#dcfce7", border: "1px solid #86efac", borderRadius: 10, padding: "12px 16px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 14, fontWeight: "bold", color: "#166534" }}>✓ 再注文しました</span>
          <button onClick={() => setReorderDone(false)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#888" }}>✕</button>
        </div>
      )}

      {filteredOrders.length === 0 ? (
        <div style={{ textAlign: "center", color: "#aaa", padding: "60px 0", fontSize: 14 }}>注文履歴がありません</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filteredOrders.map((order) => {
            const items = getItems(order.id)
            const isOpen = openOrderId === order.id
            const isReordering = reorderingId === order.id
            const totalQty = items.reduce((s, i) => s + Number(i.quantity || 0), 0)

            return (
              <div key={order.id} style={{
                background: "#fff", border: "1px solid #e8eaed", borderRadius: 16,
                overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
              }}>
                {/* カードヘッダー */}
                <div style={{ padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: "bold", fontSize: 15, color: "#111" }}>
                        {order.delivery_number || "番号なし"}
                      </p>
                      <p style={{ margin: "3px 0 0", fontSize: 12, color: "#999" }}>{fmtDate(order.created_at)}</p>
                    </div>
                    <span style={statusStyle(order.status)}>{order.status || "未設定"}</span>
                  </div>

                  {/* サマリー行 */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, color: "#888" }}>{totalQty}点</span>
                    <span style={{ fontWeight: "bold", fontSize: 17, color: "#111" }}>
                      税抜 {Number(order.total_price || 0).toLocaleString()}円
                    </span>
                  </div>
                </div>

                {/* 明細（開閉） */}
                {isOpen && (
                  <div style={{ borderTop: "1px solid #f0f0f0", padding: "0 16px" }}>
                    {items.map((item, idx) => (
                      <div key={item.id} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "10px 0", borderBottom: idx < items.length - 1 ? "1px solid #f5f5f5" : "none",
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontWeight: "bold", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {item.product_name || "商品名なし"}
                          </p>
                          <p style={{ margin: "2px 0 0", fontSize: 12, color: "#999" }}>
                            {item.quantity}個 × {Number(item.price || 0).toLocaleString()}円
                          </p>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: "bold", color: "#333", flexShrink: 0, marginLeft: 12 }}>
                          {(Number(item.price || 0) * Number(item.quantity || 0)).toLocaleString()}円
                        </span>
                      </div>
                    ))}
                    <div style={{ padding: "10px 0", display: "flex", justifyContent: "flex-end" }}>
                      <span style={{ fontWeight: "bold", fontSize: 14 }}>
                        合計（税抜）　{Number(order.total_price || 0).toLocaleString()}円
                      </span>
                    </div>
                  </div>
                )}

                {/* アクションフッター */}
                <div style={{ borderTop: "1px solid #f0f0f0", padding: "10px 16px", display: "flex", gap: 8 }}>
                  <button onClick={() => setOpenOrderId(isOpen ? null : order.id)}
                    style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "1px solid #e0e0e0", background: "#fff", fontSize: 13, color: "#555", cursor: "pointer", fontWeight: "bold" }}>
                    {isOpen ? "閉じる ▲" : "明細 ▼"}
                  </button>

                  {order.status === "注文受付" && (
                    <button onClick={() => router.push(`/order-edit/${order.id}`)}
                      style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "1px solid #e0e0e0", background: "#fff", fontSize: 13, color: "#1a56db", cursor: "pointer", fontWeight: "bold" }}>
                      修正
                    </button>
                  )}

                  <button onClick={() => reorder(order)} disabled={isReordering}
                    style={{ flex: 1, padding: "9px 0", borderRadius: 8, border: "none", background: "#111", color: "#fff", fontSize: 13, cursor: isReordering ? "not-allowed" : "pointer", fontWeight: "bold", opacity: isReordering ? 0.6 : 1 }}>
                    {isReordering ? "処理中…" : "再注文"}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}

const backBtn: React.CSSProperties = {
  padding: "8px 14px", background: "#f5f5f5", color: "#555", border: "1px solid #e0e0e0",
  borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: "bold",
}
