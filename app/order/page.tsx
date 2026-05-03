"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useRouter } from "next/navigation"
import { Html5Qrcode } from "html5-qrcode"

export default function OrderPage() {
  const router = useRouter()

  const [products, setProducts] = useState<any[]>([])
  const [clinics, setClinics] = useState<any[]>([])
  const [cart, setCart] = useState<any[]>([])
  const [selectedClinic, setSelectedClinic] = useState("")
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("すべて")
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [orderComplete, setOrderComplete] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    const { data: productsData } = await supabase
      .from("products")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true })

    const { data: clinicsData } = await supabase
      .from("clinics")
      .select("*")
      .order("name", { ascending: true })

    setProducts(productsData || [])
    setClinics(clinicsData || [])
    setLoading(false)
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
    if (!selectedClinic) {
      alert("医院を選択してください")
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

    const { data: order, error: orderError } = await supabase
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

  if (loading) return <p style={{ padding: 20 }}>読み込み中...</p>

  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: 16, paddingBottom: 140 }}>
      <h1>注文</h1>

      <div style={stickyArea}>
        <select
          value={selectedClinic}
          onChange={(e) => {
            setSelectedClinic(e.target.value)
            setCart([])
            setOrderComplete(false)
          }}
          style={inputStyle}
        >
          <option value="">医院を選択</option>
          {clinics.map((clinic) => (
            <option key={clinic.id} value={clinic.id}>
              {clinic.name}
            </option>
          ))}
        </select>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="商品名・コード・メーカーで検索"
          style={inputStyle}
        />

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={inputStyle}
        >
          {categories.map((c: any) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <button onClick={startScan} style={scanButtonStyle}>
          📷 バーコードで追加
        </button>

        {cart.length > 0 && (
          <div style={topCartStyle}>
            <p style={{ margin: 0, fontWeight: "bold" }}>
              🛒 {totalQuantity}点 / {totalPrice}円
            </p>

            <button onClick={submitOrder} style={submitButtonStyle}>
              注文確定
            </button>
          </div>
        )}
      </div>

      {scanning && (
        <div id="reader" style={{ width: "100%", marginBottom: 16 }} />
      )}

      {orderComplete && (
        <div style={completeStyle}>
          <p style={{ fontWeight: "bold" }}>注文が完了しました</p>
          <button
            onClick={() => router.push("/history")}
            style={submitButtonStyle}
          >
            注文履歴へ
          </button>
        </div>
      )}

      <h2>商品一覧</h2>

      {filteredProducts.map((product) => (
        <div key={product.id} style={cardStyle}>
          <p style={{ fontWeight: "bold" }}>{product.name}</p>
          <p>商品コード：{product.product_code || "-"}</p>
          <p>メーカー：{product.manufacturer || "-"}</p>
          <p>価格：{product.price || 0}円</p>

          <button
            onClick={() => addToCart(product)}
            style={addButtonStyle}
          >
            ＋ カートに追加
          </button>
        </div>
      ))}

      <h2>カート</h2>

      {cart.length === 0 && <p>カートは空です</p>}

      {cart.map((item) => (
        <div key={item.id} style={cartItemStyle}>
          <div>
            <p style={{ margin: 0 }}>{item.name}</p>
            <p style={{ margin: 0, fontSize: 12 }}>{item.price}円</p>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button onClick={() => updateQuantity(item.id, "minus")}>−</button>
            <span>{item.quantity}</span>
            <button onClick={() => updateQuantity(item.id, "plus")}>＋</button>
          </div>
        </div>
      ))}

      {cart.length > 0 && (
        <div style={bottomCartStyle}>
          <p style={{ margin: 0, fontWeight: "bold" }}>
            🛒 {totalQuantity}点 / {totalPrice}円
          </p>

          <button onClick={submitOrder} style={submitButtonStyle}>
            注文確定
          </button>
        </div>
      )}
    </main>
  )
}

const stickyArea: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 10,
  background: "#fff",
  paddingBottom: 12,
  borderBottom: "1px solid #eee",
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 12,
  marginBottom: 10,
  borderRadius: 10,
  border: "1px solid #ddd",
  boxSizing: "border-box",
}

const scanButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: 14,
  marginBottom: 10,
  borderRadius: 10,
  background: "#0ea5e9",
  color: "#fff",
  border: "none",
  fontWeight: "bold",
}

const topCartStyle: React.CSSProperties = {
  background: "#f8fafc",
  border: "1px solid #ddd",
  borderRadius: 12,
  padding: 12,
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 14,
  marginBottom: 12,
  boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
  border: "1px solid #eee",
}

const addButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  borderRadius: 8,
  background: "#111",
  color: "#fff",
  border: "none",
}

const cartItemStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: 10,
  borderBottom: "1px solid #eee",
}

const bottomCartStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 0,
  left: 0,
  right: 0,
  background: "#fff",
  padding: 14,
  borderTop: "1px solid #ddd",
  zIndex: 20,
}

const submitButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: 14,
  marginTop: 8,
  borderRadius: 10,
  background: "#111",
  color: "#fff",
  border: "none",
  fontSize: 16,
  fontWeight: "bold",
}

const completeStyle: React.CSSProperties = {
  background: "#ecfdf5",
  border: "1px solid #10b981",
  borderRadius: 12,
  padding: 14,
  marginBottom: 16,
}