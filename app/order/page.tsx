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
  const [showCart, setShowCart] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showComplete, setShowComplete] = useState(false)
  const [lastOrderId, setLastOrderId] = useState("")

  useEffect(() => { checkLogin() }, [])

  async function checkLogin() {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) { router.push("/login"); return }

    const { data: profile } = await supabase
      .from("profiles").select("*").eq("id", userData.user.id).single()
    if (!profile) { router.push("/login"); return }
    if (profile.role === "admin") { router.push("/admin"); return }

    setClinicId(profile.clinic_id)

    const { data: clinic } = await supabase
      .from("clinics").select("*").eq("id", profile.clinic_id).single()
    setClinicName(clinic?.name || "")

    await fetchData(profile.clinic_id)
    setLoading(false)
  }

  async function fetchData(targetClinicId: string) {
    const { data: productsData } = await supabase
      .from("products").select("*").eq("is_active", true).order("name", { ascending: true })
    const { data: ordersData } = await supabase
      .from("orders").select("*").eq("clinic_id", targetClinicId).order("created_at", { ascending: false })
    const { data: itemsData } = await supabase.from("order_items").select("*")

    setProducts(productsData || [])
    setOrders(ordersData || [])
    setOrderItems(itemsData || [])
  }

  function normalizeText(value: any) {
    return String(value || "").toLowerCase().normalize("NFKC").replace(/\s+/g, "")
  }

  const categories = useMemo(() => {
    const list = products.map((p) => p.category).filter((c) => c && String(c).trim() !== "")
    return ["すべて", ...Array.from(new Set(list))]
  }, [products])

  const filteredProducts = useMemo(() => {
    const keyword = normalizeText(search)
    return products.filter((p) => {
      const target = normalizeText(`${p.name || ""} ${p.product_code || ""} ${p.manufacturer || ""} ${p.barcode || ""}`)
      return (!keyword || target.includes(keyword)) && (category === "すべて" || p.category === category)
    })
  }, [products, search, category])

  const frequentProducts = useMemo(() => {
    const clinicOrderIds = orders.map((o) => o.id)
    const countMap: Record<string, number> = {}
    orderItems.filter((item) => clinicOrderIds.includes(item.order_id))
      .forEach((item) => { countMap[item.product_id] = (countMap[item.product_id] || 0) + Number(item.quantity || 0) })
    return products.map((p) => ({ ...p, used_count: countMap[p.id] || 0 }))
      .filter((p) => p.used_count > 0).sort((a, b) => b.used_count - a.used_count).slice(0, 8)
  }, [products, orders, orderItems])

  const recentProducts = useMemo(() => {
    const clinicOrderIds = orders.slice(0, 10).map((o) => o.id)
    const recentIds = Array.from(new Set(
      orderItems.filter((item) => clinicOrderIds.includes(item.order_id)).map((item) => item.product_id)
    )).slice(0, 8)
    return recentIds.map((id) => products.find((p) => p.id === id)).filter(Boolean)
  }, [products, orders, orderItems])

  function addToCart(product: any) {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id)
      if (existing) return prev.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item)
      return [...prev, { ...product, quantity: 1 }]
    })
  }

  function decreaseQuantity(productId: string) {
    setCart((prev) => prev.map((item) => item.id === productId ? { ...item, quantity: item.quantity - 1 } : item).filter((item) => item.quantity > 0))
  }

  function increaseQuantity(productId: string) {
    setCart((prev) => prev.map((item) => item.id === productId ? { ...item, quantity: item.quantity + 1 } : item))
  }

  function setCartQuantity(productId: string, value: string) {
    const quantity = Number(value)
    if (isNaN(quantity) || quantity < 0) return
    setCart((prev) => prev.map((item) => item.id === productId ? { ...item, quantity } : item).filter((item) => item.quantity > 0))
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
        const product = products.find((p) => String(p.barcode || "") === decodedText || String(p.product_code || "") === decodedText)
        if (!product) { alert("商品が見つかりません"); return }
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
    const { data } = await supabase.from("orders").select("id")
      .gte("created_at", `${y}-${m}-${d}T00:00:00`).lte("created_at", `${y}-${m}-${d}T23:59:59`)
    const count = (data?.length || 0) + 1
    return `DN-${dateStr}-${String(count).padStart(4, "0")}`
  }

  async function submitOrder() {
    if (!clinicId || cart.length === 0) return
    const totalPrice = cart.reduce((sum, item) => sum + Number(item.price || 0) * item.quantity, 0)
    const deliveryNumber = await generateDeliveryNumber()

    const { data: order, error: orderError } = await supabase.from("orders")
      .insert([{ clinic_id: clinicId, status: "注文受付", total_price: totalPrice, delivery_number: deliveryNumber }])
      .select().single()
    if (orderError) { alert("注文作成でエラー"); return }

    const { error: itemError } = await supabase.from("order_items").insert(
      cart.map((item) => ({ order_id: order.id, product_id: item.id, product_name: item.name, quantity: item.quantity, price: item.price }))
    )
    if (itemError) { alert("注文明細でエラー"); return }

    setLastOrderId(order.id)
    setCart([])
    setShowConfirm(false)
    setShowCart(false)
    setShowComplete(true)
    await fetchData(clinicId)
  }

  const totalPrice = cart.reduce((sum, item) => sum + Number(item.price || 0) * item.quantity, 0)
  const totalQuantity = cart.reduce((sum, item) => sum + item.quantity, 0)

  if (loading) return <p style={{ padding: 20 }}>読み込み中...</p>

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "12px 16px 120px" }}>
      <style>{`
        @media (min-width: 768px) {
          .product-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
          .product-grid > * { margin-bottom: 0 !important; }
        }
      `}</style>

      {/* ヘッダー */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button onClick={() => router.push("/menu")} style={backBtn}>
          ← メニューへ
        </button>
        <span style={{ fontSize: 12, color: "#888" }}>{clinicName}</span>
      </div>

      {/* スティッキー検索エリア */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "#fff", paddingBottom: 10, borderBottom: "1px solid #eee" }}>
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="商品名・コード・メーカーで検索"
          style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid #ddd", boxSizing: "border-box", marginBottom: 8, fontSize: 14 }}
        />
        <div style={{ display: "flex", overflowX: "auto", gap: 8, paddingBottom: 4, marginBottom: 8 }}>
          {categories.map((c: any) => (
            <button key={c} onClick={() => setCategory(c)}
              style={{ whiteSpace: "nowrap", padding: "6px 14px", borderRadius: 999, border: "1px solid #ddd", background: category === c ? "#111" : "#fff", color: category === c ? "#fff" : "#111", fontSize: 13, cursor: "pointer" }}>
              {c}
            </button>
          ))}
        </div>
        <button onClick={startScan} style={{ width: "100%", padding: 12, borderRadius: 10, background: "#0ea5e9", color: "#fff", border: "none", fontWeight: "bold", fontSize: 14, cursor: "pointer" }}>
          📷 バーコードで追加
        </button>
      </div>

      {scanning && <div id="reader" style={{ width: "100%", margin: "12px 0" }} />}

      {/* よく使う商品 */}
      {frequentProducts.length > 0 && (
        <section style={{ marginTop: 16 }}>
          <h2 style={sectionTitle}>よく使う商品</h2>
          <div style={{ display: "flex", overflowX: "auto", gap: 10, paddingBottom: 8 }}>
            {frequentProducts.map((p) => <MiniCard key={p.id} product={p} onAdd={addToCart} />)}
          </div>
        </section>
      )}

      {/* 最近注文した商品 */}
      {recentProducts.length > 0 && (
        <section style={{ marginTop: 16 }}>
          <h2 style={sectionTitle}>最近注文した商品</h2>
          <div style={{ display: "flex", overflowX: "auto", gap: 10, paddingBottom: 8 }}>
            {recentProducts.map((p: any) => <MiniCard key={p.id} product={p} onAdd={addToCart} />)}
          </div>
        </section>
      )}

      {/* 商品一覧 */}
      <section style={{ marginTop: 16 }}>
        <h2 style={sectionTitle}>商品一覧 <span style={{ fontSize: 12, fontWeight: "normal", color: "#999" }}>{filteredProducts.length}件</span></h2>
        <div className="product-grid">
          {filteredProducts.map((product) => (
            <div key={product.id} style={{ background: "#fff", borderRadius: 14, padding: 14, marginBottom: 12, boxShadow: "0 2px 6px rgba(0,0,0,0.07)", border: "1px solid #eee" }}>
              {product.image_url
                ? <img src={product.image_url} alt={product.name} style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 8, marginBottom: 8 }} />
                : <div style={{ height: 60, borderRadius: 8, marginBottom: 8, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 12 }}>NO IMAGE</div>
              }
              <p style={{ fontWeight: "bold", marginBottom: 4, fontSize: 15 }}>{product.name}</p>
              <p style={{ margin: "2px 0", fontSize: 12, color: "#555" }}>メーカー：{product.manufacturer || "-"}</p>
              <p style={{ margin: "4px 0 10px", fontWeight: "bold" }}>税抜 {Number(product.price || 0).toLocaleString()}円</p>
              <button onClick={() => addToCart(product)}
                style={{ width: "100%", padding: 11, borderRadius: 10, background: "#111", color: "#fff", border: "none", fontWeight: "bold", cursor: "pointer" }}>
                ＋ カートに追加
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* カートフローティングボタン */}
      {cart.length > 0 && !showCart && !showConfirm && !showComplete && (
        <button onClick={() => setShowCart(true)} style={{
          position: "fixed", bottom: 24, right: 20, zIndex: 50,
          background: "#111", color: "#fff", border: "none", borderRadius: 999,
          padding: "14px 24px", fontSize: 15, fontWeight: "bold", cursor: "pointer",
          boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          🛒 {totalQuantity}点
          <span style={{ fontSize: 13, opacity: 0.85 }}>{totalPrice.toLocaleString()}円</span>
        </button>
      )}

      {/* カートモーダル */}
      {showCart && (
        <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) setShowCart(false) }}>
          <div style={drawerStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: "bold" }}>🛒 カート</h2>
              <button onClick={() => setShowCart(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#888" }}>✕</button>
            </div>

            <div style={{ overflowY: "auto", flex: 1 }}>
              {cart.map((item) => (
                <CartItem key={item.id} item={item} onMinus={decreaseQuantity} onPlus={increaseQuantity} onRemove={removeFromCart} onChangeQuantity={setCartQuantity} />
              ))}
            </div>

            <div style={{ borderTop: "1px solid #eee", paddingTop: 14, marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontWeight: "bold", fontSize: 15 }}>合計（税抜）</span>
                <span style={{ fontWeight: "bold", fontSize: 18 }}>{totalPrice.toLocaleString()}円</span>
              </div>
              <button onClick={() => { setShowCart(false); setShowConfirm(true) }}
                style={{ width: "100%", padding: 15, borderRadius: 12, background: "#111", color: "#fff", border: "none", fontSize: 16, fontWeight: "bold", cursor: "pointer" }}>
                注文確認へ →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 注文確認モーダル */}
      {showConfirm && (
        <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) setShowConfirm(false) }}>
          <div style={drawerStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: "bold" }}>注文確認</h2>
              <button onClick={() => setShowConfirm(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#888" }}>✕</button>
            </div>

            <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>医院：<strong>{clinicName}</strong></p>

            <div style={{ overflowY: "auto", flex: 1 }}>
              {cart.map((item) => (
                <div key={item.id} style={{ borderBottom: "1px solid #f0f0f0", padding: "10px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: "bold", fontSize: 14 }}>{item.name}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#888" }}>
                      {item.quantity}個 × {Number(item.price || 0).toLocaleString()}円
                    </p>
                  </div>
                  <span style={{ fontWeight: "bold", fontSize: 14 }}>
                    {(Number(item.price || 0) * item.quantity).toLocaleString()}円
                  </span>
                </div>
              ))}
            </div>

            <div style={{ borderTop: "1px solid #eee", paddingTop: 14, marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                <span style={{ fontWeight: "bold", fontSize: 15 }}>合計（税抜）</span>
                <span style={{ fontWeight: "bold", fontSize: 20 }}>{totalPrice.toLocaleString()}円</span>
              </div>
              <button onClick={submitOrder}
                style={{ width: "100%", padding: 15, borderRadius: 12, background: "#059669", color: "#fff", border: "none", fontSize: 16, fontWeight: "bold", cursor: "pointer", marginBottom: 8 }}>
                ✓ 注文を確定する
              </button>
              <button onClick={() => { setShowConfirm(false); setShowCart(true) }}
                style={{ width: "100%", padding: 12, borderRadius: 12, background: "#fff", color: "#555", border: "1px solid #ddd", fontSize: 14, cursor: "pointer" }}>
                ← カートに戻る
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 注文完了オーバーレイ */}
      {showComplete && (
        <div style={{ ...overlayStyle, alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: "36px 28px", maxWidth: 360, width: "100%", textAlign: "center", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>
            <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
            <h2 style={{ fontSize: 20, fontWeight: "bold", color: "#059669", marginBottom: 8 }}>注文が完了しました</h2>
            <p style={{ fontSize: 13, color: "#888", marginBottom: 28 }}>{clinicName}</p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button onClick={() => { setShowComplete(false) }}
                style={{ width: "100%", padding: 14, borderRadius: 12, background: "#111", color: "#fff", border: "none", fontSize: 15, fontWeight: "bold", cursor: "pointer" }}>
                続けて注文する
              </button>
              <button onClick={() => router.push(`/order-edit/${lastOrderId}`)}
                style={{ width: "100%", padding: 13, borderRadius: 12, background: "#fff", color: "#555", border: "1px solid #ddd", fontSize: 14, cursor: "pointer" }}>
                注文内容を修正
              </button>
              <button onClick={() => router.push("/menu")}
                style={{ width: "100%", padding: 13, borderRadius: 12, background: "#fff", color: "#555", border: "1px solid #ddd", fontSize: 14, cursor: "pointer" }}>
                メニューへ戻る
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function MiniCard({ product, onAdd }: any) {
  return (
    <div style={{ minWidth: 130, background: "#fff", border: "1px solid #eee", borderRadius: 12, padding: 10, flexShrink: 0 }}>
      {product.image_url
        ? <img src={product.image_url} alt={product.name} style={{ width: "100%", height: 64, objectFit: "cover", borderRadius: 8, marginBottom: 6 }} />
        : <div style={{ height: 64, borderRadius: 8, marginBottom: 6, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 10 }}>NO IMAGE</div>
      }
      <p style={{ fontWeight: "bold", fontSize: 11, marginBottom: 2, lineHeight: 1.3 }}>{product.name}</p>
      <p style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>{Number(product.price || 0).toLocaleString()}円</p>
      <button onClick={() => onAdd(product)}
        style={{ width: "100%", padding: "6px 0", borderRadius: 8, border: "none", background: "#111", color: "#fff", fontSize: 12, fontWeight: "bold", cursor: "pointer" }}>
        ＋
      </button>
    </div>
  )
}

function CartItem({ item, onMinus, onPlus, onRemove, onChangeQuantity }: any) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f0f0f0", gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontWeight: "bold", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</p>
        <p style={{ margin: "2px 0 0", fontSize: 12, color: "#888" }}>
          税抜 {Number(item.price || 0).toLocaleString()}円
        </p>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
        <button onClick={() => onMinus(item.id)} style={{ width: 34, height: 34, borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 18, cursor: "pointer" }}>−</button>
        <input type="number" min="0" value={item.quantity} onChange={(e) => onChangeQuantity(item.id, e.target.value)}
          style={{ width: 48, height: 34, textAlign: "center", borderRadius: 8, border: "1px solid #ddd", fontSize: 15, fontWeight: "bold" }} />
        <button onClick={() => onPlus(item.id)} style={{ width: 34, height: 34, borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 18, cursor: "pointer" }}>＋</button>
        <button onClick={() => onRemove(item.id)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #fca5a5", background: "#fff", color: "#ef4444", fontSize: 12, cursor: "pointer" }}>削除</button>
      </div>
    </div>
  )
}

const backBtn: React.CSSProperties = {
  padding: "8px 14px", background: "#f5f5f5", color: "#555", border: "1px solid #e0e0e0",
  borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: "bold",
}

const sectionTitle: React.CSSProperties = {
  fontSize: 15, fontWeight: "bold", color: "#111", marginBottom: 10,
}

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100,
  display: "flex", alignItems: "flex-end", justifyContent: "center",
}

const drawerStyle: React.CSSProperties = {
  background: "#fff", borderRadius: "20px 20px 0 0", padding: "20px 20px 32px",
  width: "100%", maxWidth: 600, maxHeight: "85vh", display: "flex", flexDirection: "column",
  boxShadow: "0 -4px 24px rgba(0,0,0,0.15)",
}
