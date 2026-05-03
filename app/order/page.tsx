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

  function normalizeText(value: any) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKC")
      .replace(/\s+/g, "")
  }

  const categories = useMemo(() => {
    const list = products
      .map((p) => p.category)
      .filter((c) => c && String(c).trim() !== "")

    return ["すべて", ...Array.from(new Set(list))]
  }, [products])

  const filteredProducts = useMemo(() => {
    const keyword = normalizeText(search)

    return products.filter((p) => {
      const target = normalizeText(
        `${p.name || ""} ${p.product_code || ""} ${p.manufacturer || ""} ${p.barcode || ""}`
      )

      const matchSearch = !keyword || target.includes(keyword)
      const matchCategory = category === "すべて" || p.category === category

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
          (p) =>
            String(p.barcode || "") === decodedText ||
            String(p.product_code || "") === decodedText
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

    const deliveryNumber = await generateDeliveryNumber()

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert([
        {
          clinic_id: clinicId,
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
      product_name: item.name,
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

  async function logout() {
    await supabase.auth.signOut()
    router.push("/login")
  }

  const totalPrice = cart.reduce(
    (sum, item) => sum + Number(item.price || 0) * item.quantity,
    0
  )

  const totalQuantity = cart.reduce((sum, item) => sum + item.quantity, 0)

  if (loading) return <p style={{ padding: 20 }}>読み込み中...</p>

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 16, paddingBottom: 170 }}>
      <button onClick={logout} style={logoutButton}>
        ログアウト
      </button>

      <h1>注文</h1>

      <div style={clinicBox}>
        <p style={{ margin: 0, fontSize: 12 }}>ログイン医院</p>
        <strong>{clinicName}</strong>
      </div>

      <div style={stickyArea}>
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
              🛒 {totalQuantity}点 / 税抜 {totalPrice.toLocaleString()}円
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
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
              style={imageStyle}
            />
          ) : (
            <div style={noImageStyle}>NO IMAGE</div>
          )}

          <p style={{ fontWeight: "bold", marginBottom: 6 }}>{product.name}</p>
          <p style={smallText}>商品コード：{product.product_code || "-"}</p>
          <p style={smallText}>メーカー：{product.manufacturer || "-"}</p>
          <p style={priceText}>税抜：{Number(product.price || 0).toLocaleString()}円</p>

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
            <p style={{ margin: 0, fontWeight: "bold" }}>{item.name}</p>
            <p style={{ margin: 0, fontSize: 12 }}>
              税抜：{Number(item.price || 0).toLocaleString()}円
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
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
        <div style={bottomCartStyle}>
          <p style={{ margin: 0, fontWeight: "bold" }}>
            🛒 {totalQuantity}点 / 税抜 {totalPrice.toLocaleString()}円
          </p>

          <button onClick={submitOrder} style={submitButtonStyle}>
            注文確定
          </button>
        </div>
      )}
    </main>
  )
}

const logoutButton: React.CSSProperties = {
  marginBottom: 12,
  padding: 8,
  borderRadius: 8,
  border: "1px solid #ddd",
  background: "#fff",
}

const clinicBox: React.CSSProperties = {
  background: "#f8fafc",
  border: "1px solid #ddd",
  borderRadius: 10,
  padding: 12,
  marginBottom: 12,
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

const imageStyle: React.CSSProperties = {
  width: "100%",
  height: 130,
  objectFit: "cover",
  borderRadius: 8,
  marginBottom: 8,
}

const noImageStyle: React.CSSProperties = {
  height: 80,
  borderRadius: 8,
  marginBottom: 8,
  background: "#f1f5f9",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#94a3b8",
  fontSize: 12,
}

const smallText: React.CSSProperties = {
  margin: "2px 0",
  fontSize: 12,
  color: "#555",
}

const priceText: React.CSSProperties = {
  margin: "6px 0",
  fontWeight: "bold",
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

const qtyBtn: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 8,
  border: "1px solid #ddd",
  background: "#fff",
  fontSize: 18,
  fontWeight: "bold",
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