"use client"

import { useState } from "react"
import { supabase } from "@/lib/supabase"

export default function DeliverySearchPage() {
  const [number, setNumber] = useState("")
  const [order, setOrder] = useState<any>(null)

  async function search() {
    // 半角/全角統一（"ＤＮ-..." でも "DN-..." でもヒット）
    const normalized = number.normalize("NFKC").trim()
    const { data } = await supabase
      .from("orders")
      .select("*")
      .eq("delivery_number", normalized)
      .single()

    setOrder(data)
  }

  async function reissue() {
    await supabase
      .from("orders")
      .update({ status: "注文受付" })
      .eq("id", order.id)

    alert("再発行対象に戻しました")
  }

  return (
    <main style={{ padding: 20 }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginBottom: 12 }}>納品書検索</h1>

      <input
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        placeholder="DN-20260430-0001"
        style={{ padding: 10, width: "100%", marginBottom: 10, fontSize: 14 }}
      />

      <button onClick={search} style={{ padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>検索</button>

      {order && (
        <div style={{ marginTop: 20 }}>
          <p>納品書番号：{order.delivery_number}</p>
          <p>金額：{order.total_price}</p>
          <p>ステータス：{order.status}</p>

          <button onClick={reissue} style={{ padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>再発行</button>
        </div>
      )}
    </main>
  )
}