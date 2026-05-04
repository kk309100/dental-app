"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useRouter } from "next/navigation"
import { Html5Qrcode } from "html5-qrcode"

export default function OrderPage() {
  const router = useRouter()

  const [products, setProducts] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [orderItems, setOrderItems] = useState<any[]>([])
  const [cart, setCart] = useState<any[]>([])
  const [clinicId, setClinicId] = useState("")
  const [clinicName, setClinicName] = useState("")
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("すべて")
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [orderComplete, setOrderComplete] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showCartEdit, setShowCartEdit] = useState(false)
  const [lastOrderId, setLastOrderId] = useState("")

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

    await fetchData(profile.clinic_id)
    setLoading(false)
  }

  async function fetchData(targetClinicId: string) {
    const { data: productsData } = await supabase
      .from("products")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true })

    const { data: ordersData } = await supabase
      .from("orders")
      .select("*")
      .eq("clinic_id", targetClinicId)
      .order("created_at", { ascending: false })

    const { data: itemsData } = await supabase.from("order_items").select("*")

    setProducts(productsData || [])
    setOrders(ordersData || [])
    setOrderItems(itemsData || [])
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

  const frequentProducts = useMemo(() => {
    const clinicOrderIds = orders.map((o) => o.id)
    const countMap: Record<string, number> = {}

    orderItems
      .filter((item) => clinicOrderIds.includes(item.order_id))
      .forEach((item) => {
        countMap[item.product_id] =
          (countMap[item.product_id] || 0) + Number(item.quantity || 0)
      })

    return products
      .map((product) => ({
        ...product,
        used_count: countMap[product.id] || 0,
      }))
      .filter((product) => product.used_count > 0)
      .sort((a, b) => b.used_count - a.used_count)
      .slice(0, 8)
  }, [products, orders, orderItems])

  const recentProducts = useMemo(() => {
    const clinicOrderIds = orders.slice(0, 10).map((o) => o.id)

    const recentProductIds = orderItems
      .filter((item) => clinicOrderIds.includes(item.order_id))
      .map((item) => item.product_id)

    const uniqueIds = Array.from(new Set(recentProductIds)).slice(0, 8)

    return uniqueIds
      .map((id) => products.find((p) => p.id === id))
      .filter(Boolean)
  }, [products, orders, orderItems])

  function addToCart(product: any) {
    const existing = cart.find((item) => item.id === product.id)

    if (existing) {
      setCart((prev) =>
        prev.map((item) =>
          item.id === product.id
            ? { ...item, quantity: Number(item.quantity || 0) + 1 }
            : item
        )
      )
    } else {
      setCart((prev) => [...prev, { ...product, quantity: 1 }])
    }

    setOrderComplete(false)
  }

  function decreaseQuantity(productId: string) {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.id !== productId) return item
          return { ...item, quantity: Number(item.quantity || 0) - 1 }
        })
        .filter((item) => Number(item.quantity || 0) > 0)
    )
  }

  function increaseQuantity(productId: string) {
    setCart((prev) =>
      prev.map((item) => {
        if (item.id !== productId) return item
        return { ...item, quantity: Number(item.quantity || 0) + 1 }
      })
    )
  }

  function setCartQuantity(productId: string, value: string) {
    const quantity = Number(value)

    if (Number.isNaN(quantity) || quantity < 0) return

    setCart((prev) =>
      prev
        .map((item) =>
          item.id === productId ? { ...item, quantity } : item
        )
        .filter((item) => Number(item.quantity || 0) > 0)
    )
  }

  function removeFromCart(productId: string) {
    setCart((prev) => prev.filter((item) => item.id !== productId))
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
      (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
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

    const orderItemsData = cart.map((item) => ({
      order_id: order.id,
      product_id: item.id,
      product_name: item.name,
      quantity: item.quantity,
      price: item.price,
    }))

    const { error: itemError } = await supabase
      .from("order_items")
      .insert(orderItemsData)

    if (itemError) {
      console.error(itemError)
      alert("注文明細でエラー")
      return
    }

    setLastOrderId(order.id)
    setCart([])
    setShowConfirm(false)
    setShowCartEdit(false)
    setOrderComplete(true)
    await fetchData(clinicId)
  }

  async function logout() {
    await supabase.auth.signOut()
    router.push("/login")
  }

  const totalPrice = cart.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
    0
  )

  const totalQuantity = cart.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0
  )

  if (loading) return <p style={{ padding: 20 }}>読み込み中...</p>

  return (
    <main style={pageStyle}>
      <style>{`
        @media (min-width: 768px) {
          .order-product-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
          }
          .order-product-grid > * {
            margin-bottom: 0 !important;
          }
        }
      `}</style>
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

        <div style={categoryScroll}>
          {categories.map((c: any) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              style={category === c ? activeCategoryButton : categoryButton}
            >
              {c}
            </button>
          ))}
        </div>

        <button onClick={startScan} style={scanButtonStyle}>
          📷 バーコードで追加
        </button>

        {cart.length > 0 && (
          <div style={topCartStyle}>
            <p style={{ margin: 0, fontWeight: "bold" }}>
              🛒 {totalQuantity}点 / 税抜 {totalPrice.toLocaleString()}円
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button onClick={() => setShowCartEdit(true)} style={subButtonStyle}>
                カート編集
              </button>
              <button onClick={() => setShowConfirm(true)} style={submitButtonStyle}>
                注文確認
              </button>
            </div>
          </div>
        )}
      </div>

      {scanning && <div id="reader" style={{ width: "100%", marginBottom: 16 }} />}

      {orderComplete && (
        <div style={completeStyle}>
          <p style={{ fontWeight: "bold" }}>注文が完了しました</p>

          <button
            onClick={() => router.push(`/order-edit/${lastOrderId}`)}
            style={submitButtonStyle}
          >
            注文内容を修正
          </button>

          <button onClick={() => router.push("/history")} style={submitButtonStyle}>
            注文履歴へ
          </button>
        </div>
      )}

      {frequentProducts.length > 0 && (
        <>
          <h2>よく使う商品</h2>
          <div style={horizontalList}>
            {frequentProducts.map((product) => (
              <MiniProductCard key={product.id} product={product} onAdd={addToCart} />
            ))}
          </div>
        </>
      )}

      {recentProducts.length > 0 && (
        <>
          <h2>最近注文した商品</h2>
          <div style={horizontalList}>
            {recentProducts.map((product: any) => (
              <MiniProductCard key={product.id} product={product} onAdd={addToCart} />
            ))}
          </div>
        </>
      )}

      <h2>商品一覧</h2>

      <div className="order-product-grid">
      {filteredProducts.map((product) => (
        <div key={product.id} style={cardStyle}>
          {product.image_url ? (
            <img src={product.image_url} alt={product.name} style={imageStyle} />
          ) : (
            <div style={noImageStyle}>NO IMAGE</div>
          )}

          <div>
            <p style={productNameStyle}>{product.name}</p>
            <p style={smallText}>商品コード：{product.product_code || "-"}</p>
            <p style={smallText}>メーカー：{product.manufacturer || "-"}</p>
            <p style={priceText}>
              税抜：{Number(product.price || 0).toLocaleString()}円
            </p>
          </div>

          <button onClick={() => addToCart(product)} style={addButtonStyle}>
            ＋ カートに追加
          </button>
        </div>
      ))}
      </div>

      <h2>カート</h2>

      {cart.length === 0 && <p>カートは空です</p>}

      {cart.map((item) => (
        <CartItem
          key={item.id}
          item={item}
          onMinus={decreaseQuantity}
          onPlus={increaseQuantity}
          onRemove={removeFromCart}
          onChangeQuantity={setCartQuantity}
        />
      ))}

      {cart.length > 0 && (
        <div style={bottomCartStyle}>
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <p style={{ margin: 0, fontWeight: "bold" }}>
              🛒 {totalQuantity}点 / 税抜 {totalPrice.toLocaleString()}円
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button onClick={() => setShowCartEdit(true)} style={subButtonStyle}>
                カート編集
              </button>
              <button onClick={() => setShowConfirm(true)} style={submitButtonStyle}>
                注文確認
              </button>
            </div>
          </div>
        </div>
      )}

      {showCartEdit && (
        <Modal>
          <h2>カート編集</h2>

          {cart.length === 0 && <p>カートは空です</p>}

          {cart.map((item) => (
            <CartItem
              key={item.id}
              item={item}
              onMinus={decreaseQuantity}
              onPlus={increaseQuantity}
              onRemove={removeFromCart}
              onChangeQuantity={setCartQuantity}
            />
          ))}

          <button onClick={() => setShowCartEdit(false)} style={submitButtonStyle}>
            戻る
          </button>
        </Modal>
      )}

      {showConfirm && (
        <Modal>
          <h2>注文確認</h2>

          <p>医院：{clinicName}</p>

          {cart.map((item) => (
            <div key={item.id} style={confirmItemStyle}>
              <strong>{item.name}</strong>
              <p style={{ margin: "4px 0" }}>
                {item.quantity}個 × 税抜 {Number(item.price || 0).toLocaleString()}円
              </p>
              <p style={{ margin: 0 }}>
                小計：税抜{" "}
                {(Number(item.price || 0) * Number(item.quantity || 0)).toLocaleString()}円
              </p>
            </div>
          ))}

          <p style={{ fontWeight: "bold", fontSize: 18 }}>
            合計：税抜 {totalPrice.toLocaleString()}円
          </p>

          <button onClick={submitOrder} style={submitButtonStyle}>
            注文確定
          </button>

          <button onClick={() => setShowConfirm(false)} style={subButtonStyle}>
            戻る
          </button>
        </Modal>
      )}
    </main>
  )
}

