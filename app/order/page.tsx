"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useRouter } from "next/navigation"

export default function OrderPage() {
  const router = useRouter()

  const [products, setProducts] = useState<any[]>([])
  const [cart, setCart] = useState<any[]>([])
  const [clinics, setClinics] = useState<any[]>([])
  const [clinicInventory, setClinicInventory] = useState<any[]>([])
  const [selectedClinic, setSelectedClinic] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkUser()
  }, [])

  async function checkUser() {
    const { data } = await supabase.auth.getUser()

    if (!data.user) {
      router.push("/login")
      return
    }

    await fetchProducts()
    await fetchClinics()
    await fetchClinicInventory()
    setLoading(false)
  }

  async function fetchProducts() {
    const { data } = await supabase.from("products").select("*")
    setProducts(data || [])
  }

  async function fetchClinics() {
    const { data } = await supabase.from("clinics").select("*")
    setClinics(data || [])
  }

  async function fetchClinicInventory() {
    const { data } = await supabase.from("clinic_inventory").select("*")
    setClinicInventory(data || [])
  }

  function getClinicStock(productId: string) {
    const item = clinicInventory.find(
      (i) => i.clinic_id === selectedClinic && i.product_id === productId
    )
    return item ? item.stock : 0
  }

  function getCartQuantity(productId: string) {
    const item = cart.find((i) => i.id === productId)
    return item ? item.quantity : 0
  }

  async function generateDeliveryNumber() {
    const today = new Date()
    const y = today.getFullYear()
    const m = String(today.getMonth() + 1).padStart(2, "0")
    const d = String(today.getDate()).padStart(2, "0")
    const dateStr = `${y}${m}${d}`

    const { data } = await supabase
      .from("orders")
      .select("id")
      .gte("created_at", `${y}-${m}-${d}T00:00:00`)
      .lte("created_at", `${y}-${m}-${d}T23:59:59`)

    const count = (data?.length || 0) + 1
    const seq = String(count).padStart(4, "0")

    return `DN-${dateStr}-${seq}`
  }

  function addToCart(product: any) {
    if (!selectedClinic) {
      alert("先に医院を選択してください")
      return
    }

    const clinicStock = getClinicStock(product.id)
    const currentQuantity = getCartQuantity(product.id)

    if (clinicStock <= 0) {
      alert("医院在庫がありません")
      return
    }

    if (currentQuantity >= clinicStock) {
      alert("在庫を超えています")
      return
    }

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
          if (item.id !== productId) return item

          if (type === "plus") {
            const clinicStock = getClinicStock(productId)

            if (item.quantity >= clinicStock) {
              alert("在庫を超えています")
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

    for (const item of cart) {
      const stock = getClinicStock(item.id)
      if (item.quantity > stock) {
        alert(`${item.name} の在庫不足`)
        return
      }
    }

    const totalPrice = cart.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    )

    const deliveryNumber = await generateDeliveryNumber()

    const { data: order, error } = await supabase
      .from("orders")
      .insert([
        {
          clinic_id: selectedClinic,
          status: "注文受付",
          total_price: totalPrice,
          delivery_number: deliveryNumber,
        },
      ])
      .select()
      .single()

    if (error) {
      alert("注文エラー")
      return
    }

    const orderItems = cart.map((item) => ({
      order_id: order.id,
      product_id: item.id,
      quantity: item.quantity,
      price: item.price,
    }))

    await supabase.from("order_items").insert(orderItems)

    // 在庫減算
    for (const item of cart) {
      await supabase
        .from("products")
        .update({ stock: item.stock - item.quantity })
        .eq("id", item.id)

      const existing = clinicInventory.find(
        (i) => i.clinic_id === selectedClinic && i.product_id === item.id
      )

      if (existing) {
        await supabase
          .from("clinic_inventory")
          .update({
            stock: existing.stock - item.quantity,
          })
          .eq("id", existing.id)
      }
    }

    alert(`注文完了\n${deliveryNumber}`)

    // 🔥 ここが重要（遷移防止）
    setCart([])
    setTimeout(() => {
      window.location.reload()
    }, 300)
  }

  async function logout() {
    await supabase.auth.signOut()
    router.push("/login")
  }

  if (loading) return <p>読み込み中...</p>

  const totalPrice = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  )

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 16 }}>
      <button onClick={logout}>ログアウト</button>

      <h1>注文</h1>

      <select
        value={selectedClinic}
        onChange={(e) => setSelectedClinic(e.target.value)}
      >
        <option value="">医院を選択</option>
        {clinics.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <h2>商品</h2>

      {products.map((p) => {
        const stock = getClinicStock(p.id)
        const low = stock <= (p.reorder_level ?? 10)

        return (
          <div key={p.id} style={{ border: low ? "2px solid red" : "1px solid #ddd", marginBottom: 10 }}>
            <p>{p.name}</p>
            <p>在庫：{stock}</p>

            <button disabled={stock <= 0} onClick={() => addToCart(p)}>
              {stock <= 0 ? "在庫なし" : "追加"}
            </button>
          </div>
        )
      })}

      <h2>カート</h2>

      {cart.map((item) => (
        <div key={item.id}>
          {item.name} × {item.quantity}
        </div>
      ))}

      {cart.length > 0 && (
        <button onClick={submitOrder}>
          注文確定（{totalPrice}円）
        </button>
      )}
    </main>
  )
}