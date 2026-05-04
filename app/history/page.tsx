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
  const [openOrderId, setOpenOrderId] = useState("")

  useEffect(() => {
    checkLogin()
  }, [])

  async function checkLogin() {
    const { data: userData } = await supabase.auth.getUser()

    if (!userData.user) {
      router.push("/login")
      return
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userData.user.id)
      .single()

    if (!profile) {
      router.push("/login")
      return
    }

    if (profile.role === "admin") {
      router.push("/admin")
      return
    }

    setClinicId(profile.clinic_id)

    const { data: clinic } = await supabase
      .from("clinics")
      .select("*")
      .eq("id", profile.clinic_id)
      .single()

    setClinicName(clinic?.name || "")

    await fetchHistory(profile.clinic_id)
    setLoading(false)
  }

  async function fetchHistory(targetClinicId: string) {
    const { data: ordersData } = await supabase
      .from("orders")
      .select("*")
      .eq("clinic_id", targetClinicId)
      .order("created_at", { ascending: false })

    const { data: itemsData } = await supabase
      .from("order_items")
      .select("*")

    setOrders(ordersData || [])
    setOrderItems(itemsData || [])
  }

  function getItems(orderId: string) {
    return orderItems.filter((item) => item.order_id === orderId)
  }

  function normalizeText(value: any) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKC")
      .replace(/\s+/g, "")
  }

  const filteredOrders = useMemo(() => {
    const keyword = normalizeText(search)

    return orders.filter((order) => {
      const items = getItems(order.id)

      const itemNames = items
        .map((item) => item.product_name || "")
        .join(" ")

      const target = normalizeText(
        `${order.delivery_number || ""} ${order.status || ""} ${itemNames}`
      )

      const matchSearch = !keyword || target.includes(keyword)
      const matchStatus =
        statusFilter === "すべて" || order.status === statusFilter

      return matchSearch && matchStatus
    })
  }, [orders, orderItems, search, statusFilter])

  const statuses = useMemo(() => {
    const list = orders
      .map((order) => order.status)
      .filter((s) => s && String(s).trim() !== "")

    return ["すべて", ...Array.from(new Set(list))]
  }, [orders])

  async function generateDeliveryNumber() {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, "0")
    const d = String(now.getDate()).padStart(2, "0")
    const dateStr = `${y}${m}${d}`

    const { data } = await supabase
      .from("orders")
      .select("id")
      .gte("created_at", `${y}-${m}-${d}T00:00:00`)
      .lte("created_at", `${y}-${m}-${d}T23:59:59`)

    const count = (data?.length || 0) + 1
    return `DN-${dateStr}-${String(count).padStart(4, "0")}`
  }

  async function reorder(order: any) {
    const items = getItems(order.id)

    if (items.length === 0) {
      alert("再注文できる商品がありません")
      return
    }

    const totalPrice = items.reduce(
      (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
      0
    )

    const deliveryNumber = await generateDeliveryNumber()

    const { data: newOrder, error: orderError } = await supabase
      .from("orders")
      .insert([
        {
          clinic_id: clinicId,
          status: "注文受付",
          total_price: totalPrice,
          delivery_number: deliveryNumber,
        },
      ])
      .select()
      .single()

    if (orderError) {
      console.error(orderError)
      alert("再注文でエラーが出ました")
      return
    }

    const newItems = items.map((item) => ({
      order_id: newOrder.id,
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: item.quantity,
      price: item.price,
    }))

    const { error: itemError } = await supabase
      .from("order_items")
      .insert(newItems)

    if (itemError) {
      console.error(itemError)
      alert("再注文明細でエラーが出ました")
      return
    }

    alert("再注文しました")
    await fetchHistory(clinicId)
  }

  if (loading) return <p style={{ padding: 20 }}>読み込み中...</p>

  return (
    <main style={pageStyle}>
      <h1>注文履歴</h1>

      <div style={clinicBox}>
        <p style={{ margin: 0, fontSize: 12 }}>ログイン医院</p>
        <strong>{clinicName}</strong>
      </div>

      <button onClick={() => router.push("/order")} style={mainButton}>
        注文画面へ戻る
      </button>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="納品書番号・商品名で検索"
        style={inputStyle}
      />

      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        style={inputStyle}
      >
        {statuses.map((status: any) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>

      {filteredOrders.length === 0 && (
        <p>注文履歴はありません。</p>
      )}

      {filteredOrders.map((order) => {
        const items = getItems(order.id)
        const isOpen = openOrderId === order.id

        return (
          <div key={order.id} style={cardStyle}>
            <div style={cardHeader}>
              <div>
                <p style={deliveryNumberStyle}>
                  {order.delivery_number || "納品書番号なし"}
                </p>
                <p style={smallText}>
                  {new Date(order.created_at).toLocaleString()}
                </p>
              </div>

              <span style={statusBadge(order.status)}>
                {order.status || "未設定"}
              </span>
            </div>

            <p style={totalStyle}>
              税抜 {Number(order.total_price || 0).toLocaleString()}円
            </p>

            <button
              onClick={() => setOpenOrderId(isOpen ? "" : order.id)}
              style={subButton}
            >
              {isOpen ? "明細を閉じる" : "明細を見る"}
            </button>

            {isOpen && (
              <div style={detailBox}>
                {items.map((item) => (
                  <div key={item.id} style={itemRow}>
                    <div>
                      <p style={{ margin: 0, fontWeight: "bold" }}>
                        {item.product_name || "商品名なし"}
                      </p>
                      <p style={smallText}>
                        {item.quantity}個 × 税抜{" "}
                        {Number(item.price || 0).toLocaleString()}円
                      </p>
                    </div>

                    <p style={{ margin: 0 }}>
                      税抜{" "}
                      {(
                        Number(item.price || 0) *
                        Number(item.quantity || 0)
                      ).toLocaleString()}
                      円
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div style={buttonGrid}>
              {order.status === "注文受付" && (
                <button
                  onClick={() => router.push(`/order-edit/${order.id}`)}
                  style={mainButton}
                >
                  注文内容を修正
                </button>
              )}

              <button
                onClick={() => reorder(order)}
                style={mainButton}
              >
                再注文
              </button>
            </div>
          </div>
        )
      })}
    </main>
  )
}

const pageStyle: React.CSSProperties = {
  maxWidth: 640,
  margin: "0 auto",
  padding: 16,
}

const clinicBox: React.CSSProperties = {
  background: "#f8fafc",
  border: "1px solid #ddd",
  borderRadius: 10,
  padding: 12,
  marginBottom: 12,
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 12,
  marginBottom: 10,
  borderRadius: 10,
  border: "1px solid #ddd",
  boxSizing: "border-box",
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #eee",
  borderRadius: 14,
  padding: 14,
  marginBottom: 14,
  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
}

const cardHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  alignItems: "flex-start",
}

const deliveryNumberStyle: React.CSSProperties = {
  margin: 0,
  fontWeight: "bold",
  fontSize: 16,
}

const smallText: React.CSSProperties = {
  margin: "4px 0",
  fontSize: 12,
  color: "#666",
}

const totalStyle: React.CSSProperties = {
  fontWeight: "bold",
  fontSize: 18,
  margin: "12px 0",
}

function statusBadge(status: string): React.CSSProperties {
  const isDone = status === "納品済み"
  const isCancel = status === "キャンセル"

  return {
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: "bold",
    background: isDone ? "#dcfce7" : isCancel ? "#fee2e2" : "#e0f2fe",
    color: isDone ? "#166534" : isCancel ? "#991b1b" : "#075985",
    whiteSpace: "nowrap",
  }
}

const subButton: React.CSSProperties = {
  width: "100%",
  padding: 12,
  borderRadius: 10,
  border: "1px solid #ddd",
  background: "#fff",
  fontWeight: "bold",
}

const detailBox: React.CSSProperties = {
  marginTop: 12,
  borderTop: "1px solid #eee",
}

const itemRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  padding: "10px 0",
  borderBottom: "1px solid #eee",
}

const buttonGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: 8,
  marginTop: 12,
}

const mainButton: React.CSSProperties = {
  width: "100%",
  padding: 13,
  borderRadius: 10,
  border: "none",
  background: "#111",
  color: "#fff",
  fontWeight: "bold",
}