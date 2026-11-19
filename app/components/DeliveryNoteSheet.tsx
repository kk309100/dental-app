"use client"

// 納品書 A4 1枚
// 上半分（148.5mm）: 納品書 / 下半分（148.5mm）: 納品書控え
// ※ <table> を使わず <div> フレックスで実装
//    → admin-base.css の table/td 強制スタイルを完全回避

import { fmtYen, calcTax, getClinicPrefix, getCorporateLabel } from "@/lib/invoice"
import { COMPANY } from "@/lib/company"
import Seal from "@/app/components/Seal"
import { QRCodeSVG } from "qrcode.react"

// print page の ITEMS_PER_PAGE と必ず合わせること
// QRコードを読める大きさ（17mm≒64px）にするため行高さ18mm → 5行/ハーフページ
export const FIXED_ROWS = 5

type Item   = { id: string; product_name: string | null; quantity: number; price: number; barcode?: string | null; lot_number?: string | null; note?: string | null }
type Clinic = { id?: string; name: string; corporate_name: string | null; clinic_type: string | null; adress: string | null; phone: string | null }
type Order  = { id: string; delivered_at: string | null; created_at: string; delivery_number: string | null; note?: string | null }

const ROW_H  = "16mm"  // QR読み取り可能サイズ確保（5行 × 18mm = 90mm）
const COL_NO = "8mm"   // 行番号
const COL_BC = "20mm"  // QRコード列幅
const COL_QT = "13mm"  // 数量
const COL_UP = "25mm"  // 単価
const COL_AM = "29mm"  // 金額
const QR_PX  = 58      // QRコードサイズ(px) ≈ 17mm印刷時 → スマホ読取OK
const INK = "#000"
const NAVY = "#1e3a5f"
const LINE = "#d1d5db"
const SOFT = "#f3f6fa"

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
  const grandItems = allItems && allItems.length > 0 ? allItems : items
  const subtotal = grandItems.reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 0), 0)
  const tax   = calcTax(subtotal)
  const total = subtotal + tax

  const dateStr = (order.delivered_at || order.created_at).slice(0, 10).replace(/-/g, "/")
  const corporateLabel = clinic ? getCorporateLabel(clinic.corporate_name, clinic.name, clinic.clinic_type) : ""
  const prefix = clinic ? getClinicPrefix(clinic.name, clinic.corporate_name, clinic.clinic_type) : ""
  const isMultiPage = totalPages !== undefined && totalPages > 1
  const pageLabel = isMultiPage ? `（${pageNum ?? 1} / ${totalPages}ページ）` : ""
  const emptyRows = Math.max(0, FIXED_ROWS - items.length)

  const th = (extra?: React.CSSProperties): React.CSSProperties => ({
    padding: "0 6px", fontSize: 11, fontWeight: 700, color: "#fff", letterSpacing: "0.12em",
    display: "flex", alignItems: "center", ...extra,
  })
  const td = (extra?: React.CSSProperties): React.CSSProperties => ({
    padding: "0 6px", fontSize: 13, display: "flex", alignItems: "center", overflow: "hidden", color: INK, ...extra,
  })

  function Half({ kind }: { kind: "original" | "copy" }) {
    const isCopy = kind === "copy"
    const accent = isCopy ? "#374151" : NAVY
    return (
      <div style={{
        position: "relative", padding: "3mm 7mm 1mm 12mm", boxSizing: "border-box",
        height: "148.5mm", overflow: "hidden", color: INK,
        borderTop: isCopy ? "1px dashed #9ca3af" : "none",
      }}>
        {/* タイトル行 */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", borderBottom: `2.5px solid ${accent}`, paddingBottom: 2 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: "0.45em", color: accent }}>{isCopy ? "納品書控" : "納品書"}</span>
            {pageLabel && <span style={{ fontSize: 9, color: "#000" }}>{pageLabel}</span>}
          </div>
          <div style={{ textAlign: "right", fontSize: 10.5, lineHeight: 1.45, color: "#000" }}>
            <div>納品日　<b style={{ fontSize: 12 }}>{dateStr}</b></div>
            <div>No. <b>{order.delivery_number || order.id.slice(0, 8)}</b></div>
          </div>
        </div>

        {/* 宛先 + 自社 */}
        <div style={{ display: "flex", gap: 12, marginTop: 4, marginBottom: 4 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {corporateLabel && <div style={{ fontSize: 10, color: "#000" }}>{corporateLabel}</div>}
            <div style={{ fontSize: 16, fontWeight: 700, borderBottom: `1px solid ${INK}`, paddingBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {prefix}{clinic?.name || "(医院不明)"}<span style={{ fontSize: 11, fontWeight: 400, marginLeft: 8 }}>御中</span>
            </div>
            {clinic?.adress && <div style={{ fontSize: 10, color: "#000", marginTop: 2 }}>{clinic.adress}</div>}
            {clinic?.phone && <div style={{ fontSize: 10, color: "#000" }}>TEL {clinic.phone}</div>}
          </div>
          <div style={{ flexShrink: 0, fontSize: 10, lineHeight: 1.4, position: "relative", paddingRight: 40, minWidth: 170, color: "#000" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: INK }}>{COMPANY.name}</div>
            <div>〒{COMPANY.postalCode}　{COMPANY.address}</div>
            <div>TEL {COMPANY.phone}{COMPANY.fax ? `　FAX ${COMPANY.fax}` : ""}</div>
            <div style={{ position: "absolute", top: -2, right: 0 }}><Seal size={36} /></div>
          </div>
        </div>

        {/* 注文時のメモ */}
        {order.note && !order.note.startsWith("売上CSV取込") && (
          <div style={{ fontSize: 9, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 3, padding: "1px 6px", marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            📝 {order.note}
          </div>
        )}

        {/* 明細 */}
        <div style={{ width: "100%", border: `1px solid ${LINE}`, borderRadius: 3, overflow: "hidden" }}>
          <div style={{ display: "flex", background: accent, height: "6mm" }}>
            <div style={th({ width: COL_NO, justifyContent: "center", padding: 0 })}>No</div>
            <div style={th({ flex: 1 })}>商品名</div>
            <div style={th({ width: COL_BC, justifyContent: "center" })}>QR</div>
            <div style={th({ width: COL_QT, justifyContent: "flex-end" })}>数量</div>
            <div style={th({ width: COL_UP, justifyContent: "flex-end" })}>単価</div>
            <div style={th({ width: COL_AM, justifyContent: "flex-end" })}>金額</div>
          </div>

          {items.map((i, n) => (
            <div key={i.id} style={{ display: "flex", alignItems: "center", borderTop: n ? `1px solid ${LINE}` : "none", height: ROW_H, background: n % 2 ? SOFT : "#fff" }}>
              <div style={td({ width: COL_NO, justifyContent: "center", padding: 0, fontSize: 10, color: "#000" })}>{(((pageNum ?? 1) - 1) * FIXED_ROWS) + n + 1}</div>
              <div style={td({ flex: 1, minWidth: 0, alignItems: "flex-start", flexDirection: "column", justifyContent: "center" })}>
                <div style={{ fontSize: 13.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>{i.product_name || "—"}</div>
                {i.lot_number && <div style={{ fontSize: 9.5, color: "#000", whiteSpace: "nowrap", marginTop: 2 }}>LOT: {i.lot_number}</div>}
                {i.note && <div style={{ fontSize: 10, color: "#000", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%", marginTop: 1 }}>備考: {i.note}</div>}
              </div>
              <div style={{ width: COL_BC, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {i.barcode ? <QRCodeSVG value={i.barcode} size={QR_PX} level="M" marginSize={1} /> : null}
              </div>
              <div style={td({ width: COL_QT, justifyContent: "flex-end", fontWeight: 700, fontSize: 15 })}>{i.quantity}</div>
              <div style={td({ width: COL_UP, justifyContent: "flex-end" })}>{fmtYen(i.price)}</div>
              <div style={td({ width: COL_AM, justifyContent: "flex-end", fontWeight: 700, fontSize: 15 })}>{fmtYen(Number(i.quantity) * Number(i.price))}</div>
            </div>
          ))}

          {Array.from({ length: emptyRows }).map((_, idx) => (
            <div key={`e-${idx}`} style={{ height: ROW_H, borderTop: `1px solid ${LINE}`, background: (items.length + idx) % 2 ? SOFT : "#fff" }} />
          ))}
        </div>

        {/* 受領印 + 合計 */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginTop: 4 }}>
          {isCopy && (
            <div style={{ display: "flex", gap: 6 }}>
              <div style={{ textAlign: "center", border: `1px solid ${INK}`, borderRadius: 3, padding: "1px 4px", minWidth: 54 }}>
                <div style={{ fontSize: 8, color: "#000" }}>受領印</div>
                <div style={{ width: 34, height: 20, margin: "1px auto" }} />
              </div>
              <div style={{ textAlign: "center", border: `1px solid ${INK}`, borderRadius: 3, padding: "1px 4px", minWidth: 84 }}>
                <div style={{ fontSize: 8, color: "#000" }}>受領日</div>
                <div style={{ height: 20, lineHeight: "26px", color: "#000", fontSize: 9 }}>　年　月　日</div>
              </div>
            </div>
          )}
          <div style={{ flex: 1 }} />
          <div style={{ minWidth: "72mm", border: `1px solid ${LINE}`, borderRadius: 3, overflow: "hidden" }}>
            {[
              { label: "小計", val: fmtYen(subtotal) },
              { label: "消費税(10%)", val: fmtYen(tax) },
            ].map(row => (
              <div key={row.label} style={{ display: "flex", borderBottom: `1px solid ${LINE}`, fontSize: 11.5 }}>
                <div style={{ flex: 1, padding: "1px 8px", color: "#000" }}>{row.label}</div>
                <div style={{ padding: "1px 8px", textAlign: "right", minWidth: "28mm" }}>{row.val}</div>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", background: accent, color: "#fff" }}>
              <div style={{ flex: 1, padding: "2px 8px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em" }}>合計（税込）</div>
              <div style={{ padding: "2px 8px", fontSize: 16, fontWeight: 800, textAlign: "right", minWidth: "34mm" }}>{fmtYen(total)}</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`delivery-page${isLastSheet ? " delivery-page-last" : ""}`}
      style={{
        width: "210mm",
        height: "297mm",
        margin: "0 auto",
        background: "#fff",
        boxSizing: "border-box",
        overflow: "hidden",
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    >
      <Half kind="original" />
      <Half kind="copy" />
    </div>
  )
}
