"use client"

import { use, useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import DeliveryNoteSheet from "@/app/components/DeliveryNoteSheet"

type Order = { id: string; clinic_id: string; created_at: string; delivered_at: string | null; total_price: number; delivery_number: string | null; sales_rep: string | null; note: string | null; status: string }
type Item = { id: string; order_id: string; product_name: string | null; quantity: number; price: number; lot_number?: string | null }
type Clinic = { id: string; name: string; corporate_name: string | null; clinic_type: string | null; adress: string | null; phone: string | null }

export default function DeliveryDetail({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params)
  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [clinic, setClinic] = useState<Clinic | null>(null)
  const [loading, setLoading] = useState(true)
  const [lotMap, setLotMap] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { (async () => {
    const { data: o } = await supabase.from("orders").select("*").eq("id", orderId).single()
    if (!o) { setLoading(false); return }
    setOrder(o as Order)
    const { data: i } = await supabase.from("order_items").select("*").eq("order_id", orderId)
    const itemData = (i as Item[]) || []
    setItems(itemData)
    // LOTマップを初期化
    const map: Record<string, string> = {}
    itemData.forEach(it => { map[it.id] = it.lot_number || "" })
    setLotMap(map)
    if (o.clinic_id) {
      const { data: c } = await supabase.from("clinics").select("*").eq("id", o.clinic_id).single()
      setClinic(c as Clinic)
    }
    setLoading(false)
  })() }, [orderId])

  async function saveLots() {
    setSaving(true)
    setSaved(false)
    for (const item of items) {
      const lot = lotMap[item.id] ?? ""
      await supabase.from("order_items")
        .update({ lot_number: lot || null })
        .eq("id", item.id)
    }
    // ローカル state を更新
    setItems(prev => prev.map(it => ({ ...it, lot_number: lotMap[it.id] || null })))
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>
  if (!order) return <p className="text-red-600 text-center py-12">納品書が見つかりません</p>

  // LOTが設定された item を作成（印刷用）
  const itemsWithLot = items.map(it => ({ ...it, lot_number: lotMap[it.id] || it.lot_number || null }))

  const ITEMS_PER_PAGE = 10
  const pages: Item[][] = []
  for (let i = 0; i < Math.max(1, itemsWithLot.length); i += ITEMS_PER_PAGE) {
    pages.push(itemsWithLot.slice(i, i + ITEMS_PER_PAGE))
  }

  return (
    <div>
      {/* ── LOT編集パネル（印刷時は非表示） ── */}
      <div className="no-print" style={{
        background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
        padding: "16px 20px", margin: "12px 12px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link href="/admin/deliveries" style={{ fontSize: 12, color: "#6b7280", textDecoration: "underline" }}>← 一覧</Link>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
              🏷 LOT番号の入力
            </h2>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={saveLots}
              disabled={saving}
              style={{
                padding: "8px 20px", background: saving ? "#9ca3af" : "#2563eb", color: "#fff",
                border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "保存中…" : "💾 LOTを保存"}
            </button>
            <button onClick={() => window.print()} style={{
              padding: "8px 16px", background: "#111", color: "#fff",
              border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}>
              🖨 印刷
            </button>
          </div>
        </div>

        {saved && (
          <div style={{ marginBottom: 10, padding: "7px 12px", background: "#dcfce7", borderRadius: 7, fontSize: 13, color: "#166534", fontWeight: 600 }}>
            ✓ LOT番号を保存しました
          </div>
        )}

        <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
          ※ LOT番号を入力して「LOTを保存」→ 印刷すると納品書にLOTが記載されます。不要な商品は空欄のままにしてください。
        </p>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              <th style={{ padding: "8px 10px", textAlign: "left", borderBottom: "1px solid #e5e7eb", fontWeight: 600, color: "#374151" }}>商品名</th>
              <th style={{ padding: "8px 10px", textAlign: "center", borderBottom: "1px solid #e5e7eb", fontWeight: 600, color: "#374151", width: 60 }}>数量</th>
              <th style={{ padding: "8px 10px", textAlign: "left", borderBottom: "1px solid #e5e7eb", fontWeight: 600, color: "#374151", width: 200 }}>LOT番号</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "8px 10px", color: "#111" }}>{item.product_name || "—"}</td>
                <td style={{ padding: "8px 10px", textAlign: "center", color: "#6b7280" }}>{item.quantity}</td>
                <td style={{ padding: "8px 10px" }}>
                  <input
                    type="text"
                    value={lotMap[item.id] ?? ""}
                    onChange={e => setLotMap(prev => ({ ...prev, [item.id]: e.target.value }))}
                    placeholder="例: 24A012"
                    style={{
                      width: "100%", padding: "5px 9px", border: "1px solid #d1d5db",
                      borderRadius: 6, fontSize: 13, outline: "none",
                      background: lotMap[item.id] ? "#eff6ff" : "#fff",
                      boxSizing: "border-box" as const,
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── 納品書プレビュー ── */}
      {pages.map((pageItems, idx) => (
        <DeliveryNoteSheet
          key={idx}
          order={order}
          items={pageItems}
          clinic={clinic}
        />
      ))}

      <style jsx global>{`
        @media print {
          body { background: #fff !important; }
          .no-print { display: none !important; }
          @page { size: A4; margin: 0; }
        }
        @media screen {
          body { background: #f3f4f6; }
          .delivery-page { box-shadow: 0 4px 12px rgba(0,0,0,0.08); margin-bottom: 20px !important; }
        }
      `}</style>
    </div>
  )
}
