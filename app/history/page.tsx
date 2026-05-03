"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function HistoryPage() {
  const [clinics, setClinics] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [orderItems, setOrderItems] = useState<any[]>([])
  const [selectedClinic, setSelectedClinic] = useState("")

  useEffect(() => {
    fetchBaseData()
  }, [])

  async function fetchBaseData() {
    const { data: clinicsData } = await supabase.from("clinics").select("*")
    const { data: productsData } = await supabase.from("products").select("*")
    const { data: itemsData } = await supabase.from("order_items").select("*")

    setClinics(clinicsData || [])
    setProducts(productsData || [])
    setOrderItems(itemsData || [])
  }

  async function fetchOrders(clinicId: string) {
    setSelectedClinic(clinicId)

    if (!clinicId) {
      setOrders([])
      return
    }

    const { data } = await supabase
      .from("orders")
      .select("*")
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false })

    setOrders(data || [])
  }

  function getProductName(productId: string) {
    return products.find((p) => p.id === productId)?.name || "不明"
  }

  function getItems(orderId: string) {
    return orderItems.filter((item) => item.order_id === orderId)
  }

  return (
    <main style={{ maxWidth: 600, margin: "0 auto", padding: 20 }}>
      <h1>注文履歴</h1>

      <select
        value={selectedClinic}
        onChange={(e) => fetchOrders(e.target.value)}
        style={{
          width: "100%",
          padding: 12,
          marginBottom: 16,
          borderRadius: 10,
          border: "1px solid #ddd",
        }}
      >
        <option value="">医院を選択してください</option>
        {clinics.map((clinic) => (
          <option key={clinic.id} value={clinic.id}>
            {clinic.name}
          </option>
        ))}
      </select>

      {!selectedClinic && <p>医院を選択すると履歴が表示されます。</p>}

      {selectedClinic && orders.length === 0 && (
        <p>この医院の注文履歴はありません。</p>
      )}

      {orders.map((order) => (
        <div
          key={order.id}
          style={{
            background: "#fff",
            borderRadius: 12,
            padding: 14,
            marginBottom: 12,
            boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
          }}
        >
          <p>納品書番号：{order.delivery_number || "-"}</p>
          <p>注文日時：{order.created_at}</p>
          <p>ステータス：{order.status}</p>
          <p>合計：{order.total_price}円</p>

          <h3>明細</h3>

          {getItems(order.id).map((item) => (
            <div key={item.id}>
              <p>
                {getProductName(item.product_id)} × {item.quantity}
              </p>
              <p>小計：{Number(item.price || 0) * Number(item.quantity || 0)}円</p>
            </div>
          ))}
        </div>
      ))}
    </main>
  )
}