"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useRouter } from "next/navigation"

export default function OrderPage() {
  const router = useRouter()

  const [products, setProducts] = useState<any[]>([])
  const [clinics, setClinics] = useState<any[]>([])
  const [clinicInventory, setClinicInventory] = useState<any[]>([])
  const [orderItems, setOrderItems] = useState<any[]>([])
  const [cart, setCart] = useState<any[]>([])
  const [selectedClinic, setSelectedClinic] = useState("")
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("すべて")
  const [loading, setLoading] = useState(true)
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

    const { data: inventoryData } = await supabase
      .from("clinic_inventory")
      .select("*")

    const { data: orderItemsData } = await supabase
      .from("order_items")
      .select("*")

    setProducts(productsData || [])
    setClinics(clinicsData || [])
    setClinicInventory(inventoryData || [])
    setOrderItems(orderItemsData || [])
    setLoading(false)
  }

  function getClinicStock(productId: string) {
    const item = clinicInventory.find(
      (i) => i.clinic_id === selectedClinic && i.product_id === productId
    )

    return item ? Number(item.stock || 0) : 0
  }

  function getCartQuantity(productId: string) {
    const item = cart.find((i) => i.id === productId)
    return item ? item.quantity : 0
  }

  const categories = useMemo(() => {
    const list = products
      .map((p) => p.category)
      .filter((c) => c && String(c).trim() !== "")

    return ["すべて", ...Array.from(new Set(list))]
  }, [products])

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const keyword = search.toLowerCase()

      const matchesSearch =
        !keyword ||
        String(product.name || "").toLowerCase().includes(keyword) ||
        String(product.product_code || "").toLowerCase().includes(keyword) ||
        String(product.manufacturer || "").toLowerCase().includes(keyword)

      const matchesCategory =
        category === "すべて" || product.category === category

      return matchesSearch && matchesCategory
    })
  }, [products, search, category])

  const favoriteProducts = useMemo(() => {
    const countMap: any = {}

    orderItems.forEach((item) => {
      countMap[item.product_id] =
        (countMap[item.product_id] || 0) + Number(item.quantity || 0)
    })

    return products
      .map((product) => ({
        ...product,
        ordered_count: countMap[product.id] || 0,
      }))
      .filter((product) => product.ordered_count > 0)
      .sort((a, b) => b.ordered_count - a.ordered_count)
      .slice(0, 10)
  }, [products, orderItems])

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
      (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
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

    const items = cart.map((item) => ({
      order_id: order.id,
      product_id: item.id,
      quantity: item.quantity,
      price: item.price,
    }))

    const { error: itemError } = await supabase
      .from("order_items")
      .insert(items)

    if (itemError) {
      console.error(itemError)
      alert("注文明細でエラー")
      return
    }

    // 在庫はマイナスになってもOKにする
    for (const item of cart) {
      const existing = clinicInventory.find(
        (i) => i.clinic_id === selectedClinic && i.product_id === item.id
      )

      if (existing) {
        await supabase
          .from("clinic_inventory")
          .update({
            stock: Number(existing.stock || 0) - item.quantity,
          })
          .eq("id", existing.id)
      } else {
        await supabase
          .from("clinic_inventory")
          .insert([
            {
              clinic_id: selectedClinic,
              product_id: item.id,
              stock: 0 - item.quantity,
            },
          ])
      }

      await supabase
        .from("products")
        .update({
          stock: Number(item.stock || 0) - item.quantity,
        })
        .eq("id", item.id)
    }

    setCart([])
    setOrderComplete(true)
    fetchData()
  }

  const totalPrice = cart.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
    0
  )

  if (loading) {
    return <p style={{ padding: 20 }}>読み込み中...</p>
  }

  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: 16, paddingBottom: 160 }}>
      <h1>注文</h1>

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
        placeholder="商品名・商品コード・メーカーで検索"
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

      {favoriteProducts.length > 0 && (
        <>
          <h2>よく使う商品</h2>

          {favoriteProducts.map((product) => {
            const stock = selectedClinic ? getClinicStock(product.id) : 0
            const isLow = selectedClinic && stock <= (product.reorder_level ?? 10)

            return (
              <div key={product.id} style={cardStyle(isLow)}>
                <p style={{ fontWeight: "bold" }}>{product.name}</p>
                <p>価格：{product.price}円</p>
                <p style={{ color: isLow ? "red" : "#111" }}>
                  医院在庫：{selectedClinic ? stock : "医院を選択してください"}
                  {isLow && "（不足・少ない）"}
                </p>

                <button
                  onClick={() => addToCart(product)}
                  disabled={!selectedClinic}
                  style={buttonStyle(!selectedClinic)}
                >
                  カートに追加
                </button>
              </div>
            )
          })}
        </>
      )}

      <h2>商品一覧</h2>

      {filteredProducts.map((product) => {
        const stock = selectedClinic ? getClinicStock(product.id) : 0
        const isLow = selectedClinic && stock <= (product.reorder_level ?? 10)

        return (
          <div key={product.id} style={cardStyle(isLow)}>
            <p style={{ fontWeight: "bold" }}>{product.name}</p>
            <p>商品コード：{product.product_code || "-"}</p>
            <p>メーカー：{product.manufacturer || "-"}</p>
            <p>価格：{product.price}円</p>

            <p style={{ color: isLow ? "red" : "#111", fontWeight: isLow ? "bold" : "normal" }}>
              医院在庫：{selectedClinic ? stock : "医院を選択してください"}
              {isLow && "（不足・少ない）"}
            </p>

            <button
              onClick={() => addToCart(product)}
              disabled={!selectedClinic}
              style={buttonStyle(!selectedClinic)}
            >
              カートに追加
            </button>
          </div>
        )
      })}

      <h2>カート</h2>

      {cart.length === 0 && <p>カートは空です</p>}

      {cart.map((item) => (
        <div key={item.id} style={cartStyle}>
          <div>
            <p>{item.name}</p>
            <p>{item.price}円</p>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button onClick={() => updateQuantity(item.id, "minus")}>−</button>
            <span>{item.quantity}</span>
            <button onClick={() => updateQuantity(item.id, "plus")}>＋</button>
          </div>
        </div>
      ))}

      {cart.length > 0 && (
        <div style={footerStyle}>
          <p style={{ fontWeight: "bold" }}>合計：{totalPrice}円</p>

          <button onClick={submitOrder} style={submitButtonStyle}>
            注文確定
          </button>
        </div>
      )}

      {orderComplete && (
        <div style={footerStyle}>
          <p style={{ fontWeight: "bold" }}>注文が完了しました</p>

          <button
            onClick={() => router.push("/history")}
            style={submitButtonStyle}
          >
            注文履歴へ
          </button>
        </div>
      )}
    </main>
  )
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 12,
  marginBottom: 12,
  borderRadius: 10,
  border: "1px solid #ddd",
  boxSizing: "border-box",
}

function cardStyle(isLow: any): React.CSSProperties {
  return {
    background: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
    border: isLow ? "2px solid red" : "1px solid #eee",
  }
}

function buttonStyle(disabled: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: 10,
    borderRadius: 8,
    background: disabled ? "#ccc" : "#111",
    color: "#fff",
    border: "none",
  }
}

const cartStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: 10,
  borderBottom: "1px solid #eee",
}

const footerStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 0,
  left: 0,
  right: 0,
  background: "#fff",
  padding: 16,
  borderTop: "1px solid #ddd",
}

const submitButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: 14,
  borderRadius: 10,
  background: "#111",
  color: "#fff",
  border: "none",
  fontSize: 16,
}