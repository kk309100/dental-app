"use client"

import { useEffect, useMemo, useState } from "react"
import { use } from "react"
import { supabase } from "@/lib/supabase"
import { COMPANY_FALLBACK as COMPANY_DEFAULT, getCompany, type Company } from "@/lib/company"
import { fmtYen, fmtDate, INVOICE_STATUSES, getClinicPrefix, getCorporateLabel, type InvoiceStatus } from "@/lib/invoice"
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
  payment_method?: string | null
}
type Order = { id: string; clinic_id: string; created_at: string; total_price: number; delivery_number: string | null; status: string; invoice_id: string | null }
type OrderItem = { id: string; order_id: string; product_id: string | null; product_name: string | null; quantity: number; price: number }
type Product = { id: string; name: string }
type Payment = { id: string; invoice_id: string; paid_at: string; amount: number; method: string | null; note: string | null }

export default function InvoiceDetailPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = use(params)
  const router = useRouter()

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [clinic, setClinic] = useState<Clinic | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [items, setItems] = useState<OrderItem[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [company, setCompany] = useState<Company>(COMPANY_DEFAULT)
  useEffect(() => { getCompany().then(setCompany) }, [])
  const [error, setError] = useState("")
  const [payments, setPayments] = useState<Payment[]>([])

  // 入金フォーム状態
  const [paidAmount, setPaidAmount] = useState("")
  const [paidDate, setPaidDate] = useState("")
  const [paidMethod, setPaidMethod] = useState("振込")
  const [paidNote, setPaidNote] = useState("")
  const [showPayForm, setShowPayForm] = useState(false)

  // 商品名入力モーダル
  const [nameModal, setNameModal] = useState<{ productId: string; current: { quantity: number; price: number } | null } | null>(null)
  const [nameInput, setNameInput] = useState("")
  const [allProducts, setAllProducts] = useState<{ id: string; name: string; price: number | null; product_code: string | null }[]>([])
  useEffect(() => {
    supabase.from("products").select("id,name,price,product_code").limit(50000).then(({ data }) => {
      if (data) setAllProducts(data)
    })
  }, [])

  // 展開中の注文
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null)

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

    try {
      const { data: pays } = await supabase.from("invoice_payments").select("*").eq("invoice_id", invoiceId).order("paid_at")
      setPayments((pays as Payment[]) || [])
    } catch { setPayments([]) }

    setLoading(false)
  }

  const totalPaid = useMemo(
    () => payments.reduce((s, p) => s + Number(p.amount || 0), 0) || (invoice?.paid_amount || 0),
    [payments, invoice]
  )
  const remaining = useMemo(() => (invoice ? Number(invoice.total) - totalPaid : 0), [invoice, totalPaid])

  const itemsByOrder = useMemo(() => {
    const productById = new Map(products.map((p) => [p.id, p.name]))
    const m = new Map<string, OrderItem[]>()
    items.forEach(it => {
      if (!m.has(it.order_id)) m.set(it.order_id, [])
      // 商品名補完
      if (!it.product_name && it.product_id && productById.has(it.product_id)) {
        it = { ...it, product_name: productById.get(it.product_id)! }
      }
      m.get(it.order_id)!.push(it)
    })
    return m
  }, [items, products])

  const missingNameCount = useMemo(() => items.filter((it) => !it.product_name).length, [items])

  function openNameModal(productId: string) {
    const current = items.find(it => it.product_id === productId)
    setNameModal({ productId, current: current ? { quantity: current.quantity, price: current.price } : null })
    setNameInput("")
  }

  async function saveProductName(productId: string, name: string) {
    if (!name.trim()) { alert("商品名を入力してください"); return }
    const { error } = await supabase.from("order_items")
      .update({ product_name: name.trim() })
      .eq("product_id", productId)
      .is("product_name", null)
    if (error) { alert("更新失敗: " + error.message); return }
    setNameModal(null)
    setNameInput("")
    fetchData()
  }

  function similarProducts(price: number) {
    if (!price) return []
    const tolerance = price * 0.05
    return allProducts.filter(p => p.price && Math.abs(p.price - price) <= tolerance).slice(0, 10)
  }

  const invoiceCompliance = useMemo(() => {
    const issues: string[] = []
    if (!company.invoiceNumber || !/^T\d{13}$/.test(company.invoiceNumber)) {
      issues.push("適格請求書番号が未設定")
    }
    if (!company.name) issues.push("自社名なし")
    if (!company.address) issues.push("自社住所なし")
    if (!clinic) issues.push("取引先情報なし")
    if (!invoice?.issue_date) issues.push("発行日なし")
    return { issues, ok: issues.length === 0 }
  }, [company, clinic, invoice])

  async function recordPayment() {
    if (!invoice) return
    const amt = Number(paidAmount.replace(/[^\d]/g, "")) || remaining
    if (amt <= 0) { alert("入金額を入力してください"); return }
    const dt = paidDate ? new Date(paidDate + "T12:00:00").toISOString() : new Date().toISOString()

    let usePayments = true
    const { error: peErr } = await supabase.from("invoice_payments").insert({
      invoice_id: invoice.id,
      paid_at: dt,
      amount: amt,
      method: paidMethod || "振込",
      note: paidNote || null,
    })
    if (peErr) {
      usePayments = false
      const sumAmt = (invoice.paid_amount || 0) + amt
      const newStatus = sumAmt >= invoice.total ? "paid" : invoice.status
      const { error: e } = await supabase.from("invoices")
        .update({ status: newStatus, paid_at: dt, paid_amount: sumAmt }).eq("id", invoice.id)
      if (e) { alert("入金記録失敗: " + e.message); return }
    } else {
      const newTotal = totalPaid + amt
      const newStatus = newTotal >= Number(invoice.total) ? "paid" : (newTotal > 0 ? "partial" : invoice.status)
      const updPayload: Record<string, unknown> = { status: newStatus, paid_at: dt, paid_amount: newTotal }
      const { error: e } = await supabase.from("invoices").update(updPayload).eq("id", invoice.id)
      if (e) {
        await supabase.from("invoices").update({ paid_at: dt, paid_amount: newTotal }).eq("id", invoice.id)
      }
    }

    setPaidAmount(""); setPaidDate(""); setPaidNote(""); setPaidMethod("振込")
    setShowPayForm(false)
    fetchData()
    if (!usePayments) {
      alert("⚠ invoice_payments テーブルが未作成のため簡易方式で記録しました。")
    }
  }

  async function deletePayment(id: string) {
    if (!confirm("この入金記録を削除しますか？")) return
    const { error } = await supabase.from("invoice_payments").delete().eq("id", id)
    if (error) { alert("削除失敗: " + error.message); return }
    fetchData()
  }

  async function cancelInvoice() {
    if (!invoice) return
    if (!confirm("請求書を取消しますか？関連する注文の請求紐付けも解除されます。")) return
    await supabase.from("orders").update({ invoice_id: null }).eq("invoice_id", invoice.id)
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

  if (loading) return <main style={page}><p>読み込み中…</p></main>
  if (error || !invoice) return (
    <main style={page}>
      <p style={{ color: "#dc2626" }}>{error || "見つかりません"}</p>
      <Link href="/admin/invoices">← 戻る</Link>
    </main>
  )

  const status = INVOICE_STATUSES[invoice.status]
  const clinicPrefix = clinic ? getClinicPrefix(clinic.name, clinic.corporate_name, clinic.clinic_type) : ""
  const corporateLabel = clinic ? getCorporateLabel(clinic.corporate_name, clinic.name, clinic.clinic_type) : ""
  const isPending = invoice.status === "issued" || invoice.status === "partial"

  return (
    <>
      {/* ── 操作バー ── */}
      <div style={toolbar} className="no-print">
        <Link href="/admin/invoices"><button style={btnGray}>← 一覧</button></Link>
        <span style={{
          padding: "4px 14px", borderRadius: 99,
          background: status.color + "22", color: status.color, fontSize: 12, fontWeight: 700,
        }}>
          {status.label}
        </span>
        <div style={{ flex: 1 }} />
        <Link href={`/admin/invoices/${invoiceId}/detailed-print`}>
          <button style={{ ...btnBlue }}>📄 請求明細書</button>
        </Link>
        {isPending && (
          <>
            <button
              onClick={() => { setPaidAmount(String(remaining)); setPaidDate(new Date().toISOString().slice(0, 10)); setShowPayForm(true) }}
              style={btnGreen}
            >
              ✓ 入金記録
            </button>
            <button onClick={cancelInvoice} style={btnRed}>取消</button>
          </>
        )}
        {invoice.status === "cancelled" && (
          <button onClick={reissueFromCancel} style={btnGray}>再発行</button>
        )}
      </div>

      {/* ── 2カラムレイアウト ── */}
      <div style={twoCol} className="no-print">

        {/* 左カラム：請求情報 + 関連注文 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* 請求書ヘッダーカード */}
          <div style={card}>
            {/* 請求書番号 */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <p style={labelSm}>請求書番号</p>
                <p style={{ margin: 0, fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: "#111" }}>
                  {invoice.invoice_number}
                </p>
              </div>
              {invoice.status === "paid" && (
                <span style={{ color: "#10b981", fontSize: 14, fontWeight: 800, border: "2px solid #10b981", padding: "4px 12px", borderRadius: 6, letterSpacing: "0.05em" }}>
                  ✓ 入金済
                </span>
              )}
              {invoice.status === "cancelled" && (
                <span style={{ color: "#9ca3af", fontSize: 14, fontWeight: 800, border: "2px solid #9ca3af", padding: "4px 12px", borderRadius: 6 }}>
                  ✕ 取消
                </span>
              )}
            </div>

            {/* 請求先 */}
            <div style={{ marginBottom: 10 }}>
              <p style={labelSm}>請求先</p>
              {clinic ? (
                <>
                  {corporateLabel && <p style={{ margin: 0, fontSize: 11, color: "#6b7280" }}>{corporateLabel}</p>}
                  <p style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 700 }}>{clinicPrefix}{clinic.name} 御中</p>
                  {clinic.adress && <p style={{ margin: "2px 0 0", fontSize: 11, color: "#6b7280" }}>{clinic.adress}</p>}
                  {clinic.phone && <p style={{ margin: 0, fontSize: 11, color: "#6b7280" }}>TEL {clinic.phone}</p>}
                </>
              ) : <p style={{ margin: 0, fontSize: 14, color: "#9ca3af" }}>(医院情報なし)</p>}
            </div>

            {/* 日付 */}
            <div style={{ display: "flex", gap: 20, marginBottom: 10, flexWrap: "wrap" }}>
              <div>
                <p style={labelSm}>発行日</p>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{fmtDate(invoice.issue_date)}</p>
              </div>
              {invoice.due_date && (
                <div>
                  <p style={labelSm}>支払期限</p>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{fmtDate(invoice.due_date)}</p>
                </div>
              )}
              {invoice.paid_at && (
                <div>
                  <p style={labelSm}>入金日</p>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#10b981" }}>{fmtDate(invoice.paid_at)}</p>
                </div>
              )}
            </div>

            {/* カード決済表記 */}
            {clinic?.payment_method === "カード" && (
              <div style={{ marginBottom: 10 }}>
                <span style={{ padding: "3px 12px", border: "2px solid #dc2626", color: "#dc2626", fontWeight: 700, fontSize: 12, borderRadius: 4 }}>
                  💳 カード決済
                </span>
              </div>
            )}

            {/* 請求金額 */}
            <div style={totalBox}>
              <span style={{ fontSize: 13, color: "#555" }}>ご請求金額（税込）</span>
              <span style={{ fontSize: 26, fontWeight: 800 }}>{fmtYen(invoice.total)}</span>
            </div>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9ca3af", textAlign: "right" }}>
              税抜 {fmtYen(invoice.subtotal)} + 消費税 {fmtYen(invoice.tax)}
            </p>

            {/* 警告・備考 */}
            {!invoiceCompliance.ok && (
              <div style={{ marginTop: 10, padding: "6px 10px", background: "#fee2e2", borderRadius: 4, fontSize: 11, color: "#b91c1c" }}>
                ⚠ 適格請求書要件不備: {invoiceCompliance.issues.join(" / ")}
                {(!company.invoiceNumber || !/^T\d{13}$/.test(company.invoiceNumber)) && (
                  <>　<Link href="/admin/settings" style={{ color: "#1d4ed8", textDecoration: "underline" }}>→ 自社情報設定</Link></>
                )}
              </div>
            )}
            {missingNameCount > 0 && (
              <div style={{ marginTop: 6, padding: "6px 10px", background: "#fef3c7", borderRadius: 4, fontSize: 11, color: "#92400e" }}>
                ⚠ 商品名が無い明細が {missingNameCount} 件あります。
                <Link href="/admin/orders" style={{ color: "#1d4ed8", textDecoration: "underline", marginLeft: 4 }}>元の注文から補完</Link>
              </div>
            )}
            {invoice.notes && (
              <div style={{ marginTop: 10, padding: "8px 10px", background: "#fafafa", border: "1px solid #f0f0f0", borderRadius: 4 }}>
                <p style={{ fontSize: 10, fontWeight: 700, margin: "0 0 2px", color: "#6b7280" }}>備考</p>
                <p style={{ fontSize: 11, margin: 0, whiteSpace: "pre-wrap" }}>{invoice.notes}</p>
              </div>
            )}
          </div>

          {/* 関連注文 */}
          <div style={card}>
            <p style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: "#111" }}>
              関連注文（{orders.length}件）
            </p>
            {orders.length === 0 ? (
              <p style={{ color: "#9ca3af", fontSize: 12 }}>関連する注文がありません</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {orders.map(o => {
                  const oi = itemsByOrder.get(o.id) || []
                  const expanded = expandedOrder === o.id
                  return (
                    <div key={o.id} style={{ border: "1px solid #e5e7eb", borderRadius: 6, overflow: "hidden" }}>
                      <button
                        onClick={() => setExpandedOrder(expanded ? null : o.id)}
                        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: expanded ? "#f0f9ff" : "#fafafa", border: "none", cursor: "pointer", textAlign: "left" }}
                      >
                        <span style={{ fontSize: 12, color: "#374151" }}>
                          {o.delivery_number || o.id.slice(0, 8)} — {fmtDate(o.created_at)}
                          <span style={{ marginLeft: 8, padding: "1px 6px", background: "#f3f4f6", borderRadius: 3, fontSize: 10, color: "#6b7280" }}>{o.status}</span>
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 700, marginLeft: 8 }}>{fmtYen(o.total_price)}</span>
                      </button>
                      {expanded && oi.length > 0 && (
                        <div style={{ padding: "6px 12px 10px", borderTop: "1px solid #e5e7eb" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                            <thead>
                              <tr style={{ color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>
                                <th style={{ padding: "3px 4px", textAlign: "left", fontWeight: 600 }}>商品名</th>
                                <th style={{ padding: "3px 4px", textAlign: "right", fontWeight: 600, width: 40 }}>数量</th>
                                <th style={{ padding: "3px 4px", textAlign: "right", fontWeight: 600, width: 70 }}>単価</th>
                                <th style={{ padding: "3px 4px", textAlign: "right", fontWeight: 600, width: 80 }}>小計</th>
                              </tr>
                            </thead>
                            <tbody>
                              {oi.map(it => (
                                <tr key={it.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                                  <td style={{ padding: "3px 4px", color: it.product_name ? "#111" : "#dc2626" }}>
                                    {it.product_name || (
                                      <button onClick={() => it.product_id && openNameModal(it.product_id)}
                                        style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 11, padding: 0, textDecoration: "underline" }}>
                                        (商品名なし) → 入力
                                      </button>
                                    )}
                                  </td>
                                  <td style={{ padding: "3px 4px", textAlign: "right" }}>{it.quantity}</td>
                                  <td style={{ padding: "3px 4px", textAlign: "right" }}>{fmtYen(it.price)}</td>
                                  <td style={{ padding: "3px 4px", textAlign: "right", fontWeight: 600 }}>{fmtYen(it.quantity * it.price)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* 右カラム：入金管理 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* 入金サマリ */}
          <div style={card}>
            <p style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: "#111" }}>入金状況</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={payRow}>
                <span style={{ fontSize: 13, color: "#6b7280" }}>請求額</span>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{fmtYen(invoice.total)}</span>
              </div>
              <div style={payRow}>
                <span style={{ fontSize: 13, color: "#6b7280" }}>入金済</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#10b981" }}>{fmtYen(totalPaid)}</span>
              </div>
              <div style={{ ...payRow, paddingTop: 8, borderTop: "1px solid #e5e7eb", marginTop: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: remaining > 0 ? "#dc2626" : "#10b981" }}>
                  {remaining > 0 ? "残額" : "完了"}
                </span>
                <span style={{ fontSize: 18, fontWeight: 800, color: remaining > 0 ? "#dc2626" : "#10b981" }}>
                  {remaining > 0 ? fmtYen(remaining) : "—"}
                </span>
              </div>
            </div>

            {/* 入金記録ボタン / フォーム */}
            {isPending && (
              <div style={{ marginTop: 12 }}>
                {!showPayForm ? (
                  <button
                    onClick={() => { setPaidAmount(String(remaining)); setPaidDate(new Date().toISOString().slice(0, 10)); setShowPayForm(true) }}
                    style={{ ...btnGreen, width: "100%", padding: "9px", fontSize: 13, borderRadius: 7 }}
                  >
                    ＋ 入金を記録する
                  </button>
                ) : (
                  <div style={{ padding: 12, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8 }}>
                    <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, color: "#166534" }}>入金記録</p>
                    <label style={fLabel}>入金日</label>
                    <input type="date" value={paidDate} onChange={e => setPaidDate(e.target.value)} style={fInput} />
                    <label style={fLabel}>入金金額（空欄 = 残額 {fmtYen(remaining)}）</label>
                    <input type="number" value={paidAmount} onChange={e => setPaidAmount(e.target.value)}
                      placeholder={String(remaining)} style={fInput} />
                    <label style={fLabel}>方法</label>
                    <select value={paidMethod} onChange={e => setPaidMethod(e.target.value)} style={fInput}>
                      {["振込", "現金", "相殺", "値引", "手数料相殺", "その他"].map(m => <option key={m}>{m}</option>)}
                    </select>
                    <label style={fLabel}>備考</label>
                    <input value={paidNote} onChange={e => setPaidNote(e.target.value)}
                      placeholder="例: 振込手数料330円差し引き" style={fInput} />
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                      <button onClick={recordPayment} style={{ ...btnGreen, flex: 1, padding: "8px", borderRadius: 6, fontSize: 13 }}>記録する</button>
                      <button onClick={() => setShowPayForm(false)} style={{ ...btnGray, padding: "8px 12px", borderRadius: 6, fontSize: 13 }}>キャンセル</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 入金履歴 */}
          <div style={card}>
            <p style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: "#111" }}>
              入金履歴（{payments.length}件）
            </p>
            {payments.length === 0 ? (
              <p style={{ color: "#9ca3af", fontSize: 12 }}>入金履歴がありません</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {payments.map(p => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ color: "#374151" }}>{new Date(p.paid_at).toLocaleDateString("ja-JP")}</span>
                        <span style={{ padding: "1px 6px", background: "#eef2ff", color: "#3730a3", borderRadius: 99, fontSize: 10 }}>
                          {p.method || "振込"}
                        </span>
                      </div>
                      {p.note && <span style={{ fontSize: 11, color: "#9ca3af" }}>{p.note}</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong style={{ fontSize: 13 }}>{fmtYen(p.amount)}</strong>
                      <button onClick={() => deletePayment(p.id)}
                        style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "2px 4px" }}>
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 請求明細書リンク */}
          <div style={{ ...card, background: "#eff6ff", border: "1px solid #bfdbfe" }}>
            <p style={{ margin: "0 0 6px", fontSize: 12, color: "#1e40af", fontWeight: 600 }}>
              明細 {items.length}品 / 注文 {orders.length}件
            </p>
            <Link href={`/admin/invoices/${invoiceId}/detailed-print`}>
              <button style={{ ...btnBlue, width: "100%", padding: "9px", fontSize: 13, borderRadius: 7 }}>
                📄 請求明細書を開く（印刷）
              </button>
            </Link>
          </div>
        </div>
      </div>

      {/* 商品名入力モーダル */}
      {nameModal && (
        <div style={overlay} onClick={() => setNameModal(null)} className="no-print">
          <div style={{ ...modal, maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 12px", fontSize: 18 }}>商品名を入力</h2>
            <div style={{ background: "#f8fafc", padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
              <p style={{ margin: 0 }}>商品ID: <code style={{ fontSize: 10, color: "#666" }}>{nameModal.productId.slice(0, 8)}...</code></p>
              {nameModal.current && (
                <p style={{ margin: "4px 0 0" }}>数量 <strong>{nameModal.current.quantity}</strong> × 単価 <strong>{fmtYen(nameModal.current.price)}</strong></p>
              )}
            </div>
            {nameModal.current && nameModal.current.price > 0 && similarProducts(nameModal.current.price).length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 11, color: "#777", margin: "0 0 6px" }}>単価が近い商品候補（クリックで選択）:</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
                  {similarProducts(nameModal.current.price).map(p => (
                    <button key={p.id} onClick={() => setNameInput(p.name)}
                      style={{ padding: "6px 10px", fontSize: 12, textAlign: "left", background: "#fff", border: "1px solid #ddd", borderRadius: 4, cursor: "pointer" }}>
                      <strong>{p.name}</strong>
                      <span style={{ marginLeft: 8, color: "#777", fontSize: 10 }}>{p.product_code} ¥{p.price?.toLocaleString()}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label style={{ fontSize: 11, color: "#777" }}>商品名</label>
            <input
              autoFocus
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && nameInput.trim()) saveProductName(nameModal.productId, nameInput)
                if (e.key === "Escape") setNameModal(null)
              }}
              placeholder="例: アルコール綿球 100入"
              style={{ ...fInput, fontSize: 14, padding: "10px 12px" }}
            />
            <p style={{ fontSize: 10, color: "#999", margin: "0 0 12px" }}>
              ※ 同じ商品ID の全明細に一括反映されます
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => saveProductName(nameModal.productId, nameInput)}
                disabled={!nameInput.trim()} style={btnGreen}>保存</button>
              <button onClick={() => setNameModal(null)} style={btnGray}>キャンセル</button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          nav { display: none !important; }
        }
        @page { size: A4 portrait; margin: 0; }
      `}</style>
    </>
  )
}

const page: React.CSSProperties = { maxWidth: 1100, margin: "0 auto", padding: 20 }
const toolbar: React.CSSProperties = {
  position: "sticky", top: 0, zIndex: 10,
  background: "#fff", borderBottom: "1px solid #e5e7eb",
  padding: "10px 16px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
}
const twoCol: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "3fr 2fr",
  gap: 16,
  marginTop: 16,
  alignItems: "start",
}
const card: React.CSSProperties = {
  background: "#fff", border: "1px solid #e5e7eb",
  borderRadius: 10, padding: 20,
}
const totalBox: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "12px 16px", background: "#f9fafb", border: "2px solid #111", borderRadius: 6,
  marginTop: 12,
}
const payRow: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
}
const labelSm: React.CSSProperties = { margin: "0 0 2px", fontSize: 11, color: "#6b7280" }
const btnGray: React.CSSProperties = { padding: "6px 14px", borderRadius: 6, border: "1px solid #ddd", background: "#f7f7f7", fontSize: 12, cursor: "pointer", color: "#333" }
const btnDark: React.CSSProperties = { padding: "6px 14px", borderRadius: 6, border: "none", background: "#111", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }
const btnBlue: React.CSSProperties = { padding: "6px 14px", borderRadius: 6, border: "none", background: "#1d4ed8", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }
const btnGreen: React.CSSProperties = { padding: "6px 14px", borderRadius: 6, border: "1px solid #86efac", background: "#f0fdf4", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#15803d" }
const btnRed: React.CSSProperties = { padding: "6px 14px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff5f5", fontSize: 12, cursor: "pointer", color: "#dc2626" }
const fLabel: React.CSSProperties = { fontSize: 11, color: "#6b7280", display: "block", marginBottom: 2 }
const fInput: React.CSSProperties = { width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13, marginBottom: 8, boxSizing: "border-box", background: "#fff" }
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 80, zIndex: 50 }
const modal: React.CSSProperties = { background: "#fff", borderRadius: 10, padding: 20, width: "100%", maxWidth: 360 }
