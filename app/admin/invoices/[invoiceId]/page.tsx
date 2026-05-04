"use client"

import { useEffect, useMemo, useState } from "react"
import { use } from "react"
import { supabase } from "@/lib/supabase"
import { COMPANY } from "@/lib/company"
import { fmtYen, fmtDate, INVOICE_STATUSES, getClinicPrefix, type InvoiceStatus } from "@/lib/invoice"
import Seal from "@/app/components/Seal"
import Link from "next/link"
import { useRouter } from "next/navigation"

type Invoice = {
  id: string
  clinic_id: string | null
  invoice_number: string
  issue_date: string
  due_date: string | null
  subtotal: number
  tax: number
  total: number
  status: InvoiceStatus
  paid_at: string | null
  paid_amount: number | null
  notes: string | null
  created_at: string
}
type Clinic = {
  id: string; name: string; corporate_name: string | null
  contact: string | null; sales_rep: string | null; clinic_type: string | null
  adress: string | null; phone: string | null
}
type Order = { id: string; clinic_id: string; created_at: string; total_price: number; delivery_number: string | null; status: string; invoice_id: string | null }
type OrderItem = { id: string; order_id: string; product_id: string | null; product_name: string | null; quantity: number; price: number }
type Product = { id: string; name: string }

export default function InvoiceDetailPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = use(params)
  const router = useRouter()

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [clinic, setClinic] = useState<Clinic | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [items, setItems] = useState<OrderItem[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [showPaidModal, setShowPaidModal] = useState(false)
  const [paidAmount, setPaidAmount] = useState("")
  const [paidDate, setPaidDate] = useState("")

  useEffect(() => { fetchData() }, [invoiceId])

  async function fetchData() {
    setLoading(true)
    setError("")
    const { data: inv, error: e1 } = await supabase.from("invoices").select("*").eq("id", invoiceId).single()
    if (e1 || !inv) { setError("請求書が見つかりません"); setLoading(false); return }
    setInvoice(inv as Invoice)

    if (inv.clinic_id) {
      const { data: cl } = await supabase.from("clinics").select("*").eq("id", inv.clinic_id).single()
      setClinic(cl)
    }

    const { data: ords } = await supabase.from("orders").select("*").eq("invoice_id", invoiceId).order("created_at")
    setOrders((ords as Order[]) || [])

    if (ords && ords.length > 0) {
      const orderIds = ords.map((o) => o.id)
      const { data: itms } = await supabase.from("order_items").select("*").in("order_id", orderIds)
      const orderItems = (itms as OrderItem[]) || []
      setItems(orderItems)
      // 商品マスタから不足する product_name を補完するため product_id を集めて取得
      const productIds = Array.from(new Set(orderItems.map((i) => i.product_id).filter(Boolean) as string[]))
      if (productIds.length > 0) {
        const { data: prods } = await supabase.from("products").select("id,name").in("id", productIds)
        setProducts((prods as Product[]) || [])
      } else {
        setProducts([])
      }
    } else {
      setItems([])
      setProducts([])
    }

    setLoading(false)
  }

  // 明細を「商品名で集約」したサマリ表示
  // product_name が null の場合は products テーブルから補完
  const itemSummary = useMemo(() => {
    const productById = new Map(products.map((p) => [p.id, p.name]))
    const map = new Map<string, { name: string; qty: number; amount: number }>()
    items.forEach((it) => {
      const name = it.product_name || (it.product_id ? productById.get(it.product_id) : null) || "(商品名不明)"
      const e = map.get(name) || { name, qty: 0, amount: 0 }
      e.qty += it.quantity || 0
      e.amount += (it.price || 0) * (it.quantity || 0)
      map.set(name, e)
    })
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount)
  }, [items, products])

  async function markAsPaid() {
    if (!invoice) return
    const amt = Number(paidAmount.replace(/[^\d]/g, "")) || invoice.total
    const dt = paidDate || new Date().toISOString()
    const { error: e } = await supabase
      .from("invoices")
      .update({ status: "paid", paid_at: dt, paid_amount: amt })
      .eq("id", invoice.id)
    if (e) { alert("入金記録に失敗: " + e.message); return }
    setShowPaidModal(false)
    fetchData()
  }

  async function cancelInvoice() {
    if (!invoice) return
    if (!confirm("請求書を取消しますか？関連する注文の請求紐付けも解除されます。")) return
    // 1) orders.invoice_id をクリア
    await supabase.from("orders").update({ invoice_id: null }).eq("invoice_id", invoice.id)
    // 2) invoice status を cancelled に
    const { error: e } = await supabase.from("invoices").update({ status: "cancelled" }).eq("id", invoice.id)
    if (e) { alert("取消失敗: " + e.message); return }
    fetchData()
  }

  async function reissueFromCancel() {
    if (!invoice) return
    if (!confirm("取消した請求書を再発行（issuedに戻す）しますか？")) return
    const { error: e } = await supabase.from("invoices").update({ status: "issued", paid_at: null, paid_amount: null }).eq("id", invoice.id)
    if (e) { alert("失敗: " + e.message); return }
    fetchData()
  }

  function doPrint() {
    window.print()
  }

  if (loading) return <main style={page}><p>読み込み中…</p></main>
  if (error || !invoice) return <main style={page}><p style={{ color: "#dc2626" }}>{error || "見つかりません"}</p><Link href="/admin/invoices">← 戻る</Link></main>

  const status = INVOICE_STATUSES[invoice.status]
  const clinicPrefix = clinic ? getClinicPrefix(clinic.name, clinic.corporate_name, clinic.clinic_type) : ""

  return (
    <>
      {/* ── 操作バー（印刷時に非表示） ── */}
      <div style={toolbar} className="no-print">
        <Link href="/admin/invoices"><button style={btnGray}>← 一覧</button></Link>
        <div style={{ flex: 1 }} />
        <span style={{ marginRight: 8, padding: "4px 12px", borderRadius: 99, background: status.color + "22", color: status.color, fontSize: 12, fontWeight: 700 }}>
          {status.label}
        </span>
        <button onClick={doPrint} style={btnDark}>🖨 印刷</button>
        {invoice.status === "issued" && (
          <>
            <button onClick={() => { setPaidAmount(String(invoice.total)); setPaidDate(new Date().toISOString().slice(0, 10)); setShowPaidModal(true) }} style={btnGreen}>✓ 入金確認</button>
            <button onClick={cancelInvoice} style={btnRed}>取消</button>
          </>
        )}
        {invoice.status === "cancelled" && (
          <button onClick={reissueFromCancel} style={btnGray}>再発行</button>
        )}
      </div>

      {/* ── 印刷レイアウト ── */}
      <main style={printArea} className="print-area">
        {/* ヘッダー */}
        <header style={header}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 28, letterSpacing: "0.3em", margin: "20px 0 4px", textAlign: "center" }}>請  求  書</h1>
            <p style={{ textAlign: "center", margin: 0, fontSize: 11, color: "#666" }}>No. {invoice.invoice_number}</p>
          </div>
        </header>

        {/* 宛先 + 自社 */}
        <div style={{ display: "flex", gap: 20, marginTop: 24 }}>
          {/* 左: 宛先 */}
          <div style={{ flex: 1 }}>
            {clinic ? (
              <>
                {clinic.corporate_name && <p style={{ margin: "0 0 4px", fontSize: 13, color: "#444" }}>{clinic.corporate_name}</p>}
                <p style={{ margin: 0, fontSize: 22, fontWeight: 700, borderBottom: "1px solid #111", paddingBottom: 6 }}>
                  {clinicPrefix}{clinic.name}　御中
                </p>
                {clinic.adress && <p style={{ margin: "6px 0 0", fontSize: 11, color: "#666" }}>{clinic.adress}</p>}
              </>
            ) : (
              <p style={{ fontSize: 14, color: "#999" }}>(医院情報なし)</p>
            )}
          </div>

          {/* 右: 自社 */}
          <div style={{ flexShrink: 0, fontSize: 11, lineHeight: 1.6, textAlign: "left", position: "relative", paddingRight: 70 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{COMPANY.name}</p>
            <p style={{ margin: 0 }}>〒{COMPANY.postalCode}</p>
            <p style={{ margin: 0 }}>{COMPANY.address}</p>
            <p style={{ margin: 0 }}>TEL {COMPANY.phone} / FAX {COMPANY.fax}</p>
            <p style={{ margin: "4px 0 0" }}>登録番号: {COMPANY.invoiceNumber}</p>
            {/* 印影 */}
            <div style={{ position: "absolute", top: 0, right: 0 }}>
              <Seal size={64} />
            </div>
          </div>
        </div>

        {/* メタ情報 */}
        <div style={{ marginTop: 20, display: "flex", gap: 20, fontSize: 12 }}>
          <div><strong>発行日:</strong> {fmtDate(invoice.issue_date)}</div>
          {invoice.due_date && <div><strong>お支払期限:</strong> {fmtDate(invoice.due_date)}</div>}
        </div>

        {/* 合計強調ボックス */}
        <div style={totalBox}>
          <span style={{ fontSize: 13 }}>ご請求金額（税込）</span>
          <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: "0.05em" }}>{fmtYen(invoice.total)}</span>
        </div>

        {/* 明細表 */}
        <p style={{ fontSize: 11, color: "#666", margin: "16px 0 6px" }}>
          下記のとおりご請求申し上げます。
        </p>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>品目</th>
              <th style={{ ...th, width: 80, textAlign: "right" }}>数量</th>
              <th style={{ ...th, width: 120, textAlign: "right" }}>金額（税抜）</th>
            </tr>
          </thead>
          <tbody>
            {itemSummary.length === 0 ? (
              <tr><td colSpan={3} style={{ ...td, textAlign: "center", color: "#999" }}>明細なし</td></tr>
            ) : itemSummary.map((it, i) => (
              <tr key={i}>
                <td style={td}>{it.name}</td>
                <td style={{ ...td, textAlign: "right" }}>{it.qty}</td>
                <td style={{ ...td, textAlign: "right" }}>{fmtYen(it.amount)}</td>
              </tr>
            ))}
            {/* 空行で埋める（10行確保） */}
            {Array.from({ length: Math.max(0, 10 - itemSummary.length) }).map((_, i) => (
              <tr key={"empty" + i}>
                <td style={td}>&nbsp;</td>
                <td style={td}></td>
                <td style={td}></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ ...td, textAlign: "right", fontWeight: 600 }}>小計</td>
              <td style={{ ...td, textAlign: "right" }}>{fmtYen(invoice.subtotal)}</td>
            </tr>
            <tr>
              <td colSpan={2} style={{ ...td, textAlign: "right", fontWeight: 600 }}>消費税（10%）</td>
              <td style={{ ...td, textAlign: "right" }}>{fmtYen(invoice.tax)}</td>
            </tr>
            <tr>
              <td colSpan={2} style={{ ...tdTotal, textAlign: "right" }}>合計</td>
              <td style={{ ...tdTotal, textAlign: "right" }}>{fmtYen(invoice.total)}</td>
            </tr>
          </tfoot>
        </table>

        {/* 振込先 */}
        <div style={bankBox}>
          <p style={{ fontSize: 11, fontWeight: 700, margin: "0 0 4px" }}>お振込先</p>
          <p style={{ fontSize: 12, margin: 0 }}>
            {COMPANY.bankName}　{COMPANY.bankBranch}　{COMPANY.bankType}　{COMPANY.bankAccount}
          </p>
          <p style={{ fontSize: 12, margin: "2px 0 0" }}>名義: {COMPANY.bankHolder}</p>
          <p style={{ fontSize: 10, color: "#666", margin: "4px 0 0" }}>{COMPANY.notes}</p>
        </div>

        {/* 備考 */}
        {invoice.notes && (
          <div style={{ marginTop: 12, padding: 10, background: "#fafafa", border: "1px solid #eee", borderRadius: 4 }}>
            <p style={{ fontSize: 10, fontWeight: 700, margin: "0 0 4px", color: "#666" }}>備考</p>
            <p style={{ fontSize: 11, margin: 0, whiteSpace: "pre-wrap" }}>{invoice.notes}</p>
          </div>
        )}

        {/* 入金済みスタンプ */}
        {invoice.status === "paid" && (
          <div style={paidStamp}>
            <p style={{ margin: 0, transform: "rotate(-15deg)", color: "#10b981", fontSize: 36, fontWeight: 800, border: "4px solid #10b981", padding: "8px 24px", borderRadius: 8, letterSpacing: "0.1em" }}>
              入金済
            </p>
            {invoice.paid_at && <p style={{ margin: "8px 0 0", fontSize: 11, color: "#10b981" }}>入金日: {fmtDate(invoice.paid_at)}</p>}
          </div>
        )}

        {/* 取消スタンプ */}
        {invoice.status === "cancelled" && (
          <div style={paidStamp}>
            <p style={{ margin: 0, transform: "rotate(-15deg)", color: "#9ca3af", fontSize: 36, fontWeight: 800, border: "4px solid #9ca3af", padding: "8px 24px", borderRadius: 8, letterSpacing: "0.1em" }}>
              取  消
            </p>
          </div>
        )}
      </main>

      {/* ── 関連注文（画面のみ） ── */}
      <div style={{ ...page, paddingTop: 0 }} className="no-print">
        <h2 style={{ fontSize: 16, marginTop: 24 }}>関連注文（{orders.length}件）</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {orders.map((o) => (
            <div key={o.id} style={{ background: "#fff", border: "1px solid #eee", borderRadius: 6, padding: 10, fontSize: 12, display: "flex", justifyContent: "space-between" }}>
              <span>{o.delivery_number || o.id.slice(0, 8)} — {fmtDate(o.created_at)} ({o.status})</span>
              <span style={{ fontWeight: 700 }}>{fmtYen(o.total_price)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 入金確認モーダル */}
      {showPaidModal && (
        <div style={overlay} onClick={() => setShowPaidModal(false)} className="no-print">
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 12px", fontSize: 18 }}>入金確認</h2>
            <label style={{ fontSize: 11, color: "#777" }}>入金日</label>
            <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} style={modalInput} />
            <label style={{ fontSize: 11, color: "#777" }}>入金金額</label>
            <input type="number" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} style={modalInput} />
            <p style={{ fontSize: 11, color: "#999", margin: "0 0 12px" }}>請求額: {fmtYen(invoice.total)}</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={markAsPaid} style={btnGreen}>記録する</button>
              <button onClick={() => setShowPaidModal(false)} style={btnGray}>キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {/* 印刷用CSS */}
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          nav { display: none !important; }
          .print-area { padding: 12mm !important; max-width: none !important; }
        }
        @page { size: A4 portrait; margin: 0; }
      `}</style>
    </>
  )
}

const toolbar: React.CSSProperties = { position: "sticky", top: 0, zIndex: 10, background: "#fff", borderBottom: "1px solid #eee", padding: "10px 16px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }
const printArea: React.CSSProperties = { maxWidth: 760, margin: "0 auto", padding: 20, fontSize: 12, color: "#222", background: "#fff", position: "relative" }
const page: React.CSSProperties = { maxWidth: 760, margin: "0 auto", padding: 20 }
const btnDark: React.CSSProperties = { padding: "6px 14px", borderRadius: 6, border: "none", background: "#111", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }
const btnGray: React.CSSProperties = { padding: "6px 14px", borderRadius: 6, border: "1px solid #ddd", background: "#f7f7f7", fontSize: 12, cursor: "pointer", color: "#333" }
const btnGreen: React.CSSProperties = { padding: "6px 14px", borderRadius: 6, border: "1px solid #86efac", background: "#f0fdf4", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#15803d" }
const btnRed: React.CSSProperties = { padding: "6px 14px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff5f5", fontSize: 12, cursor: "pointer", color: "#dc2626" }
const header: React.CSSProperties = { borderBottom: "2px solid #111", paddingBottom: 8 }
const totalBox: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, padding: "12px 20px", background: "#fafafa", border: "2px solid #111", borderRadius: 4 }
const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", marginTop: 4 }
const th: React.CSSProperties = { borderBottom: "2px solid #111", padding: "6px 8px", textAlign: "left", fontSize: 11, fontWeight: 700, background: "#fafafa" }
const td: React.CSSProperties = { borderBottom: "1px solid #eee", padding: "5px 8px", fontSize: 11 }
const tdTotal: React.CSSProperties = { borderTop: "2px solid #111", padding: "8px", fontSize: 13, fontWeight: 700 }
const bankBox: React.CSSProperties = { marginTop: 14, padding: 10, border: "1px solid #ddd", borderRadius: 4, background: "#fafafa" }
const paidStamp: React.CSSProperties = { position: "absolute", top: "30%", right: "10%", textAlign: "center", pointerEvents: "none" }
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 80, zIndex: 50 }
const modal: React.CSSProperties = { background: "#fff", borderRadius: 10, padding: 20, width: "100%", maxWidth: 360 }
const modalInput: React.CSSProperties = { width: "100%", padding: 8, borderRadius: 6, border: "1px solid #ddd", fontSize: 13, marginBottom: 8, boxSizing: "border-box" }
