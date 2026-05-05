"use client"

import { use, useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { fmtYen, calcTax, getClinicPrefix, getCorporateLabel } from "@/lib/invoice"
import { COMPANY } from "@/lib/company"
import Seal from "@/app/components/Seal"

type Order = { id: string; clinic_id: string; created_at: string; delivered_at: string | null; total_price: number; delivery_number: string | null; sales_rep: string | null; note: string | null; status: string }
type Item = { id: string; order_id: string; product_name: string | null; quantity: number; price: number }
type Clinic = { id: string; name: string; corporate_name: string | null; clinic_type: string | null; adress: string | null; phone: string | null }

export default function DeliveryDetail({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params)
  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [clinic, setClinic] = useState<Clinic | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { (async () => {
    const { data: o } = await supabase.from("orders").select("*").eq("id", orderId).single()
    if (!o) { setLoading(false); return }
    setOrder(o as Order)
    const { data: i } = await supabase.from("order_items").select("*").eq("order_id", orderId)
    setItems((i as Item[]) || [])
    if (o.clinic_id) {
      const { data: c } = await supabase.from("clinics").select("*").eq("id", o.clinic_id).single()
      setClinic(c as Clinic)
    }
    setLoading(false)
  })() }, [orderId])

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>
  if (!order) return <p className="text-red-600 text-center py-12">納品書が見つかりません</p>

  const subtotal = items.reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 0), 0)
  const tax = calcTax(subtotal)
  const total = subtotal + tax
  const dateStr = (order.delivered_at || order.created_at).slice(0, 10)
  const corporateLabel = clinic ? getCorporateLabel(clinic.corporate_name, clinic.name, clinic.clinic_type) : ""
  const prefix = clinic ? getClinicPrefix(clinic.name, clinic.corporate_name, clinic.clinic_type) : ""

  function NoteSheet({ kind }: { kind: "customer" | "self" }) {
    return (
      <main className="bg-white max-w-3xl mx-auto p-8 print-area" style={{ border: "1px solid #e8eaed", marginBottom: 16, pageBreakAfter: "always" as const, position: "relative" }}>
        {/* 控えタグ（右上） */}
        <div style={{ position: "absolute", top: 12, right: 12, fontSize: 11, fontWeight: 700, padding: "3px 10px", border: `1.5px solid ${kind === "customer" ? "#0d9488" : "#dc2626"}`, color: kind === "customer" ? "#0d9488" : "#dc2626", borderRadius: 4 }}>
          {kind === "customer" ? "【 得意先控え 】" : "【 自社控え 】"}
        </div>
        <header style={{ borderBottom: "2px solid #111", paddingBottom: 8 }}>
          <h1 style={{ fontSize: 28, letterSpacing: "0.3em", margin: "20px 0 4px", textAlign: "center" }}>納 品 書</h1>
          <p style={{ textAlign: "center", margin: 0, fontSize: 11, color: "#666" }}>No. {order!.delivery_number || order!.id.slice(0, 8)}</p>
        </header>
        <div style={{ display: "flex", gap: 20, marginTop: 24 }}>
          <div style={{ flex: 1 }}>
            {corporateLabel && <p style={{ margin: "0 0 4px", fontSize: 13, color: "#444" }}>{corporateLabel}</p>}
            <p style={{ margin: 0, fontSize: 22, fontWeight: 700, borderBottom: "1px solid #111", paddingBottom: 6 }}>
              {prefix}{clinic?.name || "(医院不明)"}　御中
            </p>
            {clinic?.adress && <p style={{ margin: "6px 0 0", fontSize: 11, color: "#666" }}>{clinic.adress}</p>}
            {clinic?.phone && <p style={{ margin: "2px 0 0", fontSize: 11, color: "#666" }}>TEL {clinic.phone}</p>}
          </div>
          <div style={{ flexShrink: 0, fontSize: 11, lineHeight: 1.6, position: "relative", paddingRight: 70 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{COMPANY.name}</p>
            <p style={{ margin: 0 }}>〒{COMPANY.postalCode}</p>
            <p style={{ margin: 0 }}>{COMPANY.address}</p>
            <p style={{ margin: 0 }}>TEL {COMPANY.phone}</p>
            {COMPANY.fax && <p style={{ margin: 0 }}>FAX {COMPANY.fax}</p>}
            <div style={{ position: "absolute", top: 0, right: 0 }}><Seal size={64} /></div>
          </div>
        </div>
        <p style={{ margin: "16px 0 6px", fontSize: 11, color: "#666" }}>納品日: {dateStr.replace(/-/g, "/")}</p>
        <table style={{ width: "100%", marginTop: 6, borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th style={th}>商品名</th>
              <th style={{ ...th, textAlign: "right", width: 60 }}>数量</th>
              <th style={{ ...th, textAlign: "right", width: 80 }}>単価</th>
              <th style={{ ...th, textAlign: "right", width: 90 }}>金額</th>
            </tr>
          </thead>
          <tbody>
            {items.map(i => (
              <tr key={i.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={tdC}>{i.product_name || "—"}</td>
                <td style={{ ...tdC, textAlign: "right" }}>{i.quantity}</td>
                <td style={{ ...tdC, textAlign: "right" }}>{fmtYen(i.price)}</td>
                <td style={{ ...tdC, textAlign: "right", fontWeight: 700 }}>{fmtYen(Number(i.quantity) * Number(i.price))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "#f9fafb" }}>
              <td colSpan={3} style={{ ...tdC, textAlign: "right" }}>小計</td>
              <td style={{ ...tdC, textAlign: "right" }}>{fmtYen(subtotal)}</td>
            </tr>
            <tr style={{ background: "#f9fafb" }}>
              <td colSpan={3} style={{ ...tdC, textAlign: "right" }}>消費税(10%)</td>
              <td style={{ ...tdC, textAlign: "right" }}>{fmtYen(tax)}</td>
            </tr>
            <tr style={{ background: "#f9fafb" }}>
              <td colSpan={3} style={{ ...tdC, textAlign: "right", fontWeight: 700 }}>合計</td>
              <td style={{ ...tdC, textAlign: "right", fontWeight: 700, fontSize: 14 }}>{fmtYen(total)}</td>
            </tr>
          </tfoot>
        </table>
        {order!.note && <div style={{ marginTop: 16, padding: 10, background: "#f9fafb", borderRadius: 4, fontSize: 11, color: "#555" }}>備考: {order!.note}</div>}

        {/* 自社控えのみ受領印枠 */}
        {kind === "self" && (
          <div style={{ marginTop: 24, display: "flex", gap: 20, alignItems: "flex-end", justifyContent: "flex-end" }}>
            <div style={{ textAlign: "center", border: "2px solid #111", borderRadius: 4, padding: 8, minWidth: 130 }}>
              <p style={{ margin: 0, fontSize: 11, color: "#666" }}>受領印</p>
              <div style={{ width: 80, height: 80, margin: "8px auto 4px", border: "1.5px dashed #aaa", borderRadius: 4 }}></div>
              <p style={{ margin: 0, fontSize: 9, color: "#999" }}>（受領サイン or 印鑑）</p>
            </div>
            <div style={{ textAlign: "center", border: "2px solid #111", borderRadius: 4, padding: 8, minWidth: 180 }}>
              <p style={{ margin: 0, fontSize: 11, color: "#666" }}>受領日</p>
              <div style={{ height: 40, lineHeight: "40px", margin: "8px 8px 4px", borderBottom: "1px solid #aaa", color: "#bbb", fontSize: 12 }}>　　　年　　月　　日</div>
            </div>
          </div>
        )}
      </main>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2 no-print">
        <Link href="/admin/deliveries" className="text-xs text-gray-500 underline">← 一覧</Link>
        <button onClick={() => window.print()} className="text-xs px-3 py-1.5 bg-gray-900 text-white rounded">🖨 印刷（2部: 得意先控+自社控）</button>
      </div>

      <NoteSheet kind="customer" />
      <NoteSheet kind="self" />

      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          .print-area { box-shadow: none !important; border: none !important; max-width: none !important; margin-bottom: 0 !important; }
          @page { size: A4; margin: 10mm; }
        }
      `}</style>
    </div>
  )
}

const th: React.CSSProperties = { padding: "6px 8px", textAlign: "left", borderBottom: "2px solid #ddd", fontSize: 11, color: "#555" }
const tdC: React.CSSProperties = { padding: "6px 8px", fontSize: 12 }
