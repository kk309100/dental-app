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

  const [showPaidModal, setShowPaidModal] = useState(false)
  const [paidAmount, setPaidAmount] = useState("")
  const [paidDate, setPaidDate] = useState("")
  const [paidMethod, setPaidMethod] = useState("振込")
  const [paidNote, setPaidNote] = useState("")
  const [payments, setPayments] = useState<Payment[]>([])

  // 商品名入力モーダル
  const [nameModal, setNameModal] = useState<{ productId: string; current: { quantity: number; price: number } | null } | null>(null)
  const [nameInput, setNameInput] = useState("")
  const [allProducts, setAllProducts] = useState<{ id: string; name: string; price: number | null; product_code: string | null }[]>([])
  useEffect(() => {
    supabase.from("products").select("id,name,price,product_code").then(({ data }) => {
      if (data) setAllProducts(data)
    })
  }, [])

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

    // 入金履歴（テーブル無い場合は空のまま）
    try {
      const { data: pays } = await supabase.from("invoice_payments").select("*").eq("invoice_id", invoiceId).order("paid_at")
      setPayments((pays as Payment[]) || [])
    } catch { setPayments([]) }

    setLoading(false)
  }

  // 累計入金 / 残額
  const totalPaid = useMemo(
    () => payments.reduce((s, p) => s + Number(p.amount || 0), 0) || (invoice?.paid_amount || 0),
    [payments, invoice]
  )
  const remaining = useMemo(() => (invoice ? Number(invoice.total) - totalPaid : 0), [invoice, totalPaid])

  // 明細を「商品名で集約」したサマリ表示
  // 商品名が無い明細は product_id ごとにグループ化（編集対象として識別可能に）
  const itemSummary = useMemo(() => {
    const productById = new Map(products.map((p) => [p.id, p.name]))
    const map = new Map<string, { name: string; qty: number; amount: number; missingProductId: string | null }>()
    items.forEach((it) => {
      let key: string
      let missingProductId: string | null = null
      if (it.product_name) {
        key = it.product_name
      } else if (it.product_id && productById.has(it.product_id)) {
        key = productById.get(it.product_id)!
      } else if (it.product_id) {
        key = `__missing__${it.product_id}`
        missingProductId = it.product_id
      } else {
        key = "(商品名なし)"
      }
      const e = map.get(key) || { name: key.startsWith("__missing__") ? "(商品名なし)" : key, qty: 0, amount: 0, missingProductId }
      e.qty += it.quantity || 0
      e.amount += (it.price || 0) * (it.quantity || 0)
      map.set(key, e)
    })
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount)
  }, [items, products])

  // 商品名が null の明細件数（警告表示用）
  const missingNameCount = useMemo(() => items.filter((it) => !it.product_name).length, [items])

  // 商品名入力モーダルを開く
  function openNameModal(productId: string) {
    const current = items.find(it => it.product_id === productId)
    setNameModal({ productId, current: current ? { quantity: current.quantity, price: current.price } : null })
    setNameInput("")
  }

  // 商品名を一括設定（product_id がマッチする全 order_items を更新）
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

  // 単価から類似商品候補（±5%以内）
  function similarProducts(price: number) {
    if (!price) return []
    const tolerance = price * 0.05
    return allProducts.filter(p => p.price && Math.abs(p.price - price) <= tolerance).slice(0, 10)
  }

  // 適格請求書（インボイス）要件チェック
  const invoiceCompliance = useMemo(() => {
    const issues: string[] = []
    if (!company.invoiceNumber || !/^T\d{13}$/.test(company.invoiceNumber)) {
      issues.push("自社の適格請求書発行事業者登録番号が未設定または形式不正（T+13桁）")
    }
    if (!company.name) issues.push("自社名なし")
    if (!company.address) issues.push("自社住所なし")
    if (!clinic) issues.push("取引先（医院）情報なし")
    if (!invoice?.issue_date) issues.push("発行日なし")
    if (invoice && invoice.tax === undefined) issues.push("税額の表示なし")
    return { issues, ok: issues.length === 0 }
  }, [company, clinic, invoice])

  async function recordPayment() {
    if (!invoice) return
    const amt = Number(paidAmount.replace(/[^\d]/g, "")) || remaining
    if (amt <= 0) { alert("入金額を入力してください"); return }
    const dt = paidDate ? new Date(paidDate + "T12:00:00").toISOString() : new Date().toISOString()

    // 1) invoice_payments に追加（テーブル無い場合は invoices.paid_amount を使う旧方式へフォールバック）
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
      // 旧方式: invoices.paid_amount/paid_at/status だけ更新
      const total = invoice.total
      const sumAmt = (invoice.paid_amount || 0) + amt
      const newStatus = sumAmt >= total ? "paid" : invoice.status
      const { error: e } = await supabase.from("invoices")
        .update({ status: newStatus, paid_at: dt, paid_amount: sumAmt }).eq("id", invoice.id)
      if (e) { alert("入金記録失敗: " + e.message); return }
    } else {
      // 累計入金で status を判定
      const newTotal = totalPaid + amt
      const newStatus = newTotal >= Number(invoice.total) ? "paid" : (newTotal > 0 ? "partial" : invoice.status)
      const updPayload: Record<string, unknown> = { status: newStatus, paid_at: dt, paid_amount: newTotal }
      const { error: e } = await supabase.from("invoices").update(updPayload).eq("id", invoice.id)
      if (e) { /* status 列が partial を許さない場合があるので状態だけ落として再試行 */
        await supabase.from("invoices").update({ paid_at: dt, paid_amount: newTotal }).eq("id", invoice.id)
      }
    }

    setShowPaidModal(false)
    setPaidAmount(""); setPaidDate(""); setPaidNote(""); setPaidMethod("振込")
    fetchData()
    if (!usePayments) {
      alert("⚠ invoice_payments テーブルが未作成のため、簡易方式（入金合計のみ）で記録しました。\nマイグレーションSQL適用後は明細管理ができるようになります。")
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
  const corporateLabel = clinic ? getCorporateLabel(clinic.corporate_name, clinic.name, clinic.clinic_type) : ""

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
                {corporateLabel && <p style={{ margin: "0 0 4px", fontSize: 13, color: "#444" }}>{corporateLabel}</p>}
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
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{company.name}</p>
            <p style={{ margin: 0 }}>〒{company.postalCode}</p>
            <p style={{ margin: 0 }}>{company.address}</p>
            <p style={{ margin: 0 }}>TEL {company.phone} / FAX {company.fax}</p>
            <p style={{ margin: "4px 0 0" }}>登録番号: {company.invoiceNumber}</p>
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

        {/* カード決済表記（金額の前、左寄せ） */}
        {clinic?.payment_method === "カード" && (
          <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-start" }}>
            <div style={{
              padding: "6px 16px",
              border: "2px solid #dc2626",
              color: "#dc2626",
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: "0.15em",
              background: "rgba(255,255,255,0.9)",
              borderRadius: 4,
            }}>
              💳 カード決済
            </div>
          </div>
        )}

        {/* 合計強調ボックス */}
        <div style={totalBox}>
          <span style={{ fontSize: 13 }}>ご請求金額（税込）</span>
          <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: "0.05em" }}>{fmtYen(invoice.total)}</span>
        </div>

        {/* 明細表 */}
        <p style={{ fontSize: 11, color: "#666", margin: "16px 0 6px" }}>
          下記のとおりご請求申し上げます。
        </p>
        {!invoiceCompliance.ok && (
          <p className="no-print" style={{ fontSize: 11, color: "#b91c1c", background: "#fee2e2", padding: "6px 10px", borderRadius: 4, margin: "0 0 8px" }}>
            ⚠ 適格請求書要件を満たしていません: {invoiceCompliance.issues.join(" / ")}
            {(!company.invoiceNumber || !/^T\d{13}$/.test(company.invoiceNumber)) && (
              <>　<Link href="/admin/settings" className="underline">→ 自社情報設定</Link></>
            )}
          </p>
        )}
        {missingNameCount > 0 && (
          <p className="no-print" style={{ fontSize: 11, color: "#92400e", background: "#fef3c7", padding: "6px 10px", borderRadius: 4, margin: "0 0 8px" }}>
            ⚠ 商品名が無い明細が {missingNameCount} 件あります（旧 dental-order データの欠損）。
            請求書発行後の修正は基本不可ですが、明細の <Link href="/admin/orders" style={{ color: "#1d4ed8", textDecoration: "underline" }}>元の注文</Link> から商品名を補完すれば反映されます。
          </p>
        )}
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
            {company.bankName}　{company.bankBranch}　{company.bankType}　{company.bankAccount}
          </p>
          <p style={{ fontSize: 12, margin: "2px 0 0" }}>名義: {company.bankHolder}</p>
          <p style={{ fontSize: 10, color: "#666", margin: "4px 0 0" }}>{company.notes}</p>
        </div>

        {/* 備考 */}
        {invoice.notes && (
          <div style={{ marginTop: 12, padding: 10, background: "#fafafa", border: "1px solid #eee", borderRadius: 4 }}>
            <p style={{ fontSize: 10, fontWeight: 700, margin: "0 0 4px", color: "#666" }}>備考</p>
            <p style={{ fontSize: 11, margin: 0, whiteSpace: "pre-wrap" }}>{invoice.notes}</p>
          </div>
        )}

        {/* 入金済みスタンプ（左下、金額にかぶらない） */}
        {invoice.status === "paid" && (
          <div style={paidStamp}>
            <p style={{ margin: 0, transform: "rotate(-12deg)", color: "#10b981", fontSize: 22, fontWeight: 800, border: "3px solid #10b981", padding: "4px 14px", borderRadius: 6, letterSpacing: "0.1em", display: "inline-block", opacity: 0.85 }}>
              入金済
            </p>
            {invoice.paid_at && <p style={{ margin: "4px 0 0", fontSize: 10, color: "#10b981" }}>入金日: {fmtDate(invoice.paid_at)}</p>}
          </div>
        )}

        {/* 取消スタンプ */}
        {invoice.status === "cancelled" && (
          <div style={paidStamp}>
            <p style={{ margin: 0, transform: "rotate(-12deg)", color: "#9ca3af", fontSize: 22, fontWeight: 800, border: "3px solid #9ca3af", padding: "4px 14px", borderRadius: 6, letterSpacing: "0.1em", display: "inline-block", opacity: 0.85 }}>
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

      {/* 入金確認モーダル（部分入金対応） */}
      {/* 商品名入力モーダル */}
      {nameModal && (
        <div style={overlay} onClick={() => setNameModal(null)} className="no-print">
          <div style={{ ...modal, maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 12px", fontSize: 18 }}>商品名を入力</h2>
            <div style={{ background: "#f8fafc", padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
              <p style={{ margin: 0 }}>商品ID: <code style={{ fontSize: 10, color: "#666" }}>{nameModal.productId.slice(0, 8)}...</code></p>
              {nameModal.current && (
                <p style={{ margin: "4px 0 0" }}>明細例: 数量 <strong>{nameModal.current.quantity}</strong> × 単価 <strong>¥{nameModal.current.price.toLocaleString()}</strong></p>
              )}
            </div>

            {nameModal.current && nameModal.current.price > 0 && similarProducts(nameModal.current.price).length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 11, color: "#777", margin: "0 0 6px" }}>商品マスタの単価が近い候補（クリックで選択）:</p>
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
              style={{ ...modalInput, fontSize: 14, padding: "10px 12px" }}
            />
            <p style={{ fontSize: 10, color: "#999", margin: "0 0 12px" }}>
              ※ 同じ商品ID（{nameModal.productId.slice(0, 8)}...）の全明細に一括反映されます
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => saveProductName(nameModal.productId, nameInput)}
                disabled={!nameInput.trim()} style={btnGreen}>保存</button>
              <button onClick={() => setNameModal(null)} style={btnGray}>キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {showPaidModal && (
        <div style={overlay} onClick={() => setShowPaidModal(false)} className="no-print">
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: "0 0 12px", fontSize: 18 }}>入金記録</h2>
            <div style={{ background: "#f8fafc", padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
              <p style={{ margin: 0 }}>請求額: <strong>{fmtYen(invoice.total)}</strong></p>
              <p style={{ margin: "2px 0 0" }}>累計入金: <strong>{fmtYen(totalPaid)}</strong></p>
              <p style={{ margin: "2px 0 0", color: remaining > 0 ? "#dc2626" : "#10b981", fontWeight: 700 }}>
                残額: {fmtYen(remaining)}
              </p>
            </div>
            <label style={{ fontSize: 11, color: "#777" }}>入金日</label>
            <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} style={modalInput} />
            <label style={{ fontSize: 11, color: "#777" }}>入金金額（空なら残額全額）</label>
            <input type="number" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)}
              placeholder={String(remaining)} style={modalInput} />
            <label style={{ fontSize: 11, color: "#777" }}>方法</label>
            <select value={paidMethod} onChange={(e) => setPaidMethod(e.target.value)} style={modalInput}>
              {["振込", "現金", "相殺", "値引", "手数料相殺", "その他"].map(m => <option key={m}>{m}</option>)}
            </select>
            <label style={{ fontSize: 11, color: "#777" }}>備考</label>
            <input value={paidNote} onChange={(e) => setPaidNote(e.target.value)}
              placeholder="例: 振込手数料330円差し引き / 端数値引き" style={modalInput} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={recordPayment} style={btnGreen}>記録する</button>
              <button onClick={() => setShowPaidModal(false)} style={btnGray}>キャンセル</button>
            </div>

            {payments.length > 0 && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #eee" }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "#555", margin: "0 0 6px" }}>入金履歴 ({payments.length}件)</p>
                {payments.map(p => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0", fontSize: 11, borderBottom: "1px solid #f3f4f6" }}>
                    <div>
                      <span>{new Date(p.paid_at).toLocaleDateString("ja-JP")}</span>
                      <span style={{ marginLeft: 8, padding: "1px 6px", background: "#eef2ff", color: "#3730a3", borderRadius: 99, fontSize: 10 }}>{p.method || "振込"}</span>
                      {p.note && <span style={{ marginLeft: 8, color: "#777" }}>{p.note}</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong>{fmtYen(p.amount)}</strong>
                      <button onClick={() => deletePayment(p.id)} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 12 }}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
const paidStamp: React.CSSProperties = { position: "absolute", bottom: 16, left: 24, textAlign: "left", pointerEvents: "none" }
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 80, zIndex: 50 }
const modal: React.CSSProperties = { background: "#fff", borderRadius: 10, padding: 20, width: "100%", maxWidth: 360 }
const modalInput: React.CSSProperties = { width: "100%", padding: 8, borderRadius: 6, border: "1px solid #ddd", fontSize: 13, marginBottom: 8, boxSizing: "border-box" }
