"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function AdminPage() {
  const [orders, setOrders] = useState<any[]>([])
  const [orderItems, setOrderItems] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [clinics, setClinics] = useState<any[]>([])

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    const { data: ordersData } = await supabase
      .from("命令")
      .select("*")
      .order("created_at", { ascending: false })

    const { data: itemsData } = await supabase
      .from("order_items")
      .select("*")

    const { data: productsData } = await supabase
      .from("製品")
      .select("*")

    const { data: clinicsData } = await supabase
      .from("クリニック")
      .select("*")

    setOrders(ordersData || [])
    setOrderItems(itemsData || [])
    setProducts(productsData || [])
    setClinics(clinicsData || [])
  }

  function getClinicName(clinic_id: string) {
    const clinic = clinics.find(c => c.id === clinic_id)
    return clinic?.名称 || "不明"
  }

  function getProductName(product_id: string) {
    const product = products.find(p => p.id === product_id)
    return product?.名称 || "不明"
  }

  function getOrderItems(order_id: string) {
    return orderItems.filter(item => item.order_id === order_id)
  }

  async function updateStatus(id: string, status: string) {
    await supabase
      .from("命令")
      .update({ 状況: status })
      .eq("id", id)

    fetchData()
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>管理画面</h2>

      {orders.map(order => (
        <div key={order.id} style={{ border: "1px solid #ccc", margin: 10, padding: 10 }}>
          
          <div>医院：{getClinicName(order.clinic_id)}</div>
          <div>金額：{order.合計金額}円</div>
          <div>ステータス：{order.状況}</div>

          <select
            value={order.状況}
            onChange={(e) => updateStatus(order.id, e.target.value)}
          >
            <option value="注文受付">注文受付</option>
            <option value="確認中">確認中</option>
            <option value="納品済み">納品済み</option>
          </select>

          <div style={{ marginTop: 10 }}>
            <strong>明細</strong>
            {getOrderItems(order.id).map(item => (
              <div key={item.id}>
                {getProductName(item.product_id)} × {item.数量}
              </div>
            ))}
          </div>

        </div>
      ))}
    </div>
  )
}