"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function HistoryPage() {
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

    const { data: itemsData } = await supabase
      .from("order_items")
      .select("*")

    const { data: productsData } = await supabase
      .from("products")
      .select("*")

    const { data: clinicsData } = await supabase
      .from("clinics")
      .select("*")

    setOrders(ordersData || [])
    setOrderItems(itemsData || [])
    setProducts(productsData || [])
    setClinics(clinicsData || [])
  }

  function getClinicName(clinicId: string) {
    const clinic = clinics.find((c) => c.id === clinicId)
    return clinic ? clinic.name : "不明"
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

      {orders.length === 0 && <p>注文履歴はありません</p>}

      {orders.map((order) => (
        <div
          key={order.id}
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            padding: 14,
            marginBottom: 12,
          }}
        >
          <p>医院：{getClinicName(order.clinic_id)}</p>
          <p>金額：{order.total_price}円</p>
          <p>ステータス：{order.status}</p>
          <p>注文日時：{order.created_at}</p>

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