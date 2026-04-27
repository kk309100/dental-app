"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function AdminPage() {
  const [orders, setOrders] = useState<any[]>([])
  const [orderItems, setOrderItems] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [clinics, setClinics] = useState<any[]>([])
  const [manufacturers, setManufacturers] = useState<any[]>([])

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

    const { data: manufacturersData } = await supabase
      .from("manufacturers")
      .select("*")

    setOrders(ordersData || [])
    setOrderItems(itemsData || [])
    setProducts(productsData || [])
    setClinics(clinicsData || [])
    setManufacturers(manufacturersData || [])
  }

  function getClinicName(clinicId: string) {
    const clinic = clinics.find((c) => c.id === clinicId)
    return clinic ? clinic.name : "不明"
  }

  function getProductName(productId: string) {
    const product = products.find((p) => p.id === productId)
    return product ? product.name : "不明"
  }

  function getManufacturerName(manufacturerId: string) {
    const manufacturer = manufacturers.find((m) => m.id === manufacturerId)
    return manufacturer ? manufacturer.name : "メーカー未設定"
  }

  function getItems(orderId: string) {
    return orderItems.filter((item) => item.order_id === orderId)
  }

  async function updateStatus(orderId: string, status: string) {
    await supabase
      .from("orders")
      .update({ status })
      .eq("id", orderId)

    fetchData()
  }

  const purchaseProducts = products.filter(
    (product) => product.stock <= product.reorder_level
  )

  const groupedPurchaseProducts = purchaseProducts.reduce((acc: any, product) => {
    const makerName = getManufacturerName(product.manufacturer_id)

    if (!acc[makerName]) {
      acc[makerName] = []
    }

    acc[makerName].push(product)
    return acc
  }, {})

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: 20 }}>
      <h1>管理画面</h1>

      <h2>注文管理</h2>

      {orders.length === 0 && <p>注文はありません</p>}

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

          <select
            value={order.status}
            onChange={(e) => updateStatus(order.id, e.target.value)}
            style={{ padding: 10, marginBottom: 12 }}
          >
            <option value="注文受付">注文受付</option>
            <option value="確認中">確認中</option>
            <option value="納品準備中">納品準備中</option>
            <option value="納品済み">納品済み</option>
            <option value="入荷待ち">入荷待ち</option>
            <option value="キャンセル">キャンセル</option>
          </select>

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

      <hr style={{ margin: "30px 0" }} />

      <h2>発注リスト</h2>

      {purchaseProducts.length === 0 && (
        <p>現在、発注が必要な商品はありません</p>
      )}

      {Object.entries(groupedPurchaseProducts).map(([makerName, items]: any) => (
        <div
          key={makerName}
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            padding: 14,
            marginBottom: 12,
            background: "#fafafa",
          }}
        >
          <h3>{makerName}</h3>

          {items.map((product: any) => (
            <div key={product.id} style={{ marginBottom: 10 }}>
              <p>商品名：{product.name}</p>
              <p>現在庫：{product.stock}</p>
              <p>発注基準：{product.reorder_level}</p>
              <p>
                推奨発注数：
                {product.reorder_level * 2 - product.stock}
              </p>
            </div>
          ))}
        </div>
      ))}
    </main>
  )
}