function MiniProductCard({ product, onAdd }: any) {
  return (
    <div style={miniCardStyle}>
      {product.image_url ? (
        <img src={product.image_url} alt={product.name} style={miniImageStyle} />
      ) : (
        <div style={miniNoImageStyle}>NO IMAGE</div>
      )}
      <p style={{ fontWeight: "bold", fontSize: 12 }}>{product.name}</p>
      <p style={{ fontSize: 12 }}>税抜 {Number(product.price || 0).toLocaleString()}円</p>
      <button onClick={() => onAdd(product)} style={miniAddButtonStyle}>
        ＋
      </button>
    </div>
  )
}

function CartItem({ item, onMinus, onPlus, onRemove, onChangeQuantity }: any) {
  return (
    <div style={cartItemStyle}>
      <div>
        <p style={{ margin: 0, fontWeight: "bold" }}>{item.name}</p>
        <p style={{ margin: 0, fontSize: 12 }}>
          税抜：{Number(item.price || 0).toLocaleString()}円
        </p>
      </div>

      <div style={quantityBoxStyle}>
        <button type="button" onClick={() => onMinus(item.id)} style={qtyBtn}>
          −
        </button>

        <input
          type="number"
          min="0"
          value={item.quantity}
          onChange={(e) => onChangeQuantity(item.id, e.target.value)}
          style={quantityInputStyle}
        />

        <button type="button" onClick={() => onPlus(item.id)} style={qtyBtn}>
          ＋
        </button>

        <button type="button" onClick={() => onRemove(item.id)} style={removeBtn}>
          削除
        </button>
      </div>
    </div>
  )
}

