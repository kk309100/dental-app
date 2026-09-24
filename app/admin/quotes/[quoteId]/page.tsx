"use client"

import { useEffect, useState } from "react"
import { use } from "react"
import { supabase } from "@/lib/supabase"
import { COMPANY_FALLBACK as COMPANY_DEFAULT, getCompany, type Company } from "@/lib/company"
import { fmtYen, fmtDate, getClinicPrefix, getCorporateLabel, generateInvoiceNumber, calcDueDate } from "@/lib/invoice"
import { QUOTE_STATUSES, type QuoteStatus } from "@/lib/quote"
import { forceAddQuoteItemToPool } from "@/lib/po-pool"
import Seal from "@/app/components/Seal"
import Link from "next/link"

type Quote = {
  id: string
  clinic_id: string | null
  title: string | null
  quote_number: string
  issue_date: string
  expiry_date: string | null
  subtotal: number; tax: number; total: number
  status: QuoteStatus
  notes: string | null
  invoice_id: string | null
  created_at: string
}
type Clinic = { id: string; name: string; corporate_name: string | null; clinic_type: string | null; adress: string | null }
type QuoteItem = { id: string; product_id: string | null; product_name: string | null; quantity: number; price: number; list_price: number | null; sort_order: number }

export default function QuoteDetailPage({ params }: { params: Promise<{ quoteId: string }> }) {
  const { quoteId } = use(params)

  const [quote, setQuote] = useState<Quote | null>(null)
  const [clinic, setClinic] = useState<Clinic | null>(null)
  const [items, setItems] = useState<QuoteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [company, setCompany] = useState<Company>(COMPANY_DEFAULT)
  useEffect(() => { getCompany().then(setCompany) }, [])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [unitPriceMode, setUnitPriceMode] = useState(false)  // 単価表（合計を出さず、品名・単価だけ並べる）
  // 合計金額（御見積金額・小計・消費税・合計）を表示するかどうか。見積ごとにブラウザに保存する
  const [showTotal, setShowTotal] = useState(true)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [orderingId, setOrderingId] = useState<string | null>(null)

  useEffect(() => { fetchData() }, [quoteId])

  // 合計表示設定の読み込み・保存（Supabaseは変更せず、ブラウザ側にだけ保存）
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`denthub:quote_showtotal:${quoteId}`)
      if (saved !== null) setShowTotal(saved !== "0")
    } catch { /* localStorage不可の環境は無視 */ }
  }, [quoteId])
  function toggleShowTotal() {
    setShowTotal(prev => {
      const next = !prev
      try { localStorage.setItem(`denthub:quote_showtotal:${quoteId}`, next ? "1" : "0") } catch { /* ignore */ }
      return next
    })
  }

  async function fetchData(opts?: { silent?: boolean }) {
    if (!opts?.silent) { setLoading(true); setError("") }
    const { data: q, error: e1 } = await supabase.from("quotes").select("*").eq("id", quoteId).single()
    if (e1 || !q) { setError("見積書が見つかりません"); if (!opts?.silent) setLoading(false); return }
    setQuote(q as Quote)
    if (q.clinic_id) {
      const { data: cl } = await supabase.from("clinics").select("*").eq("id", q.clinic_id).single()
      setClinic(cl)
    }
    const { data: its } = await supabase.from("quote_items").select("*").eq("quote_id", quoteId).order("sort_order")
    setItems((its as QuoteItem[]) || [])
    if (!opts?.silent) setLoading(false)
  }

  async function updateStatus(newStatus: QuoteStatus) {
    if (!quote) return
    const { error: e } = await supabase.from("quotes").update({ status: newStatus }).eq("id", quote.id)
    if (e) { alert("更新失敗: " + e.message); return }
    fetchData({ silent: true })
  }

  // 見積を実行: 在庫ある商品 → 注文化（出荷準備可能） / 不足品 → 発注プールへ自動振り分け
  async function executeQuote() {
    if (!quote || !clinic) return
    if (quote.status === "converted") { alert("既に売上化済みです"); return }
    if (items.length === 0) { alert("明細がありません"); return }

    if (!confirm(`「${quote.quote_number}」を実行しますか？\n\n  ・在庫ある商品 → 注文として作成（出荷準備可能）\n  ・在庫不足 → 発注プールに追加（後で発注確定）\n\n見積書のステータスは「売上化済」になります。`)) return

    setBusy(true)
    try {
      // 1. 在庫確認
      const productIds = items.map(it => it.product_id).filter(Boolean) as string[]
      const { data: products } = await supabase.from("products").select("id,stock").in("id", productIds)
      const stockMap = new Map((products || []).map((p: any) => [p.id, Number(p.stock || 0)]))

      // 2. 注文作成 (status="準備中": 在庫ある分は出荷準備可能、不足分は発注後に出荷)
      const totalPrice = items.reduce((s, it) => s + Number(it.price) * Number(it.quantity), 0)
      const { data: ord, error: oe } = await supabase.from("orders").insert({
        clinic_id: quote.clinic_id,
        status: "準備中",
        total_price: totalPrice,
        delivery_number: `Q-${quote.quote_number}`,
        source: "admin",
        note: `見積 ${quote.quote_number} から実行`,
      }).select().single()
      if (oe || !ord) throw new Error("注文作成失敗: " + oe?.message)

      // 3. 注文明細
      const itemRows = items.map(it => ({
        order_id: ord.id,
        product_id: it.product_id,
        product_name: it.product_name,
        quantity: it.quantity,
        price: it.price,
      }))
      const { error: ie } = await supabase.from("order_items").insert(itemRows)
      if (ie) throw new Error("明細作成失敗: " + ie.message)

      // 4. 在庫充足判定
      let inStockCount = 0
      let shortCount = 0
      for (const it of items) {
        if (!it.product_id) { shortCount++; continue }
        const stock = stockMap.get(it.product_id) || 0
        if (stock >= Number(it.quantity)) inStockCount++
        else shortCount++
      }

      // 5. 不足分を発注プールへ
      let poolResultText = ""
      if (shortCount > 0) {
        const { poolFromOrders } = await import("@/lib/po-pool")
        const poolResult = await poolFromOrders([ord.id])
        if (poolResult.pos.length > 0) {
          poolResultText = "\n\n📦 発注プールに追加:"
          for (const p of poolResult.pos) {
            poolResultText += `\n  ${p.supplier_name}: ${p.added_items}品`
          }
        }
        if (poolResult.skippedNoSupplier > 0) {
          poolResultText += `\n  (仕入先未設定 ${poolResult.skippedNoSupplier}品はスキップ)`
        }
      }

      // 6. 見積書を「売上化済」に
      await supabase.from("quotes").update({ status: "converted" }).eq("id", quote.id)

      // 7. 結果表示 + 適切な画面に誘導
      const msg =
        `✅ 見積「${quote.quote_number}」を実行しました\n\n` +
        `📝 注文: ${ord.delivery_number} (¥${totalPrice.toLocaleString()})\n` +
        `🟢 在庫あり: ${inStockCount}品 → 出荷準備可能\n` +
        `🔴 在庫不足: ${shortCount}品` +
        poolResultText

      if (inStockCount > 0 && shortCount > 0) {
        // 両方ある → 出荷準備画面を優先
        if (confirm(msg + "\n\n出荷準備画面に移動しますか？")) {
          window.location.href = `/admin/shipping?orders=${ord.id}`
        }
      } else if (inStockCount > 0) {
        // 全部在庫あり → 出荷準備
        if (confirm(msg + "\n\n出荷準備画面に移動しますか？")) {
          window.location.href = `/admin/shipping?orders=${ord.id}`
        }
      } else if (shortCount > 0) {
        // 全部不足 → 発注プール画面
        if (confirm(msg + "\n\n発注プール画面に移動しますか？")) {
          window.location.href = "/admin/purchase-orders/pool"
        }
      } else {
        alert(msg)
      }
      fetchData({ silent: true })
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // 売上化: 見積から請求書 + 仮想注文を作成
  async function convertToInvoice() {
    if (!quote || !clinic) return
    if (quote.invoice_id) { alert("既に売上化済みです"); return }
    if (!confirm(`「${quote.quote_number}」を売上化（請求書発行）しますか？\n\n請求書 + 関連注文（納品済み扱い）が新規作成され、見積書のステータスは「売上化済」になります。`)) return

    setBusy(true)
    try {
      // 1) 仮想注文を作成（status='納品済み'）
      const orderPayload = {
        clinic_id: quote.clinic_id,
        status: "納品済み",
        total_price: quote.subtotal,
        delivery_number: `Q-${quote.quote_number}`,
      }
      const { data: ord, error: oe } = await supabase.from("orders").insert(orderPayload).select().single()
      if (oe || !ord) throw new Error("注文作成失敗: " + oe?.message)

      // 2) 注文明細を作成
      const itemsPayload = items.map((it) => ({
        order_id: ord.id,
        product_id: it.product_id,
        product_name: it.product_name,
        quantity: it.quantity,
        price: it.price,
      }))
      if (itemsPayload.length > 0) {
        const { error: ie } = await supabase.from("order_items").insert(itemsPayload)
        if (ie) throw new Error("明細作成失敗: " + ie.message)
      }

      // 3) 請求書作成
      const invoice_number = await generateInvoiceNumber(new Date())
      const { data: inv, error: ne } = await supabase.from("invoices").insert({
        clinic_id: quote.clinic_id,
        invoice_number,
        issue_date: new Date().toISOString().slice(0, 10),
        due_date: calcDueDate(new Date()),
        subtotal: quote.subtotal,
        tax: quote.tax,
        total: quote.total,
        status: "issued",
        notes: `見積書 ${quote.quote_number} から売上化`,
      }).select().single()
      if (ne || !inv) throw new Error("請求書作成失敗: " + ne?.message)

      // 4) 注文に invoice_id を紐付け
      const { error: ue } = await supabase.from("orders").update({ invoice_id: inv.id }).eq("id", ord.id)
      if (ue) throw new Error("紐付け失敗: " + ue.message)

      // 5) 見積書ステータス更新
      const { error: qe } = await supabase.from("quotes").update({ status: "converted", invoice_id: inv.id }).eq("id", quote.id)
      if (qe) throw new Error("見積更新失敗: " + qe.message)

      alert(`✓ 売上化完了\n請求書: ${invoice_number}`)
      fetchData({ silent: true })
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function toggleChecked(id: string) {
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // チェックした明細だけを発注プールへ追加（在庫状況に関わらず強制発注）
  async function orderCheckedItems() {
    if (checkedIds.size === 0) { alert("発注する商品にチェックを入れてください"); return }
    if (!confirm(`チェックした ${checkedIds.size} 件を発注プールへ追加しますか？`)) return
    setOrderingId("bulk")
    try {
      const results: string[] = []
      const errors: string[] = []
      for (const id of checkedIds) {
        const it = items.find(x => x.id === id)
        const r = await forceAddQuoteItemToPool(id)
        if (r.ok) results.push(`${it?.product_name || id}: ${r.supplierName}`)
        else errors.push(`${it?.product_name || id}: ${r.error}`)
      }
      let msg = ""
      if (results.length > 0) msg += "✅ 発注プールに追加:\n" + results.join("\n")
      if (errors.length > 0) msg += (msg ? "\n\n" : "") + "⚠️ 失敗:\n" + errors.join("\n")
      alert(msg)
      setCheckedIds(new Set())
    } finally {
      setOrderingId(null)
    }
  }

  function doPrint() { window.print() }

  if (loading) return <main style={page}><p>読み込み中…</p></main>
  if (error || !quote) return <main style={page}><p style={{ color: "#dc2626" }}>{error}</p></main>

  const status = QUOTE_STATUSES[quote.status]
  const clinicPrefix = clinic ? getClinicPrefix(clinic.name, clinic.corporate_name, clinic.clinic_type) : ""
  const corporateLabel = clinic ? getCorporateLabel(clinic.corporate_name, clinic.name, clinic.clinic_type) : ""

  return (
    <>
      <div style={toolbar} className="no-print">
        <Link href="/admin/quotes"><button style={btnGray}>← 一覧</button></Link>
        {quote.title && <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>{quote.title}</span>}
        <div style={{ flex: 1 }} />
        <span style={{ marginRight: 8, padding: "4px 12px", borderRadius: 99, background: status.color + "22", color: status.color, fontSize: 12, fontWeight: 700 }}>{status.label}</span>
        <Link href={`/admin/quotes/create?edit=${quote.id}`}><button style={btnGray}>✏️ 編集</button></Link>
        <Link href={`/admin/quotes/create?copy=${quote.id}`}><button style={btnGray}>📋 複製</button></Link>
        <button onClick={() => setUnitPriceMode(m => !m)} style={unitPriceMode ? btnGreen : btnGray} title="複数案からお選びいただく見積など、合計を出さず品名と単価だけを並べる表示に切り替えます">
          🧾 {unitPriceMode ? "通常表示に戻す" : "単価表で表示"}
        </button>
        {!unitPriceMode && (
          <button onClick={toggleShowTotal} style={showTotal ? btnGray : btnGreen} title="御見積金額・小計・消費税・合計の表示/非表示を切り替えます（この見積を開いたブラウザに記憶されます）">
            {showTotal ? "🙈 合計金額を非表示にする" : "👁 合計金額を表示する"}
          </button>
        )}
        <button onClick={doPrint} style={btnDark}>🖨 印刷</button>
        {quote.status === "draft" && <button onClick={() => updateStatus("sent")} style={btnGray}>送付済にする</button>}
        {(quote.status === "draft" || quote.status === "sent" || quote.status === "accepted") && quote.status !== "converted" && (
          <>
            {quote.status !== "accepted" && <button onClick={() => updateStatus("accepted")} style={btnGreen}>承認</button>}
            {/* メイン操作: 在庫振り分け実行 */}
            <button onClick={executeQuote} disabled={busy} style={{ ...btnDark, background: "#059669" }}>
              {busy ? "処理中…" : "💼 見積を実行（在庫品→納品 / 不足品→発注）"}
            </button>
            <button onClick={convertToInvoice} disabled={busy} style={btnPurple}>{busy ? "処理中…" : "✓ 売上化（請求書のみ）"}</button>
            <button onClick={() => updateStatus("rejected")} style={btnRed}>拒否</button>
          </>
        )}
        {quote.invoice_id && <Link href={`/admin/invoices/${quote.invoice_id}`}><button style={btnGray}>請求書を見る →</button></Link>}
      </div>

      <main style={printArea} className="print-area">
        <header style={{ borderBottom: "2px solid #111", paddingBottom: 8 }}>
          <h1 style={{ fontSize: 28, letterSpacing: "0.3em", margin: "20px 0 4px", textAlign: "center" }}>御 見 積 書</h1>
          <p style={{ textAlign: "center", margin: 0, fontSize: 11, color: "#666" }}>No. {quote.quote_number}</p>
          {quote.title && <p style={{ textAlign: "center", margin: "6px 0 0", fontSize: 15, fontWeight: 700 }}>{quote.title}</p>}
        </header>

        <div style={{ display: "flex", gap: 20, marginTop: 24 }}>
          <div style={{ flex: 1 }}>
            {clinic ? (
              <>
                {corporateLabel && <p style={{ margin: "0 0 4px", fontSize: 13 }}>{corporateLabel}</p>}
                <p style={{ margin: 0, fontSize: 22, fontWeight: 700, borderBottom: "1px solid #111", paddingBottom: 6 }}>
                  {clinicPrefix}{clinic.name}　御中
                </p>
              </>
            ) : <p style={{ color: "#999" }}>(医院情報なし)</p>}
          </div>
          <div style={{ flexShrink: 0, fontSize: 11, lineHeight: 1.6, position: "relative", paddingRight: 70 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{company.name}</p>
            <p style={{ margin: 0 }}>〒{company.postalCode}</p>
            <p style={{ margin: 0 }}>{company.address}</p>
            <p style={{ margin: 0 }}>TEL {company.phone}</p>
            {/* 印影 */}
            <div style={{ position: "absolute", top: 0, right: 0 }}>
              <Seal size={64} />
            </div>
          </div>
        </div>

        <div style={{ marginTop: 20, display: "flex", gap: 20, fontSize: 12 }}>
          <div><strong>発行日:</strong> {fmtDate(quote.issue_date)}</div>
          {quote.expiry_date && <div><strong>有効期限:</strong> {fmtDate(quote.expiry_date)}</div>}
        </div>

        {!unitPriceMode && showTotal && (
          <div style={totalBox}>
            <span style={{ fontSize: 13 }}>御見積金額（税込）</span>
            <span style={{ fontSize: 28, fontWeight: 800 }}>{fmtYen(quote.total)}</span>
          </div>
        )}

        <p style={{ fontSize: 11, color: "#666", margin: "16px 0 6px" }}>
          {unitPriceMode ? "下記の各案より、ご希望のものをお選びください。" : "下記のとおり御見積申し上げます。"}
        </p>

        {/* 明細から選んで発注（画面上のみ。印刷には出ない） */}
        {items.length > 0 && (
          <div className="no-print" style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={orderCheckedItems} disabled={orderingId !== null || checkedIds.size === 0} style={{ ...btnGray, opacity: checkedIds.size === 0 ? 0.5 : 1 }}>
              {orderingId ? "処理中…" : `📦 チェックした商品を発注（${checkedIds.size}）`}
            </button>
            <span style={{ fontSize: 11, color: "#9ca3af" }}>在庫があっても、選んだ商品だけ強制的に発注プールへ追加します</span>
          </div>
        )}

        {unitPriceMode ? (
          <table style={table}>
            <thead>
              <tr>
                <th className="no-print" style={{ ...th, width: 28 }}></th>
                <th style={th}>品名</th>
                <th style={{ ...th, width: 100, textAlign: "right" }}>単価</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? <tr><td colSpan={3} style={{ ...td, textAlign: "center", color: "#999" }}>明細なし</td></tr>
                : items.map((it) => (
                  <tr key={it.id}>
                    <td className="no-print" style={td}>
                      <input type="checkbox" checked={checkedIds.has(it.id)} onChange={() => toggleChecked(it.id)} />
                    </td>
                    <td style={td}>{it.product_name}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtYen(it.price)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th className="no-print" style={{ ...th, width: 28 }}></th>
                <th style={th}>品名</th>
                <th style={{ ...th, width: 60, textAlign: "right" }}>数量</th>
                <th style={{ ...th, width: 80, textAlign: "right" }}>定価</th>
                <th style={{ ...th, width: 80, textAlign: "right" }}>単価</th>
                <th style={{ ...th, width: 100, textAlign: "right" }}>金額</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? <tr><td colSpan={6} style={{ ...td, textAlign: "center", color: "#999" }}>明細なし</td></tr>
                : items.map((it) => (
                  <tr key={it.id} style={rowNoBreak}>
                    <td className="no-print" style={td}>
                      <input type="checkbox" checked={checkedIds.has(it.id)} onChange={() => toggleChecked(it.id)} />
                    </td>
                    <td style={td}>{it.product_name}</td>
                    <td style={{ ...td, textAlign: "right" }}>{it.quantity}</td>
                    <td style={{ ...td, textAlign: "right" }}>{it.list_price != null ? fmtYen(it.list_price) : "—"}</td>
                    <td style={{ ...td, textAlign: "right" }}>{fmtYen(it.price)}</td>
                    <td style={{ ...td, textAlign: "right" }}>{fmtYen(it.price * it.quantity)}</td>
                  </tr>
                ))}
              {Array.from({ length: Math.max(0, 10 - items.length) }).map((_, i) => (
                <tr key={"e" + i} style={rowNoBreak}><td className="no-print" style={td}></td><td style={td}>&nbsp;</td><td style={td}></td><td style={td}></td><td style={td}></td><td style={td}></td></tr>
              ))}
              {/* 小計・消費税・合計は tfoot にすると印刷時に複数ページそれぞれの末尾に
                  繰り返し表示されて紛らわしいため、通常の tbody 行として明細の最後に1回だけ表示する */}
              {showTotal && (
                <>
                  <tr style={rowNoBreak}><td className="no-print" style={td}></td><td colSpan={4} style={{ ...td, textAlign: "right", fontWeight: 600 }}>小計</td><td style={{ ...td, textAlign: "right" }}>{fmtYen(quote.subtotal)}</td></tr>
                  <tr style={rowNoBreak}><td className="no-print" style={td}></td><td colSpan={4} style={{ ...td, textAlign: "right", fontWeight: 600 }}>消費税</td><td style={{ ...td, textAlign: "right" }}>{fmtYen(quote.tax)}</td></tr>
                  <tr style={rowNoBreak}><td className="no-print" style={td}></td><td colSpan={4} style={{ ...tdTotal, textAlign: "right" }}>合計</td><td style={{ ...tdTotal, textAlign: "right" }}>{fmtYen(quote.total)}</td></tr>
                </>
              )}
            </tbody>
          </table>
        )}

        {quote.notes && (
          <div style={{ marginTop: 12, padding: 10, background: "#fafafa", border: "1px solid #eee", borderRadius: 4 }}>
            <p style={{ fontSize: 10, fontWeight: 700, margin: "0 0 4px", color: "#666" }}>備考</p>
            <p style={{ fontSize: 11, margin: 0, whiteSpace: "pre-wrap" }}>{quote.notes}</p>
          </div>
        )}
      </main>

      <style jsx global>{`
        @media print {
          .mobile-bottom-nav { display: none !important; }
          nav { display: none !important; }
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
const printArea: React.CSSProperties = { maxWidth: 760, margin: "0 auto", padding: 20, fontSize: 12, color: "#222", background: "#fff" }
const page: React.CSSProperties = { maxWidth: 760, margin: "0 auto", padding: 20 }
const btnDark: React.CSSProperties = { padding: "6px 14px", borderRadius: 6, border: "none", background: "#111", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }
const btnGray: React.CSSProperties = { padding: "6px 14px", borderRadius: 6, border: "1px solid #ddd", background: "#f7f7f7", fontSize: 12, cursor: "pointer", color: "#333" }
const btnGreen: React.CSSProperties = { padding: "6px 14px", borderRadius: 6, border: "1px solid #86efac", background: "#f0fdf4", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#15803d" }
const btnRed: React.CSSProperties = { padding: "6px 14px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff5f5", fontSize: 12, cursor: "pointer", color: "#dc2626" }
const btnPurple: React.CSSProperties = { padding: "6px 14px", borderRadius: 6, border: "1px solid #c4b5fd", background: "#f5f3ff", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#7c3aed" }
const totalBox: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, padding: "12px 20px", background: "#fafafa", border: "2px solid #111", borderRadius: 4 }
const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", marginTop: 4 }
const th: React.CSSProperties = { borderBottom: "2px solid #111", padding: "6px 8px", textAlign: "left", fontSize: 11, fontWeight: 700, background: "#fafafa" }
const td: React.CSSProperties = { borderBottom: "1px solid #eee", padding: "5px 8px", fontSize: 11 }
const tdTotal: React.CSSProperties = { borderTop: "2px solid #111", padding: "8px", fontSize: 13, fontWeight: 700 }
// 印刷時、1行の途中でページが分割されないようにする（Chrome等はtr単位のbreak-insideに対応）
const rowNoBreak: React.CSSProperties = { breakInside: "avoid", pageBreakInside: "avoid" }
