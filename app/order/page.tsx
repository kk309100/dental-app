"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

export default function OrderPage() {
  const router = useRouter()

  const [products, setProducts] = useState<any[]>([])
  const [cart, setCart] = useState<any[]>([])
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("すべて")
  const [clinicId, setClinicId] = useState("")
  const [clinicName, setClinicName] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { checkUser() }, [])
  useEffect(() => { fetchProducts() }, [])

  async function checkUser() {
    const { data } = await supabase.auth.getUser()
    if (!data.user) { router.push("/login"); return }

    const { data: profile } = await supabase
      .from("profiles")
      .select("clinic_id, clinics(name)")
      .eq("id", data.user.id)
      .single()

    setClinicId(profile?.clinic_id || "")
    setClinicName((profile?.clinics as any)?.name || "")
  }

  async function fetchProducts() {
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true })
    setProducts(data || [])
  }

  function normalizeText(v: any) {
    return String(v || "").toLowerCase().normalize("NFKC").replace(/\s+/g, "")
  }

  const categories = useMemo(() => {
    const list = products.map((p) => p.category).filter(Boolean)
    return ["すべて", ...Array.from(new Set<string>(list))]
  }, [products])

  const filtered = useMemo(() => {
    const keyword = normalizeText(search)
    return products.filter((p) => {
      const target = normalizeText(`${p.name} ${p.product_code} ${p.manufacturer} ${p.barcode}`)
      return (
        (!keyword || target.includes(keyword)) &&
        (category === "すべて" || p.category === category)
      )
    })
  }, [products, search, category])

  function addToCart(product: any) {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === product.id)
      if (existing) return prev.map((c) => c.id === product.id ? { ...c, qty: c.qty + 1 } : c)
      return [...prev, { ...product, qty: 1 }]
    })
  }

  function changeQty(id: string, diff: number) {
    setCart((prev) =>
      prev.map((c) => c.id === id ? { ...c, qty: c.qty + diff } : c).filter((c) => c.qty > 0)
    )
  }

  const total = cart.reduce((sum, c) => sum + c.price * c.qty, 0)
  const totalQty = cart.reduce((sum, c) => sum + c.qty, 0)

  async function submitOrder() {
    if (!clinicId) { alert("医院情報が取得できません"); return }
    if (cart.length === 0) { alert("カートが空です"); return }
    setSubmitting(true)

    const { data: order, error } = await supabase
      .from("orders")
      .insert([{ clinic_id: clinicId, total_price: total, status: "注文受付" }])
      .select()
      .single()

    if (error || !order) { alert("注文に失敗しました"); setSubmitting(false); return }

    const items = cart.map((c) => ({
      order_id: order.id,
      product_id: c.id,
      product_name: c.name,
      quantity: c.qty,
      price: c.price,
    }))

    await supabase.from("order_items").insert(items)

    alert("注文完了しました")
    setCart([])
    setSubmitting(false)
  }

  async function logout() {
    await supabase.auth.signOut()
    router.push("/login")
  }

  return (
    <main style={container}>
      {/* 上部固定バー */}
      <div style={stickyHeader}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            placeholder="商品名・コード・メーカーで検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={searchInput}
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={selectInput}>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        {clinicName && <p style={{ margin: "4px 0 0", fontSize: 11, color: "#888" }}>{clinicName}</p>}
      </div>

      {/* 商品グリッド */}
      <div style={grid}>
        {filtered.map((p) => (
          <div key={p.id} style={card}>
            {p.image_url
              ? <img src={p.image_url} alt={p.name} style={imgStyle} />
              : <div style={noImg}>NO IMAGE</div>
            }
            <p style={{ fontWeight: "bold", margin: "6px 0 2px", fontSize: 13 }}>{p.name}</p>
            {p.manufacturer && <p style={{ margin: 0, fontSize: 11, color: "#888" }}>{p.manufacturer}</p>}
            {p.product_code && <p style={{ margin: 0, fontSize: 11, color: "#aaa" }}>{p.product_code}</p>}
            <p style={{ margin: "4px 0 8px", fontWeight: "bold" }}>{Number(p.price || 0).toLocaleString()}円</p>
            <button onClick={() => addToCart(p)} style={addBtn}>＋ カートに追加</button>
          </div>
        ))}
        {filtered.length === 0 && (
          <p style={{ color: "#999", gridColumn: "1/-1", padding: "40px 0", textAlign: "center" }}>
            該当する商品がありません
          </p>
        )}
      </div>

      {/* 底部カートバー */}
      {cart.length > 0 && (
        <div style={bottomCart}>
          <div style={{ maxWidth: 900, margin: "0 auto" }}>
            <div style={{ marginBottom: 8 }}>
              {cart.map((c) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{c.name}</span>
                  <button onClick={() => changeQty(c.id, -1)} style={qtyBtn}>−</button>
                  <span style={{ minWidth: 24, textAlign: "center", fontWeight: "bold" }}>{c.qty}</span>
                  <button onClick={() => changeQty(c.id, 1)} style={qtyBtn}>＋</button>
                  <span style={{ fontSize: 12, color: "#555", minWidth: 70, textAlign: "right" }}>
                    {(c.price * c.qty).toLocaleString()}円
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <p style={{ margin: 0, fontWeight: "bold" }}>
                {totalQty}点 合計 {total.toLocaleString()}円（税抜）
              </p>
              <button onClick={submitOrder} disabled={submitting} style={submitBtn}>
                {submitting ? "送信中…" : "注文確定"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

const container: React.CSSProperties = {
  maxWidth: 900,
  margin: "0 auto",
  padding: "0 12px 200px",
}

const stickyHeader: React.CSSProperties = {
  position: "sticky",
  top: 0,
  background: "#fff",
  zIndex: 10,
  padding: "12px 0 8px",
  borderBottom: "1px solid #eee",
  marginBottom: 12,
}

const searchInput: React.CSSProperties = {
  flex: 1,
  minWidth: 200,
  padding: "8px 12px",
  border: "1px solid #ddd",
  borderRadius: 8,
  fontSize: 14,
}

const selectInput: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #ddd",
  borderRadius: 8,
  fontSize: 14,
  background: "#fff",
}

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
  gap: 12,
}

const card: React.CSSProperties = {
  border: "1px solid #e0e0e0",
  borderRadius: 10,
  padding: 10,
  background: "#fff",
}

const imgStyle: React.CSSProperties = {
  width: "100%",
  height: 100,
  objectFit: "cover",
  borderRadius: 6,
}

const noImg: React.CSSProperties = {
  height: 100,
  background: "#f0f0f0",
  borderRadius: 6,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#aaa",
  fontSize: 11,
}

const addBtn: React.CSSProperties = {
  width: "100%",
  padding: "6px 0",
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 12,
  cursor: "pointer",
}

const bottomCart: React.CSSProperties = {
  position: "fixed",
  bottom: 0,
  left: 0,
  right: 0,
  background: "#fff",
  borderTop: "1px solid #ddd",
  padding: "10px 16px",
  zIndex: 20,
  maxHeight: "45vh",
  overflowY: "auto",
}

const qtyBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  border: "1px solid #ddd",
  borderRadius: 6,
  background: "#f8f8f8",
  cursor: "pointer",
  fontSize: 16,
  lineHeight: 1,
}

const submitBtn: React.CSSProperties = {
  padding: "10px 24px",
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: "bold",
  cursor: "pointer",
  whiteSpace: "nowrap",
}
