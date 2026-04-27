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
      if (existing.quantity >= product.stock) {
        alert("在庫数を超えています")
        return
      }

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

  function updateQuantity(productId: string, type: "plus" | "minus") {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.id !== productId) return item

          if (type === "plus") {
            if (item.quantity >= item.stock) {
              alert("在庫数を超えています")
              return item
            }

            return { ...item, quantity: item.quantity + 1 }
          }

          return { ...item, quantity: item.quantity - 1 }
        })
        .filter((item) => item.quantity > 0)
    )
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

    for (const item of cart) {
      await supabase
        .from("products")
        .update({
          stock: item.stock - item.quantity,
        })
        .eq("id", item.id)
    }

    alert("注文完了")
    setCart([])
    fetchProducts()
  }

  const totalPrice = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  )

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 16, paddingBottom: 140 }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>注文</h1>

      <select
        value={selectedClinic}
        onChange={(e) => setSelectedClinic(e.target.value)}
        style={{
          width: "100%",
          padding: 12,
          marginBottom: 16,
          borderRadius: 10,
          border: "1px solid #ddd",
        }}
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
            background: "#fff",
            borderRadius: 12,
            padding: 14,
            marginBottom: 12,
            boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
          }}
        >
          <p style={{ fontWeight: "bold" }}>{product.name}</p>
          <p>{product.price}円</p>
          <p>在庫：{product.stock}</p>

          <button
            onClick={() => addToCart(product)}
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 8,
              background: "#111",
              color: "#fff",
              border: "none",
            }}
          >
            カートに追加
          </button>
        </div>
      ))}

      <h2>カート</h2>

      {cart.length === 0 && <p>カートは空です</p>}

      {cart.map((item) => (
        <div
          key={item.id}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: 10,
            borderBottom: "1px solid #eee",
          }}
        >
          <div>
            <p>{item.name}</p>
            <p>{item.price}円</p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => updateQuantity(item.id, "minus")}>−</button>
            <span>{item.quantity}</span>
            <button onClick={() => updateQuantity(item.id, "plus")}>＋</button>
          </div>
        </div>
      ))}

      {cart.length > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            background: "#fff",
            padding: 16,
            borderTop: "1px solid #ddd",
          }}
        >
          <p style={{ fontWeight: "bold" }}>合計：{totalPrice}円</p>

          <button
            onClick={submitOrder}
            style={{
              width: "100%",
              padding: 14,
              borderRadius: 10,
              background: "#111",
              color: "#fff",
              border: "none",
              fontSize: 16,
            }}
          >
            注文確定
          </button>
        </div>
      )}
    </main>
  )
}