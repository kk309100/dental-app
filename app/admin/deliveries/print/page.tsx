"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { fmtYen, calcTax, getClinicPrefix, getCorporateLabel } from "@/lib/invoice"
import { COMPANY } from "@/lib/company"
import Seal from "@/app/components/Seal"

type Order = { id: string; clinic_id: string; created_at: string; delivered_at: string | null; total_price: number; delivery_number: string | null }
type Item = { id: string; order_id: string; product_name: string | null; quantity: number; price: number }
type Clinic = { id: string; name: string; corporate_name: string | null; clinic_type: string | null; adress: string | null; phone: string | null }

export default function BulkPrintWrapper() {
  return (
    <Suspense fallback={<p>読み込み中…</p>}>
      <BulkPrint />
    </Suspense>
  )
}

function BulkPrint() {
  const sp = useSearchParams()
  const ids = (sp.get("ids") || "").split(",").filter(Boolean)
  const [orders, setOrders] = useState<Order[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])

  useEffect(() => {
    if (ids.length === 0) return
    Promise.all([
      supabase.from("orders").select("*").in("id", ids),
      supabase.from("order_items").select("*").in("order_id", ids),
      supabase.from("clinics").select("*"),
    ]).then(([o, i, c]) => {
      setOrders((o.data as Order[]) || [])
      setItems((i.data as Item[]) || [])
      setClinics((c.data as Clinic[]) || [])
      setTimeout(() => window.print(), 800)
    })
  }, [ids.join(",")])

  const clinicBy = new Map(clinics.map(c => [c.id, c]))
  const itemsByOrder = new Map<string, Item[]>()
  items.forEach(i => { if (!itemsByOrder.has(i.order_id)) itemsByOrder.set(i.order_id, []); itemsByOrder.get(i.order_id)!.push(i) })

  return (
    <>
      <div className="no-print p-4 bg-yellow-50 border-b border-yellow-200 sticky top-0">
        <button onClick={() => window.print()} className="px-4 py-2 bg-gray-900 text-white text-sm rounded mr-2">🖨 印刷</button>
        <button onClick={() => window.close()} className="px-4 py-2 bg-gray-200 text-sm rounded">閉じる</button>
        <span className="ml-3 text-xs text-gray-700">{orders.length}件の納品書</span>
      </div>
      {orders.map(o => {
        const cl = clinicBy.get(o.clinic_id)
        const its = itemsByOrder.get(o.id) || []
        const subtotal = its.reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 0), 0)
        const tax = calcTax(subtotal)
        const total = subtotal + tax
        const dateStr = (o.delivered_at || o.created_at).slice(0, 10)
        const corporateLabel = cl ? getCorporateLabel(cl.corporate_name, cl.name, cl.clinic_type) : ""
        const prefix = cl ? getClinicPrefix(cl.name, cl.corporate_name, cl.clinic_type) : ""
        return (
          <main key={o.id} className="bg-white max-w-3xl mx-auto p-8 mb-8 print-page" style={{ pageBreakAfter: "always", minHeight: "27cm" }}>
            <header style={{ borderBottom: "2px solid #111", paddingBottom: 8 }}>
              <h1 style={{ fontSize: 28, letterSpacing: "0.3em", margin: "20px 0 4px", textAlign: "center" }}>納 品 書</h1>
              <p style={{ textAlign: "center", margin: 0, fontSize: 11, color: "#666" }}>No. {o.delivery_number || o.id.slice(0, 8)}</p>
            </header>
            <div style={{ display: "flex", gap: 20, marginTop: 24 }}>
              <div style={{ flex: 1 }}>
                {corporateLabel && <p style={{ margin: "0 0 4px", fontSize: 13, color: "#444" }}>{corporateLabel}</p>}
                <p style={{ margin: 0, fontSize: 22, fontWeight: 700, borderBottom: "1px solid #111", paddingBottom: 6 }}>
                  {prefix}{cl?.name || "(医院不明)"}　御中
                </p>
                {cl?.adress && <p style={{ margin: "6px 0 0", fontSize: 11, color: "#666" }}>{cl.adress}</p>}
                {cl?.phone && <p style={{ margin: "2px 0 0", fontSize: 11, color: "#666" }}>TEL {cl.phone}</p>}
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
            <p style={{ margin: "16px 0 6px", fontSize: 11, color: "#666" }}>
              納品日: {dateStr.replace(/-/g, "/")}
            </p>
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
                {its.map(i => (
                  <tr key={i.id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={tdC}>{i.product_name || "—"}</td>
                    <td style={{ ...tdC, textAlign: "right" }}>{i.quantity}</td>
                    <td style={{ ...tdC, textAlign: "right" }}>{fmtYen(i.price)}</td>
                    <td style={{ ...tdC, textAlign: "right", fontWeight: 700 }}>{fmtYen(Number(i.quantity) * Number(i.price))}</td>
                  </tr>
                ))}
                {/* 空行で 12 行確保 */}
                {Array.from({ length: Math.max(0, 12 - its.length) }).map((_, i) => (
                  <tr key={"e"+i} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={tdC}>&nbsp;</td><td style={tdC}></td><td style={tdC}></td><td style={tdC}></td>
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
          </main>
        )
      })}
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4; margin: 10mm; }
        }
      `}</style>
    </>
  )
}

const th: React.CSSProperties = { padding: "6px 8px", textAlign: "left", borderBottom: "2px solid #ddd", fontSize: 11, color: "#555" }
const tdC: React.CSSProperties = { padding: "6px 8px", fontSize: 12 }
