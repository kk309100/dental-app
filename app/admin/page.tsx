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

    const { data: itemsData } = await supabase.from("order_items").select("*")
    const { data: productsData } = await supabase.from("products").select("*")
    const { data: clinicsData } = await supabase.from("clinics").select("*")
    const { data: manufacturersData } = await supabase.from("manufacturers").select("*")

    setOrders(ordersData || [])
    setOrderItems(itemsData || [])
    setProducts(productsData || [])
    setClinics(clinicsData || [])
    setManufacturers(manufacturersData || [])
  }

  function getClinicName(id: string) {
    return clinics.find((c) => c.id === id)?.name || "不明"
  }

  function getProduct(id: string) {
    return products.find((p) => p.id === id)
  }

  function getManufacturerName(id: string) {
    return manufacturers.find((m) => m.id === id)?.name || "未設定"
  }

  function getItems(orderId: string) {
    return orderItems.filter((i) => i.order_id === orderId)
  }

  // =========================
  // 納品・発注の分岐ロジック
  // =========================

  const deliveryList: any[] = []
  const purchaseList: any[] = []

  orders.forEach((order) => {
    getItems(order.id).forEach((item) => {
      const product = getProduct(item.product_id)
      if (!product) return

      if (product.stock >= item.quantity) {
        deliveryList.push({
          ...item,
          product,
          clinic_id: order.clinic_id,
        })
      } else {
        purchaseList.push({
          ...item,
          product,
        })
      }
    })
  })

  // メーカー別にまとめる
  const groupedPurchase = purchaseList.reduce((acc: any, item) => {
    const maker = getManufacturerName(item.product.manufacturer_id)
    if (!acc[maker]) acc[maker] = []
    acc[maker].push(item)
    return acc
  }, {})

  return (
    <main style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
      <h1>管理画面</h1>

      {/* ================= 納品書 ================= */}
      <h2>納品書（在庫あり）</h2>

      {deliveryList.length === 0 && <p>納品可能な商品はありません</p>}

      {deliveryList.map((item, index) => (
        <div key={index} style={{ borderBottom: "1px solid #ddd", marginBottom: 10 }}>
          <p>医院：{getClinicName(item.clinic_id)}</p>
          <p>商品：{item.product.name}</p>
          <p>数量：{item.quantity}</p>
        </div>
      ))}

      <hr style={{ margin: "30px 0" }} />

      {/* ================= 発注書 ================= */}
      <h2>発注書（メーカー別）</h2>

      {Object.keys(groupedPurchase).length === 0 && (
        <p>発注が必要な商品はありません</p>
      )}

      {Object.entries(groupedPurchase).map(([maker, items]: any) => (
        <div key={maker} style={{ marginBottom: 20, border: "1px solid #ddd", padding: 10 }}>
          <h3>{maker}</h3>

          {items.map((item: any, i: number) => (
            <div key={i}>
              <p>商品：{item.product.name}</p>
              <p>不足数：{item.quantity - item.product.stock}</p>
            </div>
          ))}
        </div>
      ))}
    </main>
  )
}