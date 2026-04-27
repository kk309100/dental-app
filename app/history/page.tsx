"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function HistoryPage() {
  const [clinics, setClinics] = useState<any[]>([])
  const [selectedClinic, setSelectedClinic] = useState("")
  const [orders, setOrders] = useState<any[]>([])
  const [orderItems, setOrderItems] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])

  useEffect(() => {
    fetchClinics()
    fetchProducts()
    fetchOrderItems()
  }, [])

  async function fetchClinics() {
    const { data } = await supabase.from("clinics").select("*")
    setClinics(data || [])
  }

  async function fetchProducts() {
    const { data } = await supabase.from("products").select("*")
    setProducts(data || [])
  }

  async function fetchOrderItems() {
    const { data } = await supabase.from("order_items").select("*")
    setOrderItems(data || [])
  }

  async function fetchOrdersByClinic(clinicId: string) {
    setSelectedClinic(clinicId)

    if (!clinicId) {
      setOrders([])
      return
    }

    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false })

    if (error) {
      console.error(error)
      alert("注文履歴の取得でエラー")
      return
    }

    setOrders(data || [])
  }

  function getProductName(productId: string) {
    const product = products.find((p) => p.id === productId)
    return product ? product.name : "不明"
  }

  function getItems(orderId: string) {
    return orderItems.filter((item) => item.order_id === orderId)
  }

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 20 }}>
      <h1>注文履歴</h1>

      <select
        value={selectedClinic}
        onChange={(e) => fetchOrdersByClinic(e.target.value)}
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

      {!selectedClinic && <p>医院を選択すると注文履歴が表示されます。</p>}

      {selectedClinic && orders.length === 0 && (
        <p>この医院の注文履歴はありません。</p>
      )}

      {orders.map((order) => (
        <div
          key={order.id}
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            padding: 14,
            marginBottom: 12,
            background: "#fff",
          }}
        >
          <p>注文日時：{order.created_at}</p>
          <p>ステータス：{order.status}</p>
          <p>金額：{order.total_price}円</p>

          <h3>明細</h3>

          {getItems(order.id).map((item) => (
            <div key={item.id}>
              <p>
                {getProductName(item.product_id)} × {item.quantity}
              </p>
              <p>小計：{item.price * item.quantity}円</p>
            </div>
          ))}
        </div>
      ))}
    </main>
  )
}