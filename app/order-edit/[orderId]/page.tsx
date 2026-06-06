"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

export default function OrderEditPage() {
  const router = useRouter()
  const params = useParams()
  const orderId = params.orderId as string

  const [order, setOrder] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchOrder()
  }, [])

  async function fetchOrder() {
    const { data: orderData } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single()

    const { data: itemData } = await supabase
      .from("order_items")
      .select("*")
      .eq("order_id", orderId)

    setOrder(orderData)
    setItems(itemData || [])
    setLoading(false)
  }

  async function recalculateTotal(updatedItems: any[]) {
    const total = updatedItems.reduce(
      (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
      0
    )

    await supabase
      .from("orders")
      .update({ total_price: total })
      .eq("id", orderId)

    setOrder((prev: any) => ({ ...prev, total_price: total }))
  }

  async function changeQuantity(item: any, type: "plus" | "minus") {
    if (order?.status !== "注文受付") {
      alert("この注文は編集できません")
      return
    }

    const newQuantity =
      type === "plus"
        ? Number(item.quantity || 0) + 1
        : Number(item.quantity || 0) - 1

    if (newQuantity <= 0) {
      await supabase.from("order_items").delete().eq("id", item.id)

      const updatedItems = items.filter((i) => i.id !== item.id)
      setItems(updatedItems)
      await recalculateTotal(updatedItems)
      return
    }

    await supabase
      .from("order_items")
      .update({ quantity: newQuantity })
      .eq("id", item.id)

    const updatedItems = items.map((i) =>
      i.id === item.id ? { ...i, quantity: newQuantity } : i
    )

    setItems(updatedItems)
    await recalculateTotal(updatedItems)
    // 管理画面に「医院修正あり」を通知するため note にフラグを立てる
    const currentNote: string = order?.note || ""
    if (!currentNote.includes("【医院修正】")) {
      const newNote = "【医院修正】" + (currentNote ? " " + currentNote : "")
      await supabase.from("orders").update({ note: newNote }).eq("id", orderId)
      setOrder((prev: any) => ({ ...prev, note: newNote }))
    }
  }

  if (loading) return <p style={{ padding: 20 }}>読み込み中...</p>

  if (!order) {
    return (
      <main style={{ padding: 20 }}>
        <p>注文が見つかりません。</p>
      </main>
    )
  }

  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: 16 }}>
      <h1>注文内容修正</h1>

      <p>納品書番号：{order.delivery_number || "-"}</p>
      <p>ステータス：{order.status}</p>
      <p style={{ fontWeight: "bold" }}>
        合計：税抜 {Number(order.total_price || 0).toLocaleString()}円
      </p>

      {order.status !== "注文受付" && (
        <p style={{ color: "red", fontWeight: "bold" }}>
          この注文はすでに処理中のため編集できません。
        </p>
      )}

      <h2>商品</h2>

      {items.length === 0 && <p>商品がありません。</p>}

      {items.map((item) => (
        <div
          key={item.id}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid #eee",
            padding: "12px 0",
            gap: 10,
          }}
        >
          <div>
            <p style={{ margin: 0, fontWeight: "bold" }}>
              {item.product_name || "商品名なし"}
            </p>
            <p style={{ margin: 0, fontSize: 12 }}>
              税抜：{Number(item.price || 0).toLocaleString()}円
            </p>
            <p style={{ margin: 0, fontSize: 12 }}>
              小計：{(Number(item.price || 0) * Number(item.quantity || 0)).toLocaleString()}円
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={() => changeQuantity(item, "minus")}
              style={qtyBtn}
              disabled={order.status !== "注文受付"}
            >
              −
            </button>

            <span style={{ minWidth: 24, textAlign: "center", fontWeight: "bold" }}>
              {item.quantity}
            </span>

            <button
              onClick={() => changeQuantity(item, "plus")}
              style={qtyBtn}
              disabled={order.status !== "注文受付"}
            >
              ＋
            </button>
          </div>
        </div>
      ))}

      <button
        onClick={() => router.push("/history")}
        style={{
          width: "100%",
          padding: 14,
          marginTop: 24,
          borderRadius: 10,
          border: "none",
          background: "#111",
          color: "#fff",
          fontWeight: "bold",
        }}
      >
        注文履歴へ戻る
      </button>
    </main>
  )
}

const qtyBtn: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 8,
  border: "1px solid #ddd",
  background: "#fff",
  fontSize: 20,
  fontWeight: "bold",
}