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

  function updateQuantity(productId: string, type: "plus" | "minus") {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.id === productId) {
            const newQuantity =
              type === "plus" ? item.quantity + 1 : item.quantity - 1
            return { ...item, quantity: newQuantity }
          }
          return item
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

    // ① 注文作成
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

    // ② 注文明細
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

    // 🔥 ③ 在庫更新（ここが今回の追加）
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
    fetchProducts() // 在庫再取得
  }

  const totalPrice = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  )

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
        <div key={product.id} style={{ border: "1px solid #ddd", padding: 12, marginBottom: 12 }}>
          <p>{product.name}</p>
          <p>価格：{product.price}円</p>
          <p>在庫：{product.stock}</p>

          <button onClick={() => addToCart(product)}>
            カートに入れる
          </button>
        </div>
      ))}

      <h2>カート</h2>

      {cart.map((item) => (
        <div key={item.id} style={{ display: "flex", justifyContent: "space-between" }}>
          <p>{item.name}</p>

          <div>
            <button onClick={() => updateQuantity(item.id, "minus")}>−</button>
            <span>{item.quantity}</span>
            <button onClick={() => updateQuantity(item.id, "plus")}>＋</button>
          </div>
        </div>
      ))}

      {cart.length > 0 && (
        <>
          <p>合計：{totalPrice}円</p>
          <button onClick={submitOrder}>注文確定</button>
        </>
      )}
    </main>
  )
}