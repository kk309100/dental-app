"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useRouter } from "next/navigation"
import { Html5Qrcode } from "html5-qrcode"

const C = {
  primary:   "#22a648",
  primaryBg: "#e8f5ec",
  accent:    "#f08c00",
  accentBg:  "#fff7e6",
  scan:      "#22a648",
  text:      "#1a1a1a",
  sub:       "#6b7280",
  border:    "#e5e7eb",
  card:      "#ffffff",
  pageBg:    "#f8f9fa",
}

type Notice = { id: string; title: string; body: string | null }

export default function OrderPage() {
  const router = useRouter()

  const [products, setProducts]       = useState<any[]>([])
  const [orders, setOrders]           = useState<any[]>([])
  const [orderItems, setOrderItems]   = useState<any[]>([])
  const [cart, setCart]               = useState<any[]>([])
  const [clinicId, setClinicId]       = useState("")
  const [clinicName, setClinicName]   = useState("")
  const [search, setSearch]           = useState("")
  const [category, setCategory]       = useState("すべて")
  const [loading, setLoading]         = useState(true)
  const [scanning, setScanning]       = useState(false)
  const [showCart, setShowCart]       = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showComplete, setShowComplete] = useState(false)
  const [lastOrderId, setLastOrderId]   = useState("")
  const [favorites, setFavorites]       = useState<string[]>([])
  const [notices, setNotices]           = useState<Notice[]>([])
  const [dismissed, setDismissed]       = useState<string[]>([])

  useEffect(() => { checkLogin() }, [])

  async function checkLogin() {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) { router.push("/login"); return }
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", userData.user.id).single()
    if (!profile) { router.push("/login"); return }
    if (profile.role === "admin") { router.push("/admin"); return }
    setClinicId(profile.clinic_id)
    const { data: clinic } = await supabase.from("clinics").select("*").eq("id", profile.clinic_id).single()
    setClinicName(clinic?.name || "")
    await Promise.all([
      fetchData(profile.clinic_id),
      fetchFavorites(profile.clinic_id),
      fetchNotices(),
    ])
    setLoading(false)
  }

  async function fetchData(cid: string) {
    const [p, o, i] = await Promise.all([
      supabase.from("products").select("*").eq("is_active", true).order("name", { ascending: true }),
      supabase.from("orders").select("*").eq("clinic_id", cid).order("created_at", { ascending: false }),
      supabase.from("order_items").select("*"),
    ])
    setProducts(p.data || [])
    setOrders(o.data || [])
    setOrderItems(i.data || [])
  }

  async function fetchFavorites(cid: string) {
    const { data } = await supabase.from("favorites").select("product_id").eq("clinic_id", cid)
    setFavorites((data || []).map((f: any) => f.product_id))
  }

  async function fetchNotices() {
    const { data } = await supabase.from("notices").select("*").eq("is_active", true).order("created_at", { ascending: false })
    setNotices(data || [])
  }

  async function toggleFavorite(productId: string) {
    if (favorites.includes(productId)) {
      setFavorites((prev) => prev.filter((id) => id !== productId))
      await supabase.from("favorites").delete().eq("clinic_id", clinicId).eq("product_id", productId)
    } else {
      setFavorites((prev) => [...prev, productId])
      await supabase.from("favorites").insert([{ clinic_id: clinicId, product_id: productId }])
    }
  }

  const norm = (v: any) => String(v || "").toLowerCase().normalize("NFKC").replace(/\s+/g, "")

  const categories = useMemo(() => {
    const list = products.map((p) => p.category).filter((c) => c && String(c).trim())
    return ["すべて", ...Array.from(new Set(list))]
  }, [products])

  const filteredProducts = useMemo(() => {
    const k = norm(search)
    return products.filter((p) => {
      const t = norm(`${p.name} ${p.product_code || ""} ${p.manufacturer || ""} ${p.barcode || ""}`)
      return (!k || t.includes(k)) && (category === "すべて" || p.category === category)
    })
  }, [products, search, category])

  const favoriteProducts = useMemo(() => products.filter((p) => favorites.includes(p.id)), [products, favorites])

  const frequentProducts = useMemo(() => {
    const ids = orders.map((o) => o.id)
    const map: Record<string, number> = {}
    orderItems.filter((i) => ids.includes(i.order_id))
      .forEach((i) => { map[i.product_id] = (map[i.product_id] || 0) + Number(i.quantity || 0) })
    return products.map((p) => ({ ...p, used_count: map[p.id] || 0 }))
      .filter((p) => p.used_count > 0 && !favorites.includes(p.id))
      .sort((a, b) => b.used_count - a.used_count).slice(0, 8)
  }, [products, orders, orderItems, favorites])

  const recentProducts = useMemo(() => {
    const ids = Array.from(new Set(
      orderItems.filter((i) => orders.slice(0, 10).map((o) => o.id).includes(i.order_id)).map((i) => i.product_id)
    )).slice(0, 8)
    return ids.map((id) => products.find((p) => p.id === id)).filter(Boolean)
      .filter((p: any) => !favorites.includes(p.id))
  }, [products, orders, orderItems, favorites])

  function addToCart(product: any) {
    setCart((prev) => {
      const ex = prev.find((i) => i.id === product.id)
      if (ex) return prev.map((i) => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i)
      return [...prev, { ...product, quantity: 1 }]
    })
  }

  function decreaseQty(id: string) {
    setCart((prev) => prev.map((i) => i.id === id ? { ...i, quantity: i.quantity - 1 } : i).filter((i) => i.quantity > 0))
  }
  function increaseQty(id: string) {
    setCart((prev) => prev.map((i) => i.id === id ? { ...i, quantity: i.quantity + 1 } : i))
  }
  function setQty(id: string, val: string) {
    const q = Number(val); if (isNaN(q) || q < 0) return
    setCart((prev) => prev.map((i) => i.id === id ? { ...i, quantity: q } : i).filter((i) => i.quantity > 0))
  }
  function removeItem(id: string) { setCart((prev) => prev.filter((i) => i.id !== id)) }

  async function startScan() {
    setScanning(true)
    const scanner = new Html5Qrcode("reader")
    await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 220 },
      async (code) => {
        await scanner.stop(); setScanning(false)
        const p = products.find((p) => String(p.barcode || "") === code || String(p.product_code || "") === code)
        if (!p) { alert("商品が見つかりません"); return }
        addToCart(p)
      }, () => {})
  }

  async function submitOrder() {
    if (!clinicId || cart.length === 0) return
    const total = cart.reduce((s, i) => s + Number(i.price || 0) * i.quantity, 0)
    const now = new Date()
    const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, "0"), d = String(now.getDate()).padStart(2, "0")
    const { data: ex } = await supabase.from("orders").select("id").gte("created_at", `${y}-${m}-${d}T00:00:00`).lte("created_at", `${y}-${m}-${d}T23:59:59`)
    const dn = `DN-${y}${m}${d}-${String((ex?.length || 0) + 1).padStart(4, "0")}`
    const { data: order, error } = await supabase.from("orders")
      .insert([{ clinic_id: clinicId, status: "注文受付", total_price: total, delivery_number: dn }]).select().single()
    if (error) { alert("注文作成でエラー"); return }
    await supabase.from("order_items").insert(
      cart.map((i) => ({ order_id: order.id, product_id: i.id, product_name: i.name, quantity: i.quantity, price: i.price }))
    )
    setLastOrderId(order.id); setCart([]); setShowConfirm(false); setShowCart(false); setShowComplete(true)
    await fetchData(clinicId)
  }

  const totalPrice = cart.reduce((s, i) => s + Number(i.price || 0) * i.quantity, 0)
  const totalQty   = cart.reduce((s, i) => s + i.quantity, 0)
  const visibleNotices = notices.filter((n) => !dismissed.includes(n.id))

  if (loading) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh", color: C.sub }}>読み込み中…</div>

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", background: C.pageBg, minHeight: "100vh" }}>
      <style>{`
        .cat-sidebar { display: none; }
        .cat-pills-wrap { display: flex; overflow-x: auto; gap: 6px; padding-bottom: 2px; margin-bottom: 10px; }
        @media (min-width: 768px) {
          .cat-sidebar {
            display: flex; flex-direction: column; width: 180px; flex-shrink: 0;
            background: #fff; border-right: 1px solid ${C.border};
            position: sticky; top: 98px; align-self: flex-start;
            max-height: calc(100vh - 98px); overflow-y: auto;
          }
          .cat-pills-wrap { display: none; }
        }
        @media (min-width: 768px) {
          .product-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
          .product-grid > * { margin-bottom: 0 !important; }
        }
        .add-btn:active { transform: scale(0.97); }
        .mini-card:active { opacity: 0.8; }
        .cat-sidebar::-webkit-scrollbar { width: 4px; }
        .cat-sidebar::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 4px; }
      `}</style>

      {/* ヘッダーバー */}
      <div style={{ background: "#fff", borderBottom: `1px solid ${C.border}`, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 20 }}>
        <button onClick={() => router.push("/menu")}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: C.primaryBg, color: C.primary, border: `1px solid #b2dfbd`, borderRadius: 8, fontSize: 13, fontWeight: "bold", cursor: "pointer" }}>
          ← メニュー
        </button>
        <span style={{ fontSize: 13, fontWeight: "bold", color: C.sub }}>{clinicName}</span>
      </div>

      {/* 検索・スキャン */}
      <div style={{ background: "#fff", padding: "12px 16px", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 49, zIndex: 19 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍  商品名・コード・メーカーで検索"
          style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: `1.5px solid ${C.border}`, boxSizing: "border-box", fontSize: 14, marginBottom: 10, outline: "none", color: C.text }} />

        <div className="cat-pills-wrap">
          {categories.map((c: any) => (
            <button key={c} onClick={() => setCategory(c)} style={{
              whiteSpace: "nowrap", padding: "6px 14px", borderRadius: 999, fontSize: 13, cursor: "pointer",
              fontWeight: category === c ? "bold" : "normal",
              background: category === c ? C.primary : "#fff",
              color: category === c ? "#fff" : C.sub,
              border: category === c ? `1.5px solid ${C.primary}` : `1.5px solid ${C.border}`,
            }}>{c}</button>
          ))}
        </div>

        <button onClick={startScan} style={{
          width: "100%", padding: "11px 0", borderRadius: 10, background: C.scan, color: "#fff",
          border: "none", fontWeight: "bold", fontSize: 14, cursor: "pointer",
        }}>
          📷 バーコードでカートに追加
        </button>
      </div>

      {scanning && <div id="reader" style={{ width: "100%" }} />}

      {/* サイドバー + コンテンツ */}
      <div style={{ display: "flex", alignItems: "flex-start", paddingBottom: 120 }}>

        {/* カテゴリサイドバー（PC） */}
        <div className="cat-sidebar">
          {categories.map((c: any) => (
            <button key={c} onClick={() => setCategory(c)} style={{
              padding: "12px 16px", textAlign: "left", fontSize: 13, cursor: "pointer", width: "100%",
              fontWeight: category === c ? "bold" : "normal",
              background: category === c ? C.primaryBg : "transparent",
              color: category === c ? C.primary : C.text,
              border: "none",
              borderLeft: category === c ? `3px solid ${C.primary}` : "3px solid transparent",
              borderBottom: `1px solid ${C.border}`,
            }}>
              {c}
            </button>
          ))}
        </div>

        {/* メインコンテンツ */}
        <div style={{ flex: 1, minWidth: 0, padding: "16px 16px 0" }}>

          {/* お知らせ */}
          {visibleNotices.length > 0 && (
            <section style={{ marginBottom: 20 }}>
              {visibleNotices.map((n) => (
                <div key={n.id} style={{
                  background: "#fff", borderLeft: `4px solid ${C.primary}`, borderRadius: "0 10px 10px 0",
                  padding: "12px 14px", marginBottom: 8,
                  display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: "bold", fontSize: 13, color: C.primary }}>📢 {n.title}</p>
                    {n.body && <p style={{ margin: "4px 0 0", fontSize: 12, color: C.sub, lineHeight: 1.6 }}>{n.body}</p>}
                  </div>
                  <button onClick={() => setDismissed((prev) => [...prev, n.id])}
                    style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: C.sub, flexShrink: 0, marginLeft: 10, lineHeight: 1 }}>✕</button>
                </div>
              ))}
            </section>
          )}

          {/* お気に入り */}
          {favoriteProducts.length > 0 && (
            <section style={{ marginBottom: 20 }}>
              <h2 style={sh}>❤️ お気に入り</h2>
              <div style={{ display: "flex", overflowX: "auto", gap: 10, paddingBottom: 6 }}>
                {favoriteProducts.map((p) => (
                  <MiniCard key={p.id} product={p} onAdd={addToCart} isFav={true} onFav={toggleFavorite} />
                ))}
              </div>
            </section>
          )}

          {/* よく使う商品 */}
          {frequentProducts.length > 0 && (
            <section style={{ marginBottom: 20 }}>
              <h2 style={sh}>⭐ よく使う商品</h2>
              <div style={{ display: "flex", overflowX: "auto", gap: 10, paddingBottom: 6 }}>
                {frequentProducts.map((p) => (
                  <MiniCard key={p.id} product={p} onAdd={addToCart} isFav={favorites.includes(p.id)} onFav={toggleFavorite} />
                ))}
              </div>
            </section>
          )}

          {/* 最近注文した商品 */}
          {recentProducts.length > 0 && (
            <section style={{ marginBottom: 20 }}>
              <h2 style={sh}>🕐 最近注文した商品</h2>
              <div style={{ display: "flex", overflowX: "auto", gap: 10, paddingBottom: 6 }}>
                {recentProducts.map((p: any) => (
                  <MiniCard key={p.id} product={p} onAdd={addToCart} isFav={favorites.includes(p.id)} onFav={toggleFavorite} />
                ))}
              </div>
            </section>
          )}

          {/* 商品一覧 */}
          <section>
            <h2 style={sh}>商品一覧 <span style={{ fontSize: 12, fontWeight: "normal", color: C.sub }}>{filteredProducts.length}件</span></h2>
            <div className="product-grid">
              {filteredProducts.map((product) => (
                <div key={product.id} style={{
                  background: C.card, borderRadius: 14, padding: 14, marginBottom: 12,
                  border: `1px solid ${C.border}`, boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
                }}>
                  <div style={{ position: "relative" }}>
                    {product.image_url
                      ? <img src={product.image_url} alt={product.name} style={{ width: "100%", height: 110, objectFit: "cover", borderRadius: 10, marginBottom: 10 }} />
                      : <div style={{ height: 56, borderRadius: 10, marginBottom: 10, background: C.primaryBg, display: "flex", alignItems: "center", justifyContent: "center", color: "#86efac", fontSize: 11 }}>NO IMAGE</div>
                    }
                    <button onClick={() => toggleFavorite(product.id)} style={{
                      position: "absolute", top: 6, right: 6, background: "rgba(255,255,255,0.85)",
                      border: "none", borderRadius: "50%", width: 30, height: 30,
                      fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {favorites.includes(product.id) ? "❤️" : "🤍"}
                    </button>
                  </div>
                  <p style={{ fontWeight: "bold", fontSize: 15, color: C.text, marginBottom: 3 }}>{product.name}</p>
                  <p style={{ fontSize: 12, color: C.sub, margin: "0 0 2px" }}>{product.manufacturer || "-"}</p>
                  <p style={{ fontSize: 14, fontWeight: "bold", color: C.primary, margin: "6px 0 12px" }}>
                    ¥{Number(product.price || 0).toLocaleString()} <span style={{ fontSize: 11, fontWeight: "normal", color: C.sub }}>税抜</span>
                  </p>
                  <button className="add-btn" onClick={() => addToCart(product)} style={{
                    width: "100%", padding: "10px 0", borderRadius: 10,
                    background: C.primary, color: "#fff", border: "none",
                    fontWeight: "bold", fontSize: 14, cursor: "pointer",
                  }}>
                    ＋ カートに追加
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* フローティングカートボタン */}
      {cart.length > 0 && !showCart && !showConfirm && !showComplete && (
        <button onClick={() => setShowCart(true)} style={{
          position: "fixed", bottom: 24, right: 20, zIndex: 50,
          background: C.primary, color: "#fff", border: "none", borderRadius: 999,
          padding: "14px 22px", fontSize: 15, fontWeight: "bold", cursor: "pointer",
          boxShadow: "0 4px 20px rgba(34,166,72,0.4)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          🛒 {totalQty}点
          <span style={{ fontSize: 13, opacity: 0.9 }}>¥{totalPrice.toLocaleString()}</span>
        </button>
      )}

      {/* カートドロワー */}
      {showCart && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setShowCart(false) }}>
          <div style={drawer}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: "bold", color: C.text }}>🛒 カート</h2>
              <button onClick={() => setShowCart(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>✕</button>
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {cart.map((item) => (
                <CartRow key={item.id} item={item} onMinus={decreaseQty} onPlus={increaseQty} onRemove={removeItem} onSet={setQty} />
              ))}
            </div>
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                <span style={{ fontWeight: "bold", color: C.sub }}>合計（税抜）</span>
                <span style={{ fontWeight: "bold", fontSize: 20, color: C.primary }}>¥{totalPrice.toLocaleString()}</span>
              </div>
              <button onClick={() => { setShowCart(false); setShowConfirm(true) }} style={{
                width: "100%", padding: 15, borderRadius: 12, background: C.primary,
                color: "#fff", border: "none", fontSize: 16, fontWeight: "bold", cursor: "pointer",
              }}>
                注文確認へ →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 注文確認ドロワー */}
      {showConfirm && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setShowConfirm(false) }}>
          <div style={drawer}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: "bold", color: C.text }}>注文確認</h2>
              <button onClick={() => setShowConfirm(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>✕</button>
            </div>
            <p style={{ fontSize: 13, color: C.sub, marginBottom: 12 }}>医院：<strong style={{ color: C.text }}>{clinicName}</strong></p>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {cart.map((item) => (
                <div key={item.id} style={{ borderBottom: `1px solid ${C.border}`, padding: "11px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: "bold", fontSize: 14, color: C.text }}>{item.name}</p>
                    <p style={{ margin: "3px 0 0", fontSize: 12, color: C.sub }}>{item.quantity}個 × ¥{Number(item.price || 0).toLocaleString()}</p>
                  </div>
                  <span style={{ fontWeight: "bold", fontSize: 14, color: C.primary }}>
                    ¥{(Number(item.price || 0) * item.quantity).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                <span style={{ fontWeight: "bold", color: C.sub }}>合計（税抜）</span>
                <span style={{ fontWeight: "bold", fontSize: 22, color: C.primary }}>¥{totalPrice.toLocaleString()}</span>
              </div>
              <button onClick={submitOrder} style={{
                width: "100%", padding: 15, borderRadius: 12, background: C.accent,
                color: "#fff", border: "none", fontSize: 16, fontWeight: "bold", cursor: "pointer", marginBottom: 8,
              }}>
                ✓ 注文を確定する
              </button>
              <button onClick={() => { setShowConfirm(false); setShowCart(true) }} style={{
                width: "100%", padding: 12, borderRadius: 12, background: "#fff",
                color: C.sub, border: `1px solid ${C.border}`, fontSize: 14, cursor: "pointer",
              }}>
                ← カートに戻る
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 注文完了オーバーレイ */}
      {showComplete && (
        <div style={{ ...overlay, alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: "36px 28px", maxWidth: 340, width: "100%", textAlign: "center", boxShadow: "0 8px 40px rgba(0,0,0,0.18)", margin: 16 }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: C.primaryBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 16px" }}>✅</div>
            <h2 style={{ fontSize: 20, fontWeight: "bold", color: C.primary, marginBottom: 6 }}>注文が完了しました</h2>
            <p style={{ fontSize: 13, color: C.sub, marginBottom: 28 }}>{clinicName}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button onClick={() => setShowComplete(false)} style={{
                width: "100%", padding: 14, borderRadius: 12, background: C.primary,
                color: "#fff", border: "none", fontSize: 15, fontWeight: "bold", cursor: "pointer",
              }}>続けて注文する</button>
              <button onClick={() => router.push(`/order-edit/${lastOrderId}`)} style={{
                width: "100%", padding: 13, borderRadius: 12, background: "#fff",
                color: C.sub, border: `1px solid ${C.border}`, fontSize: 14, cursor: "pointer",
              }}>注文内容を修正</button>
              <button onClick={() => router.push("/menu")} style={{
                width: "100%", padding: 13, borderRadius: 12, background: "#fff",
                color: C.sub, border: `1px solid ${C.border}`, fontSize: 14, cursor: "pointer",
              }}>メニューへ戻る</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function MiniCard({ product, onAdd, isFav, onFav }: any) {
  return (
    <div className="mini-card" style={{ minWidth: 128, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 10, flexShrink: 0, position: "relative" }}>
      <button onClick={() => onFav(product.id)} style={{
        position: "absolute", top: 8, right: 8, background: "rgba(255,255,255,0.85)",
        border: "none", borderRadius: "50%", width: 24, height: 24,
        fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
      }}>{isFav ? "❤️" : "🤍"}</button>
      {product.image_url
        ? <img src={product.image_url} alt={product.name} style={{ width: "100%", height: 60, objectFit: "cover", borderRadius: 8, marginBottom: 6 }} />
        : <div style={{ height: 60, borderRadius: 8, marginBottom: 6, background: "#e8f5ec", display: "flex", alignItems: "center", justifyContent: "center", color: "#86efac", fontSize: 10 }}>NO IMAGE</div>
      }
      <p style={{ fontWeight: "bold", fontSize: 11, marginBottom: 2, lineHeight: 1.3, color: "#1a1a1a", paddingRight: 14 }}>{product.name}</p>
      <p style={{ fontSize: 11, color: "#22a648", fontWeight: "bold", marginBottom: 6 }}>¥{Number(product.price || 0).toLocaleString()}</p>
      <button onClick={() => onAdd(product)} style={{
        width: "100%", padding: "6px 0", borderRadius: 8, border: "none",
        background: "#22a648", color: "#fff", fontSize: 13, fontWeight: "bold", cursor: "pointer",
      }}>＋</button>
    </div>
  )
}

function CartRow({ item, onMinus, onPlus, onRemove, onSet }: any) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: "1px solid #f0f0f0", gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontWeight: "bold", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#1a1a1a" }}>{item.name}</p>
        <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7280" }}>¥{Number(item.price || 0).toLocaleString()} / 個</p>
      </div>
      <div style={{ display: "flex", gap: 5, alignItems: "center", flexShrink: 0 }}>
        <button onClick={() => onMinus(item.id)} style={qBtn}>−</button>
        <input type="number" min="0" value={item.quantity} onChange={(e) => onSet(item.id, e.target.value)}
          style={{ width: 46, height: 34, textAlign: "center", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 15, fontWeight: "bold", color: "#1a1a1a" }} />
        <button onClick={() => onPlus(item.id)} style={qBtn}>＋</button>
        <button onClick={() => onRemove(item.id)}
          style={{ padding: "6px 9px", borderRadius: 8, border: "1px solid #fca5a5", background: "#fff7f7", color: "#ef4444", fontSize: 12, cursor: "pointer" }}>削除</button>
      </div>
    </div>
  )
}

const qBtn: React.CSSProperties = {
  width: 34, height: 34, borderRadius: 8, border: "1px solid #e5e7eb",
  background: "#f9fafb", fontSize: 18, cursor: "pointer", color: "#374151",
}

const sh: React.CSSProperties = {
  fontSize: 14, fontWeight: "bold", color: "#374151", marginBottom: 10, marginTop: 0,
}

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100,
  display: "flex", alignItems: "flex-end", justifyContent: "center",
}

const drawer: React.CSSProperties = {
  background: "#fff", borderRadius: "20px 20px 0 0", padding: "20px 20px 32px",
  width: "100%", maxWidth: 600, maxHeight: "85vh", display: "flex", flexDirection: "column",
  boxShadow: "0 -4px 24px rgba(0,0,0,0.12)",
}
