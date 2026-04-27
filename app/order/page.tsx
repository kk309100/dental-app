"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function OrderPage() {
  const [products, setProducts] = useState<any[]>([])
  const [cart, setCart] = useState<any[]>([])
  const [clinics, setClinics] = useState<any[]>([])
  const [selectedClinic, setSelectedClinic] = useState("")

  useEffect(() => {
    fetchProducts()
    fetchClinics()
  }, [])

  async function fetchProducts() {
    const { data } = await supabase.from("products").select("*")
    setProducts(data || [])
  }

  async function fetchClinics() {
    const { data } = await supabase.from("clinics").select("*")
    setClinics(data || [])
  }

  function addToCart(product: any) {
    const existing = cart.find((item) => item.id === product.id)

    if (existing) {
      setCart(
        cart.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      )
    } else {
      setCart([...cart, { ...product, quantity: 1 }])
    }
  }

  async function submitOrder() {
    if (!selectedClinic) {
      alert("医院を選択してください")
      return
    }

    if (cart.length === 0) {
      alert("カートが空です")
      return
    }

    const totalPrice = cart.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    )

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert([
        {
          clinic_id: selectedClinic,
          status: "注文受付",
          total_price: totalPrice,
        },
      ])
      .select()
      .single()

    if (orderError) {
      console.error(orderError)
      alert("注文作成でエラー")
      return
    }

    const orderItems = cart.map((item) => ({
      order_id: order.id,
      product_id: item.id,
      quantity: item.quantity,
      price: item.price,
    }))

    const { error: itemError } = await supabase
      .from("order_items")
      .insert(orderItems)

    if (itemError) {
      console.error(itemError)
      alert("注文明細でエラー")
      return
    }

    alert("注文完了")
    setCart([])
  }

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 20 }}>
      <h1>注文画面</h1>

      <select
        value={selectedClinic}
        onChange={(e) => setSelectedClinic(e.target.value)}
        style={{ width: "100%", padding: 12, marginBottom: 16 }}
      >
        <option value="">医院を選択</option>
        {clinics.map((clinic) => (
          <option key={clinic.id} value={clinic.id}>
            {clinic.name}
          </option>
        ))}
      </select>

      <h2>商品一覧</h2>

      {products.map((product) => (
        <div
          key={product.id}
          style={{
            border: "1px solid #ddd",
            padding: 12,
            marginBottom: 12,
            borderRadius: 8,
          }}
        >
          <p>{product.name}</p>
          <p>価格：{product.price}円</p>
          <p>在庫：{product.stock}</p>
          <button onClick={() => addToCart(product)}>カートに入れる</button>
        </div>
      ))}

      <h2>カート</h2>

     {cart.map((item) => (
  <div key={item.id} style={{ marginBottom: 8 }}>
    <p>{item.name} × {item.quantity}</p>

    <button
      onClick={() =>
        setCart(cart.filter((cartItem) => cartItem.id !== item.id))
      }
      style={{
        padding: 8,
        borderRadius: 6,
        border: "1px solid #ccc",
        background: "#fff",
      }}
    >
      カートから削除
    </button>
  </div>
))}
      {cart.length > 0 && (
        <button onClick={submitOrder} style={{ marginTop: 20 }}>
          注文確定
        </button>
      )}
    </main>
  )
}