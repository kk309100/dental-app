"use client"

// 納品書 A4 1枚
// 上半分（148.5mm）: 納品書 / 下半分（148.5mm）: 納品書控え
// 商品が多い場合は ITEMS_PER_PAGE で分割し、複数枚に印刷する

import { fmtYen, calcTax, getClinicPrefix, getCorporateLabel } from "@/lib/invoice"
import { COMPANY } from "@/lib/company"
import Seal from "@/app/components/Seal"

type Item = { id: string; product_name: string | null; quantity: number; price: number }
type Clinic = { id?: string; name: string; corporate_name: string | null; clinic_type: string | null; adress: string | null; phone: string | null }
type Order = { id: string; delivered_at: string | null; created_at: string; delivery_number: string | null; note?: string | null }

export default function DeliveryNoteSheet({
  order, items, clinic,
  allItems,
  pageNum,
  totalPages,
  isLastSheet,
}: {
  order: Order
  items: Item[]
  clinic: Clinic | null
  allItems?: Item[]
  pageNum?: number
  totalPages?: number
  isLastSheet?: boolean
}) {
  // 合計は注文全体で計算（分割時も同じ合計を表示）
  const grandItems = allItems && allItems.length > 0 ? allItems : items
  const subtotal = grandItems.reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 0), 0)
  const tax = calcTax(subtotal)
  const total = subtotal + tax

  const dateStr = (order.delivered_at || order.created_at).slice(0, 10).replace(/-/g, "/")
  const corporateLabel = clinic ? getCorporateLabel(clinic.corporate_name, clinic.name, clinic.clinic_type) : ""
  const prefix = clinic ? getClinicPrefix(clinic.name, clinic.corporate_name, clinic.clinic_type) : ""
  const isMultiPage = totalPages !== undefined && totalPages > 1
  const pageLabel = isMultiPage ? `（${pageNum ?? 1} / ${totalPages}ページ）` : ""

  // kind: "original" = 納品書（上）、"copy" = 納品書控え（下）
  function Half({ kind }: { kind: "original" | "copy" }) {
    const isCopy = kind === "copy"
    return (
      <div className="delivery-half" style={{
        position: "relative",
        // padding を詰めて明細行数を最大化
        padding: "4mm 8mm",
        boxSizing: "border-box",
        minHeight: "148.5mm",
        // 控えは上部に区切り線
        borderTop: isCopy ? "1.5px solid #555" : "none",
      }}>

        {/* 種別タグ（右上） */}
        <div style={{
          position: "absolute", top: 5, right: 6,
          fontSize: 8, fontWeight: 700, padding: "1px 6px",
          border: `1px solid ${isCopy ? "#6b7280" : "#2563eb"}`,
          color: isCopy ? "#6b7280" : "#2563eb",
          borderRadius: 3,
          background: "#fff",
        }}>
          {isCopy ? "納品書控え" : "納品書"}
        </div>

        {/* タイトル */}
        <div style={{ borderBottom: "1.5px solid #111", paddingBottom: 3, marginBottom: 4 }}>
          <h1 style={{ fontSize: 16, letterSpacing: "0.3em", margin: "2px 0 1px", textAlign: "center" }}>
            {isCopy ? "納 品 書 控" : "納 品 書"}
          </h1>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 8, color: "#666" }}>No. {order.delivery_number || order.id.slice(0, 8)}</p>
            {pageLabel && <p style={{ margin: 0, fontSize: 8, color: "#999" }}>{pageLabel}</p>}
          </div>
        </div>

        {/* 宛先 + 自社 */}
        <div style={{ display: "flex", gap: 10, marginBottom: 3 }}>
          <div style={{ flex: 1 }}>
            {corporateLabel && <p style={{ margin: "0 0 0px", fontSize: 8, color: "#444" }}>{corporateLabel}</p>}
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, borderBottom: "1px solid #111", paddingBottom: 1 }}>
              {prefix}{clinic?.name || "(医院不明)"} 御中
            </p>
            {clinic?.adress && <p style={{ margin: "1px 0 0", fontSize: 7.5, color: "#666" }}>{clinic.adress}</p>}
            {clinic?.phone && <p style={{ margin: 0, fontSize: 7.5, color: "#666" }}>TEL {clinic.phone}</p>}
            <p style={{ margin: "2px 0 0", fontSize: 8, color: "#444" }}>納品日: {dateStr}</p>
          </div>
          <div style={{ flexShrink: 0, fontSize: 7.5, lineHeight: 1.3, position: "relative", paddingRight: 36, minWidth: 160 }}>
            <p style={{ margin: 0, fontSize: 9, fontWeight: 700 }}>{COMPANY.name}</p>
            <p style={{ margin: 0 }}>〒{COMPANY.postalCode}</p>
            <p style={{ margin: 0 }}>{COMPANY.address}</p>
            <p style={{ margin: 0 }}>TEL {COMPANY.phone}</p>
            {COMPANY.fax && <p style={{ margin: 0 }}>FAX {COMPANY.fax}</p>}
            <div style={{ position: "absolute", top: -2, right: 0 }}><Seal size={32} /></div>
          </div>
        </div>

        {/* 明細表 */}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9 }}>
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th style={th}>商品名</th>
              <th style={{ ...th, textAlign: "right", width: 28 }}>数量</th>
              <th style={{ ...th, textAlign: "right", width: 48 }}>単価</th>
              <th style={{ ...th, textAlign: "right", width: 58 }}>金額</th>
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
        </table>

        {/* 合計 + 受領印（控えのみ） */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginTop: 6 }}>
          {isCopy && (
            <div style={{ display: "flex", gap: 5 }}>
              <div style={{ textAlign: "center", border: "1.5px solid #111", borderRadius: 3, padding: "2px 3px", minWidth: 58 }}>
                <p style={{ margin: 0, fontSize: 7.5, color: "#666" }}>受領印</p>
                <div style={{ width: 40, height: 40, margin: "2px auto", border: "1px dashed #aaa", borderRadius: 3 }}></div>
              </div>
              <div style={{ textAlign: "center", border: "1.5px solid #111", borderRadius: 3, padding: "2px 3px", minWidth: 90, alignSelf: "flex-end" }}>
                <p style={{ margin: 0, fontSize: 7.5, color: "#666" }}>受領日</p>
                <div style={{ height: 16, lineHeight: "16px", margin: "2px 3px 0", borderBottom: "1px solid #aaa", color: "#bbb", fontSize: 8 }}>　年　月　日</div>
              </div>
            </div>
          )}
          <div style={{ flex: 1 }} />
          <table style={{ borderCollapse: "collapse", fontSize: 9, minWidth: 175 }}>
            <tbody>
              <tr><td style={tdSm}>小計</td><td style={tdSmR}>{fmtYen(subtotal)}</td></tr>
              <tr><td style={tdSm}>消費税(10%)</td><td style={tdSmR}>{fmtYen(tax)}</td></tr>
              <tr style={{ background: "#fef3c7" }}><td style={{ ...tdSm, fontWeight: 700 }}>合計</td><td style={{ ...tdSmR, fontWeight: 700, fontSize: 11 }}>{fmtYen(total)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="delivery-page" style={{
      width: "210mm",
      minHeight: "297mm",
      margin: "0 auto",
      background: "#fff",
      pageBreakAfter: isLastSheet ? "auto" : "always",
      boxSizing: "border-box",
    }}>
      <Half kind="original" />
      <Half kind="copy" />
    </div>
  )
}

const th: React.CSSProperties = { padding: "2.5px 4px", textAlign: "left", borderBottom: "1.5px solid #ccc", fontSize: 8.5, color: "#555" }
const tdC: React.CSSProperties = { padding: "1.5px 4px", fontSize: 9 }
const tdSm: React.CSSProperties = { padding: "2px 7px", fontSize: 9, color: "#555", border: "1px solid #ddd", background: "#f9fafb" }
const tdSmR: React.CSSProperties = { padding: "2px 7px", fontSize: 9, textAlign: "right" as const, border: "1px solid #ddd", minWidth: 78 }
