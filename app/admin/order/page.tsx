"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<any[]>([])
  const [orderItems, setOrderItems] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [clinics, setClinics] = useState<any[]>([])

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    const { data: ordersData } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })

    const { data: itemsData } = await supabase.from("order_items").select("*")
    const { data: productsData } = await supabase.from("products").select("*")
    const { data: clinicsData } = await supabase.from("clinics").select("*")

    setOrders(ordersData || [])
    setOrderItems(itemsData || [])
    setProducts(productsData || [])
    setClinics(clinicsData || [])
  }

  function getClinicName(clinicId: string) {
    return clinics.find((c) => c.id === clinicId)?.name || "不明"
  }

  function getProductName(productId: string) {
    return products.find((p) => p.id === productId)?.name || "不明"
  }

  function getItems(orderId: string) {
    return orderItems.filter((item) => item.order_id === orderId)
  }

  async function updateItem(itemId: string, field: "quantity" | "price", value: string) {
    const numberValue = Number(value)

    if (Number.isNaN(numberValue) || numberValue < 0) {
      alert("正しい数字を入力してください")
      return
    }

    const targetItem = orderItems.find((item) => item.id === itemId)
    if (!targetItem) return

    const updatedItem = {
      ...targetItem,
      [field]: numberValue,
    }

    await supabase
      .from("order_items")
      .update({ [field]: numberValue })
      .eq("id", itemId)

    await recalculateOrderTotal(updatedItem.order_id, itemId, updatedItem)
    fetchData()
  }

  async function recalculateOrderTotal(orderId: string, changedItemId?: string, changedItem?: any) {
    const items = orderItems
      .filter((item) => item.order_id === orderId)
      .map((item) => {
        if (changedItemId && item.id === changedItemId) {
          return changedItem
        }
        return item
      })

    const totalPrice = items.reduce(
      (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
      0
    )

    await supabase
      .from("orders")
      .update({ total_price: totalPrice })
      .eq("id", orderId)
  }

  async function updateStatus(orderId: string, status: string) {
    await supabase
      .from("orders")
      .update({ status })
      .eq("id", orderId)

    fetchData()
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 20 }}>
      <h1>注文内容編集</h1>

      {orders.length === 0 && <p>注文はありません</p>}

      {orders.map((order) => (
        <div
          key={order.id}
          style={{
            border: "1px solid #ddd",
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
            background: "#fff",
          }}
        >
          <h2>{getClinicName(order.clinic_id)}</h2>
          <p>注文日時：{order.created_at}</p>
          <p>合計金額：{order.total_price}円</p>

          <select
            value={order.status}
            onChange={(e) => updateStatus(order.id, e.target.value)}
            style={{
              padding: 10,
              marginBottom: 16,
              borderRadius: 8,
              border: "1px solid #ccc",
            }}
          >
            <option value="注文受付">注文受付</option>
            <option value="確認中">確認中</option>
            <option value="納品準備中">納品準備中</option>
            <option value="納品済み">納品済み</option>
            <option value="入荷待ち">入荷待ち</option>
            <option value="キャンセル">キャンセル</option>
          </select>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>商品名</th>
                <th style={thStyle}>数量</th>
                <th style={thStyle}>単価</th>
                <th style={thStyle}>小計</th>
              </tr>
            </thead>

            <tbody>
              {getItems(order.id).map((item) => (
                <tr key={item.id}>
                  <td style={tdStyle}>{getProductName(item.product_id)}</td>

                  <td style={tdStyle}>
                    <input
                      type="number"
                      defaultValue={item.quantity}
                      onBlur={(e) => updateItem(item.id, "quantity", e.target.value)}
                      style={inputStyle}
                    />
                  </td>

                  <td style={tdStyle}>
                    <input
                      type="number"
                      defaultValue={item.price}
                      onBlur={(e) => updateItem(item.id, "price", e.target.value)}
                      style={inputStyle}
                    />
                  </td>

                  <td style={tdStyle}>
                    {Number(item.price || 0) * Number(item.quantity || 0)}円
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </main>
  )
}

const thStyle = {
  border: "1px solid #ddd",
  padding: 8,
  background: "#f5f5f5",
  textAlign: "left" as const,
}

const tdStyle = {
  border: "1px solid #ddd",
  padding: 8,
}

const inputStyle = {
  width: "80px",
  padding: 8,
  borderRadius: 6,
  border: "1px solid #ccc",
}