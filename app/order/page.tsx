"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useRouter } from "next/navigation"
import { Html5Qrcode } from "html5-qrcode"

export default function OrderPage() {
  const router = useRouter()

  const [products, setProducts] = useState<any[]>([])
  const [cart, setCart] = useState<any[]>([])
  const [clinics, setClinics] = useState<any[]>([])
  const [selectedClinic, setSelectedClinic] = useState("")
  const [loading, setLoading] = useState(true)
  const [orderComplete, setOrderComplete] = useState(false)

  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("すべて")

  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    const { data: productsData } = await supabase.from("products").select("*")
    const { data: clinicsData } = await supabase.from("clinics").select("*")

    setProducts(productsData || [])
    setClinics(clinicsData || [])
    setLoading(false)
  }

  function handleBarcode(code: string) {
    const product = products.find((p) => p.barcode === code)

    if (!product) {
      alert("商品が見つかりません")
      return
    }

    addToCart(product)
  }

  async function startScan() {
    setScanning(true)

    const scanner = new Html5Qrcode("reader")

    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 200 },
      async (decodedText) => {
        await scanner.stop()
        setScanning(false)

        handleBarcode(decodedText)
      }
    )
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

    setOrderComplete(false)
  }

  function updateQuantity(productId: string, type: "plus" | "minus") {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.id !== productId) return item

          const quantity =
            type === "plus" ? item.quantity + 1 : item.quantity - 1

          return { ...item, quantity }
        })
        .filter((item) => item.quantity > 0)
    )
  }

  async function generateDeliveryNumber() {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, "0")
    const d = String(now.getDate()).padStart(2, "0")
    const dateStr = `${y}${m}${d}`

    const { data } = await supabase
      .from("orders")
      .select("id")
      .gte("created_at", `${y}-${m}-${d}T00:00:00`)
      .lte("created_at", `${y}-${m}-${d}T23:59:59`)

    const count = (data?.length || 0) + 1

    return `DN-${dateStr}-${String(count).padStart(4, "0")}`
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
      (sum, item) => sum + Number(item.price || 0) * item.quantity,
      0
    )

    const deliveryNumber = await generateDeliveryNumber()

    const { data: order } = await supabase
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

    const items = cart.map((item) => ({
      order_id: order.id,
      product_id: item.id,
      quantity: item.quantity,
      price: item.price,
    }))

    await supabase.from("order_items").insert(items)

    setCart([])
    setOrderComplete(true)
  }

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const keyword = search.toLowerCase()

      return (
        (!keyword ||
          p.name?.toLowerCase().includes(keyword) ||
          p.product_code?.toLowerCase().includes(keyword)) &&
        (category === "すべて" || p.category === category)
      )
    })
  }, [products, search, category])

  if (loading) return <p>読み込み中...</p>

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 16 }}>

      <h1>注文</h1>

      {/* スキャンボタン */}
      <button onClick={startScan} style={scanBtn}>
        📷 バーコードで追加
      </button>

      {/* カメラ */}
      {scanning && <div id="reader" style={{ marginBottom: 16 }} />}

      <select
        value={selectedClinic}
        onChange={(e) => setSelectedClinic(e.target.value)}
        style={input}
      >
        <option value="">医院を選択</option>
        {clinics.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <input
        placeholder="検索"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={input}
      />

      <h2>商品</h2>

      {filteredProducts.map((p) => (
        <div key={p.id} style={card}>
          <p>{p.name}</p>
          <button onClick={() => addToCart(p)}>追加</button>
        </div>
      ))}

      <h2>カート</h2>

      {cart.map((item) => (
        <div key={item.id}>
          {item.name} × {item.quantity}
        </div>
      ))}

      {cart.length > 0 && (
        <button onClick={submitOrder} style={submitBtn}>
          注文確定
        </button>
      )}

      {orderComplete && (
        <button onClick={() => router.push("/history")}>
          注文履歴へ
        </button>
      )}
    </main>
  )
}

const input = {
  width: "100%",
  padding: 10,
  marginBottom: 10,
}

const card = {
  padding: 10,
  border: "1px solid #ddd",
  marginBottom: 10,
}

const submitBtn = {
  width: "100%",
  padding: 14,
  background: "#111",
  color: "#fff",
}

const scanBtn = {
  width: "100%",
  padding: 14,
  marginBottom: 12,
  background: "#0ea5e9",
  color: "#fff",
  border: "none",
}