function Modal({ children }: any) {
  return (
    <div style={modalBgStyle}>
      <div style={modalStyle}>{children}</div>
    </div>
  )
}

const pageStyle: React.CSSProperties = {
  maxWidth: 1200,
  margin: "0 auto",
  padding: 16,
  paddingBottom: 180,
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

const categoryScroll: React.CSSProperties = {
  display: "flex",
  overflowX: "auto",
  gap: 8,
  marginBottom: 10,
  paddingBottom: 4,
}

const categoryButton: React.CSSProperties = {
  whiteSpace: "nowrap",
  padding: "8px 12px",
  borderRadius: 999,
  border: "1px solid #ddd",
  background: "#fff",
}

const activeCategoryButton: React.CSSProperties = {
  ...categoryButton,
  background: "#111",
  color: "#fff",
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

const horizontalList: React.CSSProperties = {
  display: "flex",
  overflowX: "auto",
  gap: 10,
  paddingBottom: 8,
}

const miniCardStyle: React.CSSProperties = {
  minWidth: 140,
  background: "#fff",
  border: "1px solid #eee",
  borderRadius: 12,
  padding: 10,
}

const miniImageStyle: React.CSSProperties = {
  width: "100%",
  height: 70,
  objectFit: "cover",
  borderRadius: 8,
}

const miniNoImageStyle: React.CSSProperties = {
  height: 70,
  borderRadius: 8,
  background: "#f1f5f9",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#94a3b8",
  fontSize: 11,
}

const miniAddButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: 8,
  borderRadius: 8,
  border: "none",
  background: "#111",
  color: "#fff",
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 14,
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
  height: 70,
  borderRadius: 8,
  marginBottom: 8,
  background: "#f1f5f9",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#94a3b8",
  fontSize: 12,
}

const productNameStyle: React.CSSProperties = {
  fontWeight: "bold",
  marginBottom: 6,
  fontSize: 15,
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
  padding: 11,
  borderRadius: 10,
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
  gap: 10,
}

const quantityBoxStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  flexShrink: 0,
}

const quantityInputStyle: React.CSSProperties = {
  width: 58,
  height: 38,
  textAlign: "center",
  borderRadius: 8,
  border: "1px solid #ddd",
  fontWeight: "bold",
  fontSize: 16,
}

const qtyBtn: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 8,
  border: "1px solid #ddd",
  background: "#fff",
  fontSize: 20,
  fontWeight: "bold",
  cursor: "pointer",
}

const removeBtn: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #ef4444",
  background: "#fff",
  color: "#ef4444",
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

const subButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: 14,
  marginTop: 8,
  borderRadius: 10,
  background: "#fff",
  color: "#111",
  border: "1px solid #ddd",
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

const modalBgStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  zIndex: 50,
  padding: 16,
  overflowY: "auto",
}

const modalStyle: React.CSSProperties = {
  maxWidth: 680,
  margin: "40px auto",
  background: "#fff",
  borderRadius: 14,
  padding: 16,
}

const confirmItemStyle: React.CSSProperties = {
  borderBottom: "1px solid #eee",
  padding: "10px 0",
}