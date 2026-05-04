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

  // 🔐 ログイン＋医院固定
  useEffect(() => {
    checkUser()
  }, [])

  async function checkUser() {
    const { data } = await supabase.auth.getUser()

    if (!data.user) {
      router.push("/login")
      return
    }

    // 👉 プロフィールから医院ID取得
    const { data: profile } = await supabase
      .from("profiles")
      .select("clinic_id")
      .eq("id", data.user.id)
      .single()

    setClinicId(profile?.clinic_id || "")
  }

  // 📦 商品取得
  useEffect(() => {
    fetchProducts()
  }, [])

  async function fetchProducts() {
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("is_active", true)

    setProducts(data || [])
  }

  // 🔍 検索（全角対応）
  function normalizeText(v: any) {
    return String(v || "")
      .toLowerCase()
      .normalize("NFKC")
      .replace(/\s+/g, "")
  }

  const categories = useMemo(() => {
    const list = products.map((p) => p.category).filter(Boolean)
    return ["すべて", ...Array.from(new Set(list))]
  }, [products])

  const filtered = useMemo(() => {
    const keyword = normalizeText(search)

    return products.filter((p) => {
      const target = normalizeText(
        `${p.name} ${p.product_code} ${p.manufacturer} ${p.barcode}`
      )

      return (
        (!keyword || target.includes(keyword)) &&
        (category === "すべて" || p.category === category)
      )
    })
  }, [products, search, category])

  // 🛒 カート
  function addToCart(product: any) {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === product.id)

      if (existing) {
        return prev.map((c) =>
          c.id === product.id ? { ...c, qty: c.qty + 1 } : c
        )
      }

      return [...prev, { ...product, qty: 1 }]
    })
  }

  function changeQty(id: string, diff: number) {
    setCart((prev) =>
      prev
        .map((c) =>
          c.id === id ? { ...c, qty: c.qty + diff } : c
        )
        .filter((c) => c.qty > 0)
    )
  }

  const total = cart.reduce(
    (sum, c) => sum + c.price * c.qty,
    0
  )

  // 🧾 注文確定
  async function submitOrder() {
    if (!clinicId) {
      alert("医院情報が取得できません")
      return
    }

    if (cart.length === 0) {
      alert("カートが空です")
      return
    }

    const { data: order } = await supabase
      .from("orders")
      .insert([
        {
          clinic_id: clinicId,
          total_price: total,
          status: "注文受付",
        },
      ])
      .select()
      .single()

    const items = cart.map((c) => ({
      order_id: order.id,
      product_id: c.id,
      product_name: c.name,
      quantity: c.qty,
      price: c.price,
    }))

    await supabase.from("order_items").insert(items)

    alert("注文完了")
    setCart([])
  }

  return (
<<<<<<< HEAD
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
=======
    <main style={container}>
      {/* 上部 */}
      <div style={header}>
>>>>>>> 4e28ef0 (fix login guard)
        <input
          placeholder="検索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={input}
        />

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={input}
        >
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>

        <button style={orderBtn} onClick={submitOrder}>
          注文確定（{total.toLocaleString()}円）
        </button>
      </div>

      {/* レイアウト */}
      <div style={layout}>
        {/* 商品 */}
        <div style={grid}>
          {filtered.map((p) => (
            <div key={p.id} style={card}>
              {p.image_url ? (
                <img src={p.image_url} style={img} />
              ) : (
                <div style={noimg}>NO IMAGE</div>
              )}

              <p style={{ fontWeight: "bold" }}>{p.name}</p>
              <p>{p.price}円</p>

<<<<<<< HEAD
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
=======
              <button onClick={() => addToCart(p)}>
                カートに追加
              </button>
            </div>
>>>>>>> 4e28ef0 (fix login guard)
          ))}
        </div>

        {/* カート */}
        <div style={cartBox}>
          <h3>カート</h3>

          {cart.map((c) => (
            <div key={c.id}>
              <p>{c.name}</p>

              <button onClick={() => changeQty(c.id, -1)}>
                -
              </button>
              {c.qty}
              <button onClick={() => changeQty(c.id, 1)}>
                +
              </button>
            </div>
          ))}

          <h4>合計：{total.toLocaleString()}円</h4>

          <button style={orderBtn} onClick={submitOrder}>
            注文確定
          </button>
        </div>
      </div>
    </main>
  )
}

<<<<<<< HEAD
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
=======
/* UI */
const container = {
  maxWidth: 1100,
>>>>>>> 4e28ef0 (fix login guard)
  margin: "0 auto",
  padding: 16,
}

const header = {
  position: "sticky",
  top: 0,
  background: "#fff",
  display: "flex",
  gap: 8,
  zIndex: 10,
}

const layout = {
  display: "flex",
  gap: 16,
}

const grid = {
  flex: 1,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))",
  gap: 12,
}

const cartBox = {
  width: 260,
  position: "sticky",
  top: 80,
}

const card = {
  border: "1px solid #ddd",
  padding: 10,
}

const img = {
  width: "100%",
  height: 100,
  objectFit: "cover",
}

const noimg = {
  height: 100,
  background: "#eee",
}

const input = {
  flex: 1,
  padding: 8,
}

const orderBtn = {
  background: "black",
  color: "white",
  padding: 10,
<<<<<<< HEAD
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
=======
>>>>>>> 4e28ef0 (fix login guard)
}