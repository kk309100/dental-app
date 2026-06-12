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

type Item   = { id: string; product_name: string | null; quantity: number; price: number; barcode?: string | null; lot_number?: string | null }
type Clinic = { id?: string; name: string; corporate_name: string | null; clinic_type: string | null; adress: string | null; phone: string | null }
type Order  = { id: string; delivered_at: string | null; created_at: string; delivery_number: string | null; note?: string | null }

const ROW_H  = "18mm"  // QR読み取り可能サイズ確保（5行 × 18mm = 90mm）
const COL_BC = "20mm"  // QRコード列幅
const COL_QT = "10mm"  // 数量（拡大）
const COL_UP = "24mm"  // 単価（拡大）
const COL_AM = "28mm"  // 金額（拡大）
const QR_PX  = 64      // QRコードサイズ(px) ≈ 17mm印刷時 → スマホ読取OK

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

  // ── 列ヘッダー共通スタイル ─────────────────────────
  const colHead = (extra?: React.CSSProperties): React.CSSProperties => ({
    padding: "2px 4px",
    fontSize: 9.5,
    fontWeight: 700,
    color: "#555",
    ...extra,
  })
  // ── データセル共通スタイル ─────────────────────────
  const cell = (extra?: React.CSSProperties): React.CSSProperties => ({
    padding: "1px 4px",
    fontSize: 10,
    display: "flex",
    alignItems: "center",
    overflow: "hidden",
    ...extra,
  })

  function Half({ kind }: { kind: "original" | "copy" }) {
    const isCopy = kind === "copy"
    return (
      <div style={{
        position: "relative",
        padding: "2mm 4mm 1mm 10mm",
        boxSizing: "border-box",
        height: "148.5mm",
        overflow: "hidden",
        borderTop: isCopy ? "1.5px solid #555" : "none",
      }}>
        {/* 種別タグ */}
        <div style={{
          position: "absolute", top: 4, right: 6,
          fontSize: 8, fontWeight: 700, padding: "1px 6px",
          border: `1px solid ${isCopy ? "#6b7280" : "#2563eb"}`,
          color: isCopy ? "#6b7280" : "#2563eb",
          borderRadius: 3, background: "#fff",
        }}>
          {isCopy ? "納品書控え" : "納品書"}
        </div>

        {/* タイトル（div で h1 を避ける → admin-base の h1 強制スタイルを回避） */}
        <div style={{ borderBottom: "1.5px solid #111", paddingBottom: 2, marginBottom: 3 }}>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.3em", margin: "1px 0", textAlign: "center", color: "#111" }}>
            {isCopy ? "納 品 書 控" : "納 品 書"}
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
            <span style={{ fontSize: 8, color: "#666" }}>No. {order.delivery_number || order.id.slice(0, 8)}</span>
            {pageLabel && <span style={{ fontSize: 8, color: "#999" }}>{pageLabel}</span>}
          </div>
        </div>

        {/* 宛先 + 自社 */}
        <div style={{ display: "flex", gap: 10, marginBottom: 2 }}>
          <div style={{ flex: 1 }}>
            {corporateLabel && <div style={{ fontSize: 8, color: "#444", margin: 0 }}>{corporateLabel}</div>}
            <div style={{ fontSize: 11, fontWeight: 700, borderBottom: "1px solid #111", paddingBottom: 1, margin: 0 }}>
              {prefix}{clinic?.name || "(医院不明)"} 御中
            </div>
            {clinic?.adress && <div style={{ fontSize: 7.5, color: "#666", marginTop: 1 }}>{clinic.adress}</div>}
            {clinic?.phone && <div style={{ fontSize: 7.5, color: "#666" }}>TEL {clinic.phone}</div>}
            <div style={{ fontSize: 8, color: "#444", marginTop: 1 }}>納品日: {dateStr}</div>
          </div>
          <div style={{ flexShrink: 0, fontSize: 7.5, lineHeight: 1.3, position: "relative", paddingRight: 36, minWidth: 155 }}>
            <div style={{ fontSize: 9, fontWeight: 700 }}>{COMPANY.name}</div>
            <div>〒{COMPANY.postalCode}</div>
            <div>{COMPANY.address}</div>
            <div>TEL {COMPANY.phone}</div>
            {COMPANY.fax && <div>FAX {COMPANY.fax}</div>}
            <div style={{ position: "absolute", top: -2, right: 0 }}><Seal size={32} /></div>
          </div>
        </div>

        {/* ── 明細（div フレックス・admin-base.css 干渉なし） ── */}
        <div style={{ width: "100%", fontSize: 9 }}>

          {/* ヘッダー行 */}
          <div style={{ display: "flex", background: "#f3f4f6", borderBottom: "1.5px solid #ccc" }}>
            <div style={{ ...colHead({ flex: 1 }) }}>商品名</div>
            <div style={{ ...colHead({ width: COL_BC, textAlign: "center" }) }}>QR</div>
            <div style={{ ...colHead({ width: COL_QT, textAlign: "right" }) }}>数量</div>
            <div style={{ ...colHead({ width: COL_UP, textAlign: "right" }) }}>単価</div>
            <div style={{ ...colHead({ width: COL_AM, textAlign: "right" }) }}>金額</div>
          </div>

          {/* データ行 */}
          {items.map(i => (
            <div key={i.id} style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #eee", height: ROW_H }}>
              {/* 商品名 */}
              <div style={{ ...cell({ flex: 1, minWidth: 0, alignItems: "flex-start", flexDirection: "column", justifyContent: "center" }) }}>
                <div style={{ fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>{i.product_name || "—"}</div>
                {i.lot_number && <div style={{ fontSize: 7, color: "#555", whiteSpace: "nowrap", marginTop: 2 }}>LOT: {i.lot_number}</div>}
              </div>
              {/* QRコード（スマホ読取対応: ~17mm印刷時） */}
              <div style={{ width: COL_BC, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {i.barcode ? (
                  <QRCodeSVG
                    value={i.barcode}
                    size={QR_PX}
                    level="M"
                    marginSize={1}
                  />
                ) : null}
              </div>
              {/* 数量 */}
              <div style={{ ...cell({ width: COL_QT, justifyContent: "flex-end" }) }}>{i.quantity}</div>
              {/* 単価 */}
              <div style={{ ...cell({ width: COL_UP, justifyContent: "flex-end" }) }}>{fmtYen(i.price)}</div>
              {/* 金額 */}
              <div style={{ ...cell({ width: COL_AM, justifyContent: "flex-end", fontWeight: 700 }) }}>{fmtYen(Number(i.quantity) * Number(i.price))}</div>
            </div>
          ))}

          {/* 空白行 */}
          {Array.from({ length: emptyRows }).map((_, idx) => (
            <div key={`e-${idx}`} style={{ display: "flex", borderBottom: "1px solid #eee", height: ROW_H }}>
              <div style={{ flex: 1 }} />
              <div style={{ width: COL_BC }} />
              <div style={{ width: COL_QT }} />
              <div style={{ width: COL_UP }} />
              <div style={{ width: COL_AM }} />
            </div>
          ))}
        </div>

        {/* 合計 + 受領印 */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginTop: 2 }}>
          {isCopy && (
            <div style={{ display: "flex", gap: 5 }}>
              <div style={{ textAlign: "center", border: "1.5px solid #111", borderRadius: 3, padding: "1px 3px", minWidth: 52 }}>
                <div style={{ fontSize: 7, color: "#666" }}>受領印</div>
                <div style={{ width: 34, height: 26, margin: "1px auto", border: "1px dashed #aaa", borderRadius: 3 }} />
              </div>
              <div style={{ textAlign: "center", border: "1.5px solid #111", borderRadius: 3, padding: "1px 3px", minWidth: 80, alignSelf: "flex-end" }}>
                <div style={{ fontSize: 7, color: "#666" }}>受領日</div>
                <div style={{ height: 14, lineHeight: "14px", margin: "1px 3px 0", borderBottom: "1px solid #aaa", color: "#bbb", fontSize: 7.5 }}>　年　月　日</div>
              </div>
            </div>
          )}
          <div style={{ flex: 1 }} />
          {/* 小計 / 消費税 / 合計（div で実装） */}
          <div style={{ minWidth: "60mm", fontSize: 10, border: "1px solid #ddd" }}>
            {[
              { label: "小計",       val: fmtYen(subtotal), bg: "#f9fafb", bold: false },
              { label: "消費税(10%)", val: fmtYen(tax),      bg: "#f9fafb", bold: false },
              { label: "合計",        val: fmtYen(total),    bg: "#fef3c7", bold: true  },
            ].map(row => (
              <div key={row.label} style={{ display: "flex", background: row.bg, borderTop: "1px solid #ddd" }}>
                <div style={{ flex: 1, padding: "2px 6px", fontSize: 9.5, color: "#555", fontWeight: row.bold ? 700 : 400 }}>{row.label}</div>
                <div style={{ padding: "2px 6px", fontSize: row.bold ? 12 : 9.5, fontWeight: row.bold ? 700 : 400, textAlign: "right", minWidth: "24mm" }}>{row.val}</div>
              </div>
            ))}
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
      }}
    >
      <Half kind="original" />
      <Half kind="copy" />
    </div>
  )
}
