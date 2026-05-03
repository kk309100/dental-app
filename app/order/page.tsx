"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useRouter } from "next/navigation"
import { Html5Qrcode } from "html5-qrcode"

export default function OrderPage() {
  const router = useRouter()

  const [products, setProducts] = useState<any[]>([])
  const [cart, setCart] = useState<any[]>([])
  const [clinicId, setClinicId] = useState("")
  const [clinicName, setClinicName] = useState("")
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("すべて")
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [orderComplete, setOrderComplete] = useState(false)

  useEffect(() => {
    checkLogin()
  }, [])

  async function checkLogin() {
    const { data: userData } = await supabase.auth.getUser()

    if (!userData.user) {
      router.push("/login")
      return
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userData.user.id)
      .single()

    if (!profile) {
      router.push("/login")
      return
    }

    if (profile.role === "admin") {
      router.push("/admin")
      return
    }

    setClinicId(profile.clinic_id)

    const { data: clinic } = await supabase
      .from("clinics")
      .select("*")
      .eq("id", profile.clinic_id)
      .single()

    setClinicName(clinic?.name || "")

    await fetchProducts()
    setLoading(false)
  }

  async function fetchProducts() {
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true })

    setProducts(data || [])
  }

  const categories = useMemo(() => {
    const list = products
      .map((p) => p.category)
      .filter((c) => c && String(c).trim() !== "")

    return ["すべて", ...Array.from(new Set(list))]
  }, [products])

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const keyword = search.toLowerCase()

      const matchSearch =
        !keyword ||
        String(p.name || "").toLowerCase().includes(keyword) ||
        String(p.product_code || "").toLowerCase().includes(keyword) ||
        String(p.manufacturer || "").toLowerCase().includes(keyword) ||
        String(p.barcode || "").toLowerCase().includes(keyword)

      const matchCategory =
        category === "すべて" || p.category === category

      return matchSearch && matchCategory
    })
  }, [products, search, category])

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

  // 🔥 ここが重要（マイナス対応）
  function updateQuantity(productId: string, type: "plus" | "minus") {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.id !== productId) return item

          let quantity = item.quantity

          if (type === "plus") quantity += 1
          else quantity -= 1

          return { ...item, quantity }
        })
        .filter((item) => item.quantity > 0)
    )
  }

  async function startScan() {
    setScanning(true)

    const scanner = new Html5Qrcode("reader")

    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 220 },
      async (decodedText) => {
        await scanner.stop()
        setScanning(false)

        const product = products.find(
          (p) => String(p.barcode) === decodedText
        )

        if (!product) {
          alert("商品が見つかりません")
          return
        }

        addToCart(product)
      },
      () => {}
    )
  }

  async function submitOrder() {
    if (!clinicId) {
      alert("医院情報がありません")
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

    const { data: order } = await supabase
      .from("orders")
      .insert([
        {
          clinic_id: clinicId,
          status: "注文受付",
          total_price: totalPrice,
        },
      ])
      .select()
      .single()

    const orderItems = cart.map((item) => ({
      order_id: order.id,
      product_id: item.id,
      product_name: item.name,
      quantity: item.quantity,
      price: item.price,
    }))

    await supabase.from("order_items").insert(orderItems)

    setCart([])
    setOrderComplete(true)
  }

  const totalPrice = cart.reduce(
    (sum, item) => sum + Number(item.price || 0) * item.quantity,
    0
  )

  const totalQuantity = cart.reduce(
    (sum, item) => sum + item.quantity,
    0
  )

  if (loading) return <p>読み込み中...</p>

  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: 16, paddingBottom: 120 }}>
      <h1>注文</h1>

      <p>医院：{clinicName}</p>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="検索"
        style={input}
      />

      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        style={input}
      >
        {categories.map((c: any) => (
          <option key={c}>{c}</option>
        ))}
      </select>

      <button onClick={startScan} style={scanBtn}>
        📷 バーコードで追加
      </button>

      {scanning && <div id="reader" />}

      <h2>商品</h2>

      {filteredProducts.map((p) => (
        <div key={p.id} style={card}>
          <p>{p.name}</p>
          <button onClick={() => addToCart(p)}>追加</button>
        </div>
      ))}

      <h2>カート</h2>

      {cart.length === 0 && <p>カートは空です</p>}

      {cart.map((item) => (
        <div key={item.id} style={cartItem}>
          <span>{item.name}</span>

          <div>
            <button onClick={() => updateQuantity(item.id, "minus")} style={qtyBtn}>
              −
            </button>

            <span>{item.quantity}</span>

            <button onClick={() => updateQuantity(item.id, "plus")} style={qtyBtn}>
              ＋
            </button>
          </div>
        </div>
      ))}

      {cart.length > 0 && (
        <div style={fixed}>
          <p>
            {totalQuantity}点 / {totalPrice}円
          </p>
          <button onClick={submitOrder}>注文確定</button>
        </div>
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

const cartItem = {
  display: "flex",
  justifyContent: "space-between",
  marginBottom: 10,
}

const qtyBtn = {
  width: 32,
  height: 32,
  margin: "0 5px",
}

const scanBtn = {
  width: "100%",
  padding: 12,
  background: "#0ea5e9",
  color: "#fff",
}

const fixed = {
  position: "fixed" as const,
  bottom: 0,
  left: 0,
  right: 0,
  background: "#fff",
  padding: 10,
}