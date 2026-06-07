"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { ChevronLeft, Minus, Plus, Trash2, Package, ShoppingCart } from "lucide-react"

// ─── カラーパレット（注文画面と同じ） ───────────────────────
const C = {
  primary:    "#059669",
  primaryBg:  "#ecfdf5",
  primaryBdr: "#a7f3d0",
  accent:     "#ea580c",
  confirm:    "#dc2626",
  text:       "#111827",
  sub:        "#6b7280",
  border:     "#f3f4f6",
  borderMid:  "#e5e7eb",
  card:       "#ffffff",
  pageBg:     "#f8fafc",
}

export default function OrderEditPage() {
  const router  = useRouter()
  const params  = useParams()
  const orderId = params.orderId as string

  const [order,   setOrder]   = useState<any>(null)
  const [items,   setItems]   = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)

  useEffect(() => { fetchOrder() }, [])

  async function fetchOrder() {
    const { data: orderData } = await supabase
      .from("orders").select("*").eq("id", orderId).single()
    const { data: itemData } = await supabase
      .from("order_items").select("*").eq("order_id", orderId)
    setOrder(orderData)
    setItems(itemData || [])
    setLoading(false)
  }

  async function recalculateTotal(updatedItems: any[]) {
    const total = updatedItems.reduce(
      (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0
    )
    await supabase.from("orders").update({ total_price: total }).eq("id", orderId)
    setOrder((prev: any) => ({ ...prev, total_price: total }))
  }

  async function changeQuantity(item: any, type: "plus" | "minus") {
    if (order?.status !== "注文受付") {
      alert("この注文は編集できません")
      return
    }
    setSaving(true)

    const newQuantity = type === "plus"
      ? Number(item.quantity || 0) + 1
      : Number(item.quantity || 0) - 1

    if (newQuantity <= 0) {
      await supabase.from("order_items").delete().eq("id", item.id)
      const updatedItems = items.filter((i) => i.id !== item.id)
      setItems(updatedItems)
      await recalculateTotal(updatedItems)
    } else {
      await supabase.from("order_items").update({ quantity: newQuantity }).eq("id", item.id)
      const updatedItems = items.map((i) =>
        i.id === item.id ? { ...i, quantity: newQuantity } : i
      )
      setItems(updatedItems)
      await recalculateTotal(updatedItems)
    }

    // 管理画面に「医院修正あり」を通知
    const currentNote: string = order?.note || ""
    if (!currentNote.includes("【医院修正】")) {
      const newNote = "【医院修正】" + (currentNote ? " " + currentNote : "")
      await supabase.from("orders").update({ note: newNote }).eq("id", orderId)
      setOrder((prev: any) => ({ ...prev, note: newNote }))
    }
    setSaving(false)
  }

  async function setQuantityDirect(item: any, val: string) {
    if (order?.status !== "注文受付") return
    const q = Number(val)
    if (isNaN(q) || q < 0) return

    setSaving(true)
    if (q === 0) {
      await supabase.from("order_items").delete().eq("id", item.id)
      const updatedItems = items.filter((i) => i.id !== item.id)
      setItems(updatedItems)
      await recalculateTotal(updatedItems)
    } else {
      await supabase.from("order_items").update({ quantity: q }).eq("id", item.id)
      const updatedItems = items.map((i) => i.id === item.id ? { ...i, quantity: q } : i)
      setItems(updatedItems)
      await recalculateTotal(updatedItems)
    }

    const currentNote: string = order?.note || ""
    if (!currentNote.includes("【医院修正】")) {
      const newNote = "【医院修正】" + (currentNote ? " " + currentNote : "")
      await supabase.from("orders").update({ note: newNote }).eq("id", orderId)
      setOrder((prev: any) => ({ ...prev, note: newNote }))
    }
    setSaving(false)
  }

  const totalPrice = items.reduce(
    (sum, i) => sum + Number(i.price || 0) * Number(i.quantity || 0), 0
  )
  const totalQty   = items.reduce((sum, i) => sum + Number(i.quantity || 0), 0)
  const editable   = order?.status === "注文受付"

  // ─── ローディング ──────────────────────────────────────────
  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 40, height: 40, border: "3px solid #e5e7eb", borderTopColor: C.primary, borderRadius: "50%", margin: "0 auto 12px", animation: "spin 0.8s linear infinite" }} />
        <p style={{ color: "#9ca3af", fontSize: 13, margin: 0 }}>読み込み中…</p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )

  if (!order) return (
    <main style={{ padding: 20 }}>
      <p style={{ color: C.sub }}>注文が見つかりません。</p>
      <button onClick={() => router.push("/history")} style={backBtnStyle}>
        <ChevronLeft size={15} color={C.primary} strokeWidth={2.5} />
        注文履歴へ戻る
      </button>
    </main>
  )

  return (
    <main style={{
      maxWidth: 600, margin: "0 auto",
      background: C.pageBg, minHeight: "100vh",
      paddingBottom: 48,
    }}>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* ── Stickyヘッダー ── */}
      <div style={{
        position: "sticky", top: 0, zIndex: 20,
        background: "#fff",
        borderBottom: `1px solid ${C.border}`,
        boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
      }}>
        <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", gap: 8 }}>
          <button onClick={() => router.push("/history")} style={backBtnStyle}>
            <ChevronLeft size={15} color={C.primary} strokeWidth={2.5} />
            履歴
          </button>

          <span style={{
            flex: 1, textAlign: "center",
            fontSize: 15, fontWeight: 700, color: C.text,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            注文内容を修正
          </span>

          {/* 右端：保存中インジケーター */}
          <div style={{ width: 60, display: "flex", justifyContent: "flex-end" }}>
            {saving && (
              <span style={{ fontSize: 11, color: C.sub }}>保存中…</span>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: "16px 16px 0" }}>

        {/* ── 注文情報カード ── */}
        <div style={{
          background: "#fff", borderRadius: 16,
          border: `1px solid ${C.borderMid}`,
          padding: "14px 16px", marginBottom: 14,
          boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
          animation: "fadeUp 0.2s ease both",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <ShoppingCart size={15} color={C.primary} strokeWidth={2} />
              <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                {order.delivery_number || "—"}
              </span>
            </div>
            <span style={{
              fontSize: 11, fontWeight: 700,
              padding: "3px 10px", borderRadius: 999,
              background: editable ? C.primaryBg : "#fef3c7",
              color: editable ? C.primary : "#92400e",
              border: `1px solid ${editable ? C.primaryBdr : "#fde68a"}`,
            }}>
              {order.status}
            </span>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 12, color: C.sub }}>合計（税抜）</span>
            <span style={{ fontSize: 22, fontWeight: 800, color: C.primary }}>
              ¥{totalPrice.toLocaleString()}
            </span>
          </div>

          {order.orderer_name && (
            <p style={{ margin: "6px 0 0", fontSize: 12, color: C.sub }}>
              注文者：{order.orderer_name}
            </p>
          )}
        </div>

        {/* ── 編集不可アラート ── */}
        {!editable && (
          <div style={{
            background: "#fff7ed", borderRadius: 12, border: "1px solid #fed7aa",
            padding: "11px 14px", marginBottom: 14, fontSize: 13, color: "#9a3412",
            fontWeight: 600,
          }}>
            ⚠️ この注文はすでに処理が開始されているため、変更できません。
          </div>
        )}

        {/* ── 商品リスト ── */}
        <div style={{
          background: "#fff", borderRadius: 16,
          border: `1px solid ${C.borderMid}`,
          overflow: "hidden",
          boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
          marginBottom: 16,
          animation: "fadeUp 0.2s ease 0.05s both",
        }}>
          {/* リストヘッダー */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "13px 16px",
            borderBottom: `1px solid ${C.border}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Package size={14} color={C.sub} strokeWidth={2} />
              <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>商品</span>
              <span style={{ fontSize: 11, color: C.sub }}>{totalQty}点</span>
            </div>
          </div>

          {items.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: C.sub }}>
              <Package size={44} color="#e5e7eb" strokeWidth={1} />
              <p style={{ marginTop: 12, fontSize: 14 }}>商品がありません</p>
            </div>
          ) : (
            <div>
              {items.map((item, idx) => (
                <div
                  key={item.id}
                  style={{
                    display: "flex", alignItems: "center",
                    padding: "12px 16px",
                    borderBottom: idx < items.length - 1 ? `1px solid ${C.border}` : "none",
                    gap: 12,
                  }}
                >
                  {/* 商品情報 */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      margin: 0, fontWeight: 700, fontSize: 14, color: C.text,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {item.product_name || "商品名なし"}
                    </p>
                    <div style={{ display: "flex", gap: 10, marginTop: 3, alignItems: "baseline" }}>
                      <span style={{ fontSize: 12, color: C.sub }}>
                        ¥{Number(item.price || 0).toLocaleString()} / 個
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.primary }}>
                        小計 ¥{(Number(item.price || 0) * Number(item.quantity || 0)).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* 数量コントロール */}
                  {editable ? (
                    <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
                      <button
                        onClick={() => changeQuantity(item, "minus")}
                        disabled={saving}
                        style={qBtn}
                      >
                        {item.quantity <= 1
                          ? <Trash2 size={13} color="#ef4444" strokeWidth={2} />
                          : <Minus size={13} color="#374151" strokeWidth={2} />
                        }
                      </button>
                      <input
                        type="number"
                        min="0"
                        value={item.quantity}
                        onChange={(e) => setQuantityDirect(item, e.target.value)}
                        disabled={saving}
                        style={{
                          width: 44, height: 36, textAlign: "center",
                          borderRadius: 8, border: `1.5px solid ${C.borderMid}`,
                          fontSize: 15, fontWeight: 700, color: C.text,
                          background: "#fff",
                        }}
                      />
                      <button
                        onClick={() => changeQuantity(item, "plus")}
                        disabled={saving}
                        style={qBtn}
                      >
                        <Plus size={13} color="#374151" strokeWidth={2} />
                      </button>
                    </div>
                  ) : (
                    <span style={{
                      fontSize: 15, fontWeight: 700, color: C.text,
                      minWidth: 32, textAlign: "center",
                    }}>
                      {item.quantity}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 備考 ── */}
        {order.note && (
          <div style={{
            background: "#fff", borderRadius: 12,
            border: `1px solid ${C.borderMid}`,
            padding: "12px 14px", marginBottom: 16,
            animation: "fadeUp 0.2s ease 0.1s both",
          }}>
            <p style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 700, color: C.sub }}>備考</p>
            <p style={{ margin: 0, fontSize: 13, color: C.text, lineHeight: 1.6 }}>{order.note}</p>
          </div>
        )}

        {/* ── 戻るボタン ── */}
        <button
          onClick={() => router.push("/history")}
          style={{
            width: "100%", padding: 14, borderRadius: 14,
            background: "#fff", color: C.sub,
            border: `1.5px solid ${C.borderMid}`,
            fontSize: 14, fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          <ChevronLeft size={15} color={C.sub} strokeWidth={2.5} />
          注文履歴へ戻る
        </button>
      </div>
    </main>
  )
}

// ── スタイル定数 ───────────────────────────────────────────
const qBtn: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 8,
  border: "1.5px solid #e5e7eb", background: "#f9fafb",
  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
}

const backBtnStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 3,
  padding: "8px 12px", borderRadius: 10,
  background: "#ecfdf5", border: "1.5px solid #a7f3d0",
  color: "#059669", fontSize: 13, fontWeight: 700,
  cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
}
