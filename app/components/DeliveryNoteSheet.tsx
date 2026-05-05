"use client"

// 納品書 1注文 = A4 1枚
// 上半分: 得意先控え / 中央: 切り取り線 / 下半分: 自社控え（受領印）
// 商品が多い場合は CSS @page で自然改ページ

import { fmtYen, calcTax, getClinicPrefix, getCorporateLabel } from "@/lib/invoice"
import { COMPANY } from "@/lib/company"
import Seal from "@/app/components/Seal"

type Item = { id: string; product_name: string | null; quantity: number; price: number }
type Clinic = { id?: string; name: string; corporate_name: string | null; clinic_type: string | null; adress: string | null; phone: string | null }
type Order = { id: string; delivered_at: string | null; created_at: string; delivery_number: string | null; note?: string | null }

export default function DeliveryNoteSheet({
  order, items, clinic,
}: {
  order: Order
  items: Item[]
  clinic: Clinic | null
}) {
  const subtotal = items.reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 0), 0)
  const tax = calcTax(subtotal)
  const total = subtotal + tax
  const dateStr = (order.delivered_at || order.created_at).slice(0, 10).replace(/-/g, "/")
  const corporateLabel = clinic ? getCorporateLabel(clinic.corporate_name, clinic.name, clinic.clinic_type) : ""
  const prefix = clinic ? getClinicPrefix(clinic.name, clinic.corporate_name, clinic.clinic_type) : ""

  function Half({ kind }: { kind: "customer" | "self" }) {
    return (
      <div style={{
        position: "relative",
        padding: "8mm 10mm",
        boxSizing: "border-box",
        // A4 (297mm) - 切取線 8mm = 289mm を上下で2分 → 144.5mm
        // border 1.5mm 等を考慮しても 297mm を超えないように calc で正確に半分に
        height: "calc((297mm - 8mm) / 2)",
      }}>
        {/* 控え種別タグ */}
        <div style={{
          position: "absolute", top: 4, right: 8, fontSize: 9, fontWeight: 700, padding: "1px 6px",
          border: `1px solid ${kind === "customer" ? "#0d9488" : "#dc2626"}`,
          color: kind === "customer" ? "#0d9488" : "#dc2626", borderRadius: 3,
        }}>
          {kind === "customer" ? "得意先控え" : "自社控え"}
        </div>

        {/* タイトル */}
        <div style={{ borderBottom: "1.5px solid #111", paddingBottom: 4, marginBottom: 8 }}>
          <h1 style={{ fontSize: 18, letterSpacing: "0.3em", margin: "4px 0 2px", textAlign: "center" }}>納 品 書</h1>
          <p style={{ textAlign: "center", margin: 0, fontSize: 9, color: "#666" }}>No. {order.delivery_number || order.id.slice(0, 8)}</p>
        </div>

        {/* 宛先 + 自社 */}
        <div style={{ display: "flex", gap: 12, marginBottom: 4 }}>
          <div style={{ flex: 1 }}>
            {corporateLabel && <p style={{ margin: "0 0 1px", fontSize: 9, color: "#444" }}>{corporateLabel}</p>}
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, borderBottom: "1px solid #111", paddingBottom: 2 }}>
              {prefix}{clinic?.name || "(医院不明)"} 御中
            </p>
            {clinic?.adress && <p style={{ margin: "2px 0 0", fontSize: 8, color: "#666" }}>{clinic.adress}</p>}
            {clinic?.phone && <p style={{ margin: 0, fontSize: 8, color: "#666" }}>TEL {clinic.phone}</p>}
            <p style={{ margin: "4px 0 0", fontSize: 9, color: "#444" }}>納品日: {dateStr}</p>
          </div>
          <div style={{ flexShrink: 0, fontSize: 8, lineHeight: 1.3, position: "relative", paddingRight: 38, minWidth: 170 }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 700 }}>{COMPANY.name}</p>
            <p style={{ margin: 0 }}>〒{COMPANY.postalCode}</p>
            <p style={{ margin: 0 }}>{COMPANY.address}</p>
            <p style={{ margin: 0 }}>TEL {COMPANY.phone}</p>
            {COMPANY.fax && <p style={{ margin: 0 }}>FAX {COMPANY.fax}</p>}
            <div style={{ position: "absolute", top: -2, right: 0 }}><Seal size={36} /></div>
          </div>
        </div>

        {/* 明細表 */}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9 }}>
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th style={th}>商品名</th>
              <th style={{ ...th, textAlign: "right", width: 30 }}>数量</th>
              <th style={{ ...th, textAlign: "right", width: 50 }}>単価</th>
              <th style={{ ...th, textAlign: "right", width: 60 }}>金額</th>
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

        {/* 合計 + 受領印（自社控のみ） */}
        <div style={{ position: "absolute", left: "10mm", right: "10mm", bottom: "6mm", display: "flex", alignItems: "flex-end", gap: 8 }}>
          {kind === "self" && (
            <div style={{ display: "flex", gap: 6 }}>
              <div style={{ textAlign: "center", border: "1.5px solid #111", borderRadius: 3, padding: "2px 4px", minWidth: 64 }}>
                <p style={{ margin: 0, fontSize: 8, color: "#666" }}>受領印</p>
                <div style={{ width: 44, height: 44, margin: "2px auto", border: "1px dashed #aaa", borderRadius: 3 }}></div>
              </div>
              <div style={{ textAlign: "center", border: "1.5px solid #111", borderRadius: 3, padding: "2px 4px", minWidth: 100, alignSelf: "flex-end" }}>
                <p style={{ margin: 0, fontSize: 8, color: "#666" }}>受領日</p>
                <div style={{ height: 18, lineHeight: "18px", margin: "2px 4px 0", borderBottom: "1px solid #aaa", color: "#bbb", fontSize: 9 }}>　年　月　日</div>
              </div>
            </div>
          )}
          <div style={{ flex: 1 }} />
          <table style={{ borderCollapse: "collapse", fontSize: 9, minWidth: 180 }}>
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
      height: "297mm",
      margin: "0 auto",
      background: "#fff",
      pageBreakAfter: "always" as const,
      position: "relative",
      boxSizing: "border-box",
      overflow: "hidden", // 印刷時の空白ページ防止: 297mm を絶対に超えないようにクリップ
    }}>
      <Half kind="customer" />
      {/* 切り取り線 (高さ8mm; border は box-sizing: border-box でも別計算されるため、box-sizing 必須) */}
      <div style={{
        height: "8mm", display: "flex", alignItems: "center", justifyContent: "center",
        borderTop: "1.5px dashed #888", borderBottom: "1.5px dashed #888",
        boxSizing: "border-box",
        position: "relative",
      }}>
        <span style={{ background: "#fff", padding: "0 12px", fontSize: 10, color: "#666", letterSpacing: "0.2em" }}>
          ✂　　切　り　取　り　線　　✂
        </span>
      </div>
      <Half kind="self" />
    </div>
  )
}

const th: React.CSSProperties = { padding: "3px 4px", textAlign: "left", borderBottom: "1.5px solid #ccc", fontSize: 9, color: "#555" }
const tdC: React.CSSProperties = { padding: "2px 4px", fontSize: 9 }
const tdSm: React.CSSProperties = { padding: "2px 8px", fontSize: 9, color: "#555", border: "1px solid #ddd", background: "#f9fafb" }
const tdSmR: React.CSSProperties = { padding: "2px 8px", fontSize: 9, textAlign: "right" as const, border: "1px solid #ddd", minWidth: 80 }
