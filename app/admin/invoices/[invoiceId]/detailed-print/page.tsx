"use client"

// 茶屋歯科フォーマット風 請求明細書（詳細版印刷）
// 既存の /admin/invoices/[invoiceId] のシンプル印刷とは別に、
// 業務用フォーマットで印刷したい時に使う
//
// レイアウト:
//   1ページ目: ヘッダー（宛先・自社・印影） + サマリー表（7列）+ 税率内訳 + カテゴリ別小計（12区分）+ 明細
//   2ページ目以降: ミニヘッダー（医院名 + Page N） + 明細続き
//   最終ページ: フッター（「上記の通り...」）

import { use, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { COMPANY_FALLBACK as COMPANY_DEFAULT, getCompany, type Company } from "@/lib/company"
import {
  fmtYen, fmtDate, getClinicPrefix, getCorporateLabel,
  EXPENSE_CATEGORIES, normalizeExpenseCategory, isReducedTax,
  type ExpenseCategory,
} from "@/lib/invoice"
import Seal from "@/app/components/Seal"

type Invoice = {
  id: string; clinic_id: string | null; invoice_number: string
  issue_date: string; due_date: string | null
  subtotal: number; tax: number; total: number
  status: string; paid_at: string | null; paid_amount: number | null
  notes: string | null; created_at: string
}
type Clinic = {
  id: string; name: string; corporate_name: string | null
  contact: string | null; sales_rep: string | null; clinic_type: string | null
  adress: string | null; phone: string | null
  payment_method?: string | null
  closing_day?: string | null
}
type Order = {
  id: string; clinic_id: string; created_at: string
  total_price: number; delivery_number: string | null; status: string; invoice_id: string | null
}
type OrderItem = {
  id: string; order_id: string; product_id: string | null
  product_name: string | null; quantity: number; price: number
}
type Product = {
  id: string; name: string; product_code: string | null
  manufacturer: string | null; category: string | null; price: number | null
}

export default function DetailedInvoicePrint({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = use(params)

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [clinic, setClinic] = useState<Clinic | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [items, setItems] = useState<OrderItem[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [prevInvoice, setPrevInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [company, setCompany] = useState<Company>(COMPANY_DEFAULT)

  useEffect(() => { getCompany().then(setCompany) }, [])
  useEffect(() => { fetchData() }, [invoiceId])

  async function fetchData() {
    setLoading(true)
    const { data: inv } = await supabase.from("invoices").select("*").eq("id", invoiceId).single()
    if (!inv) { setLoading(false); return }
    setInvoice(inv as Invoice)

    if (inv.clinic_id) {
      const { data: cl } = await supabase.from("clinics").select("*").eq("id", inv.clinic_id).single()
      setClinic(cl)

      // 前回請求書: 同医院 / 取消除外 / 今回より古い、最新1件
      const { data: prev } = await supabase.from("invoices").select("*")
        .eq("clinic_id", inv.clinic_id)
        .neq("status", "cancelled")
        .lt("issue_date", inv.issue_date)
        .order("issue_date", { ascending: false })
        .limit(1)
      setPrevInvoice((prev?.[0] as Invoice) || null)
    }

    const { data: ords } = await supabase.from("orders").select("*").eq("invoice_id", invoiceId).order("created_at")
    setOrders((ords as Order[]) || [])

    if (ords && ords.length > 0) {
      const oids = ords.map(o => o.id)
      const { data: itms } = await supabase.from("order_items").select("*").in("order_id", oids).limit(50000)
      const orderItems = (itms as OrderItem[]) || []
      setItems(orderItems)

      const pids = Array.from(new Set(orderItems.map(i => i.product_id).filter(Boolean) as string[]))
      if (pids.length > 0) {
        const { data: prods } = await supabase.from("products")
          .select("id,name,product_code,manufacturer,category,price")
          .in("id", pids)
        setProducts((prods as Product[]) || [])
      }
    }

    setLoading(false)
  }

  // 明細を表示用に展開
  const lines = useMemo(() => {
    const productMap = new Map(products.map(p => [p.id, p]))
    const orderMap = new Map(orders.map(o => [o.id, o]))
    return items.map(it => {
      const product = it.product_id ? productMap.get(it.product_id) : null
      const order = orderMap.get(it.order_id)
      const cat = normalizeExpenseCategory(product?.category)
      return {
        date: order ? new Date(order.created_at).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "/") : "",
        delivery_number: order?.delivery_number || (order?.id.slice(0, 8) ?? ""),
        manufacturer: product?.manufacturer || "",
        expense_category: cat,
        product_code: product?.product_code || "",
        product_name: it.product_name || product?.name || "(商品名なし)",
        quantity: Number(it.quantity || 0),
        list_price: Number(product?.price || it.price || 0),
        unit_price: Number(it.price || 0),
        amount: Number(it.price || 0) * Number(it.quantity || 0),
        is_reduced: isReducedTax(cat),
      }
    })
  }, [items, products, orders])

  // カテゴリ別集計
  const byCategory = useMemo(() => {
    const m = new Map<ExpenseCategory, number>(
      EXPENSE_CATEGORIES.map(c => [c, 0] as [ExpenseCategory, number])
    )
    lines.forEach(l => {
      m.set(l.expense_category, (m.get(l.expense_category) || 0) + l.amount)
    })
    return m
  }, [lines])

  // 税率内訳（10% / 8%）
  const taxBreakdown = useMemo(() => {
    let amount10 = 0, amount8 = 0
    lines.forEach(l => {
      if (l.is_reduced) amount8 += l.amount
      else amount10 += l.amount
    })
    return {
      amount10,
      tax10: Math.round(amount10 * 0.10),
      amount8,
      tax8: Math.round(amount8 * 0.08),
    }
  }, [lines])

  // サマリー値
  const summary = useMemo(() => {
    const previousTotal = prevInvoice?.total || 0
    const previousPaid = prevInvoice?.paid_amount || 0
    const carryOver = previousTotal - previousPaid  // 繰越
    const discount = 0  // 値引（将来フィールド追加可）
    const thisBuy = invoice?.subtotal || 0
    const thisTax = invoice?.tax || (taxBreakdown.tax10 + taxBreakdown.tax8)
    const thisTotal = (invoice?.total || 0) + carryOver - discount
    return { previousTotal, previousPaid, discount, carryOver, thisBuy, thisTax, thisTotal }
  }, [prevInvoice, invoice, taxBreakdown])

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}>読み込み中…</div>
  if (!invoice) return <div style={{ padding: 40, color: "#dc2626" }}>請求書が見つかりません</div>

  const corporateLabel = clinic ? getCorporateLabel(clinic.corporate_name, clinic.name, clinic.clinic_type) : ""
  const clinicPrefix = clinic ? getClinicPrefix(clinic.name, clinic.corporate_name, clinic.clinic_type) : ""
  const clinicFullName = `${clinicPrefix}${clinic?.name || "(医院不明)"}`

  // 1ページあたりの明細行数（茶屋歯科参考: 1ページ目 約20行、2ページ目以降 約45行）
  // CSS で page-break を使って制御するため、ここでは固定分割
  const FIRST_PAGE_LINES = 20
  const NEXT_PAGE_LINES = 45
  const pages: typeof lines[] = []
  if (lines.length <= FIRST_PAGE_LINES) {
    pages.push(lines)
  } else {
    pages.push(lines.slice(0, FIRST_PAGE_LINES))
    let cursor = FIRST_PAGE_LINES
    while (cursor < lines.length) {
      pages.push(lines.slice(cursor, cursor + NEXT_PAGE_LINES))
      cursor += NEXT_PAGE_LINES
    }
  }
  const totalPages = pages.length

  return (
    <>
      {/* 操作バー（印刷時非表示） */}
      <div className="no-print" style={{
        position: "sticky", top: 0, zIndex: 10, background: "#fff",
        borderBottom: "1px solid #eee", padding: "10px 16px",
        display: "flex", gap: 8, alignItems: "center",
      }}>
        <Link href={`/admin/invoices/${invoiceId}`}>
          <button style={btnGray}>← 通常表示</button>
        </Link>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#666" }}>請求明細書（茶屋歯科フォーマット）</span>
        <button onClick={() => window.print()} style={btnDark}>🖨 印刷</button>
      </div>

      {/* 印刷本体 */}
      <div className="invoice-doc" style={{
        background: "#fff", margin: "0 auto", padding: 0,
        fontSize: 9, color: "#000", fontFamily: "'MS Mincho', 'Yu Mincho', serif",
      }}>
        {pages.map((pageLines, pageIdx) => {
          const isFirstPage = pageIdx === 0
          const isLastPage = pageIdx === totalPages - 1
          return (
            <section key={pageIdx} className="invoice-page" style={{
              width: "210mm", minHeight: "297mm", padding: "10mm 12mm 10mm",
              boxSizing: "border-box", margin: "0 auto", pageBreakAfter: isLastPage ? "auto" : "always",
              position: "relative",
            }}>
              {isFirstPage ? (
                /* ── 1ページ目: フルヘッダー ── */
                <FullHeader
                  company={company}
                  clinic={clinic}
                  invoice={invoice}
                  corporateLabel={corporateLabel}
                  clinicFullName={clinicFullName}
                  pageInfo={{ current: 1, total: totalPages }}
                />
              ) : (
                /* ── 2ページ目以降: ミニヘッダー ── */
                <MiniHeader
                  clinicFullName={clinicFullName}
                  pageInfo={{ current: pageIdx + 1, total: totalPages }}
                />
              )}

              {isFirstPage && (
                <>
                  {/* サマリー表（7列） */}
                  <SummaryTable summary={summary} />
                  {/* 税率内訳 */}
                  <TaxBreakdownLine taxBreakdown={taxBreakdown} />
                  {/* カテゴリ別小計（12区分） */}
                  <CategoryTable byCategory={byCategory} />
                </>
              )}

              {/* 明細表 */}
              <DetailTable lines={pageLines} startIdx={isFirstPage ? 0 : (FIRST_PAGE_LINES + (pageIdx - 1) * NEXT_PAGE_LINES)} />

              {/* フッター（最終ページのみ） */}
              {isLastPage && (
                <div style={{ marginTop: 20, fontSize: 10 }}>
                  <p style={{ margin: 0 }}>　上記の通り御請求申し上げます</p>
                  <p style={{ margin: 0 }}>　御照合の上、万が一相違の点が御座いましたら至急御連絡下さい</p>
                </div>
              )}
            </section>
          )
        })}
      </div>

      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; margin: 0 !important; }
          nav, header,
          .admin-layout-header,
          .mobile-bottom-nav,
          nav.mobile-bottom-nav,
          .mobile-spacer {
            display: none !important;
            visibility: hidden !important;
            height: 0 !important;
            overflow: hidden !important;
          }
          .invoice-doc { background: #fff; }
          .invoice-page {
            margin: 0 !important;
            padding: 10mm 12mm !important;
            box-shadow: none !important;
          }
        }
        @media screen {
          .invoice-doc { padding: 20px 0; background: #f3f4f6; }
          .invoice-page {
            background: #fff;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            margin-bottom: 16px !important;
          }
        }
        @page { size: A4 portrait; margin: 0; }
      `}</style>
    </>
  )
}

// ─────────────────────────────────────
// サブコンポーネント
// ─────────────────────────────────────

function FullHeader({ company, clinic, invoice, corporateLabel, clinicFullName, pageInfo }: {
  company: Company
  clinic: Clinic | null
  invoice: Invoice
  corporateLabel: string
  clinicFullName: string
  pageInfo: { current: number; total: number }
}) {
  return (
    <>
      {/* 上段: 自社住所（左） / タイトル（中央） / Page（右） */}
      <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 4 }}>
        <div style={{ flex: 1, fontSize: 9, lineHeight: 1.4 }}>
          〒{company.postalCode}<br />
          {company.address}
        </div>
        <div style={{ flex: 1, textAlign: "center", paddingTop: 4 }}>
          <h1 style={{
            fontSize: 22, letterSpacing: "0.2em", margin: 0,
            textDecoration: "underline", fontWeight: 700,
          }}>請求明細書</h1>
        </div>
        <div style={{ flex: 1, textAlign: "right", fontSize: 9 }}>
          {pageInfo.current} / {pageInfo.total} ページ
        </div>
      </div>

      {/* 中段: 宛先（左） / 自社情報（右、印影付き） */}
      <div style={{ display: "flex", marginTop: 12, gap: 16 }}>
        <div style={{ flex: 1, fontSize: 11 }}>
          {corporateLabel && <div style={{ fontSize: 11, marginBottom: 2 }}>{corporateLabel}</div>}
          <div style={{ fontSize: 13, fontWeight: 700 }}>{clinicFullName}　御中</div>
          {clinic?.contact && <div style={{ fontSize: 9, marginTop: 4, color: "#444" }}>[{clinic.contact}]</div>}
        </div>
        <div style={{ flex: 1, fontSize: 9, lineHeight: 1.4, position: "relative", paddingRight: 60 }}>
          <div style={{ fontWeight: 700 }}>{company.name}</div>
          {company.invoiceNumber && <div>登録番号 {company.invoiceNumber}</div>}
          <div>〒{company.postalCode}</div>
          <div>{company.address}</div>
          <div>TEL {company.phone}　　FAX {company.fax}</div>
          <div style={{ position: "absolute", top: 0, right: 0 }}>
            <Seal size={50} />
          </div>
        </div>
      </div>

      {/* 下段: 請求書番号 + 締切日・支払期限（左） / 振込先（右） */}
      <div style={{ display: "flex", marginTop: 8, gap: 16, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          {/* 請求書番号枠 */}
          <div style={{
            border: "1px solid #000", display: "inline-block",
            padding: "2px 12px", marginBottom: 5, fontSize: 10,
          }}>
            {invoice.invoice_number}
          </div>
          {/* カード決済 */}
          {clinic?.payment_method === "カード" && (
            <div style={{ marginBottom: 5 }}>
              <span style={{
                display: "inline-block",
                padding: "3px 14px",
                border: "2.5px solid #dc2626",
                color: "#dc2626",
                fontWeight: 900,
                fontSize: 12,
                letterSpacing: "0.15em",
                borderRadius: 3,
              }}>💳 カード決済</span>
            </div>
          )}
          {/* 締切日・支払期限 */}
          {(() => {
            const issueDate = new Date(invoice.issue_date)
            const issueFmt = `${issueDate.getFullYear()}年${issueDate.getMonth() + 1}月${issueDate.getDate()}日`
            let dueFmt: string
            if (invoice.due_date) {
              const d = new Date(invoice.due_date)
              dueFmt = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
            } else {
              // 翌月末（締日より1ヶ月後）
              const endOfNextMonth = new Date(issueDate.getFullYear(), issueDate.getMonth() + 2, 0)
              dueFmt = `${endOfNextMonth.getFullYear()}年${endOfNextMonth.getMonth() + 1}月${endOfNextMonth.getDate()}日`
            }
            return (
              <div style={{
                display: "inline-flex", gap: 24, alignItems: "center",
                border: "1px solid #999", padding: "4px 10px",
                fontSize: 10, background: "#fafafa",
              }}>
                <span>締切日（請求日）：<strong>{issueFmt}</strong></span>
                <span>お支払期限：<strong>{dueFmt}</strong>（締切日より1ヶ月後）</span>
              </div>
            )
          })()}
        </div>
        <div style={{ flex: 1, fontSize: 9, lineHeight: 1.4 }}>
          振込先: {company.bankName} {company.bankBranch} {company.bankType} {company.bankAccount}<br />
          振込手数料は貴院負担でお願いいたします。
        </div>
      </div>
    </>
  )
}

function MiniHeader({ clinicFullName, pageInfo }: { clinicFullName: string; pageInfo: { current: number; total: number } }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
      <div style={{ flex: 1, fontSize: 11 }}>{clinicFullName}　御中</div>
      <div style={{ fontSize: 10 }}>{pageInfo.current} / {pageInfo.total} ページ</div>
    </div>
  )
}

function SummaryTable({ summary }: { summary: { previousTotal: number; previousPaid: number; discount: number; carryOver: number; thisBuy: number; thisTax: number; thisTotal: number } }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 10 }}>
      <thead>
        <tr style={{ background: "#fff" }}>
          <th style={cellLabel}>前回御請求額</th>
          <th style={cellLabel}>御入金額</th>
          <th style={cellLabel}>値引額</th>
          <th style={cellLabel}>繰越金額</th>
          <th style={cellLabel}>今回御買上額</th>
          <th style={cellLabel}>消費税</th>
          <th style={cellLabel}>今回御請求額</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style={cellNum}>{summary.previousTotal.toLocaleString()}</td>
          <td style={cellNum}>{summary.previousPaid.toLocaleString()}</td>
          <td style={cellNum}>{summary.discount.toLocaleString()}</td>
          <td style={cellNum}>{summary.carryOver.toLocaleString()}</td>
          <td style={cellNum}>{summary.thisBuy.toLocaleString()}</td>
          <td style={cellNum}>{summary.thisTax.toLocaleString()}</td>
          <td style={{ ...cellNum, fontWeight: 700, fontSize: 12 }}>{summary.thisTotal.toLocaleString()}</td>
        </tr>
      </tbody>
    </table>
  )
}

function TaxBreakdownLine({ taxBreakdown }: { taxBreakdown: { amount10: number; tax10: number; amount8: number; tax8: number } }) {
  return (
    <div style={{ marginTop: 8, fontSize: 10 }}>
      （　10%対象金額 {taxBreakdown.amount10.toLocaleString()} 　消費税 {taxBreakdown.tax10.toLocaleString()} 　：
      {" "}8%対象金額 {taxBreakdown.amount8.toLocaleString()} 　消費税 {taxBreakdown.tax8.toLocaleString()} 　）
    </div>
  )
}

function CategoryTable({ byCategory }: { byCategory: Map<ExpenseCategory, number> }) {
  // 上段6カテゴリ + 下段6カテゴリ
  const top = EXPENSE_CATEGORIES.slice(0, 6)
  const bottom = EXPENSE_CATEGORIES.slice(6, 12)
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6, fontSize: 10 }}>
      <thead>
        <tr>{top.map(c => <th key={c} style={cellLabel}>{c}</th>)}</tr>
      </thead>
      <tbody>
        <tr>{top.map(c => <td key={c} style={cellNum}>{(byCategory.get(c) || 0).toLocaleString()}</td>)}</tr>
        <tr>{bottom.map(c => <th key={c} style={cellLabel}>{c}</th>)}</tr>
        <tr>{bottom.map(c => <td key={c} style={cellNum}>{(byCategory.get(c) || 0).toLocaleString()}</td>)}</tr>
      </tbody>
    </table>
  )
}

type LineRow = {
  date: string; delivery_number: string; manufacturer: string
  expense_category: ExpenseCategory; product_code: string; product_name: string
  quantity: number; list_price: number; unit_price: number; amount: number
}

function DetailTable({ lines, startIdx }: { lines: LineRow[]; startIdx: number }) {
  // A4(210mm) - 左右パディング(12mm×2) = 186mm のコンテンツ幅
  // 固定列: 日付26mm + 数量10mm + 売単価24mm + 金額22mm = 82mm → 商品名列 = 104mm
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, fontSize: 9, tableLayout: "fixed" }}>
      <colgroup>
        <col style={{ width: "26mm" }} />
        <col />
        <col style={{ width: "10mm" }} />
        <col style={{ width: "24mm" }} />
        <col style={{ width: "22mm" }} />
      </colgroup>
      <thead>
        <tr style={{ background: "#fff", borderTop: "1px solid #000", borderBottom: "1px solid #000" }}>
          <th style={{ ...cellLabel, textAlign: "left", padding: "2px 3px" }}>日付/伝票№.</th>
          <th style={{ ...cellLabel, textAlign: "left", padding: "2px 3px" }}>区分/メーカー/クラス/経費分類 // 商品コード/商品名</th>
          <th style={{ ...cellLabel, textAlign: "right", padding: "2px 3px" }}>数量</th>
          <th style={{ ...cellLabel, textAlign: "right", padding: "2px 3px" }}>(定価)/売単価</th>
          <th style={{ ...cellLabel, textAlign: "right", padding: "2px 3px" }}>金額</th>
        </tr>
      </thead>
      <tbody>
        {lines.length === 0 ? (
          <tr><td colSpan={5} style={{ padding: 16, textAlign: "center", color: "#999" }}>明細なし</td></tr>
        ) : lines.map((l, i) => (
          <DetailRowPair key={startIdx + i} line={l} />
        ))}
      </tbody>
    </table>
  )
}

function DetailRowPair({ line }: { line: LineRow }) {
  // 茶屋歯科風: 各明細を 2行 で表現
  // 1行目: 日付（左）、 売上 メーカー（中央）、 経費分類（右寄り）、 (定価)（右）
  // 2行目: 伝票No、 商品コード 商品名、 数量、 売単価、 金額
  return (
    <>
      <tr style={{ borderTop: "1px solid #ddd" }}>
        <td style={{ padding: "1px 3px", fontSize: 9, overflow: "hidden" }}>{line.date}</td>
        <td style={{ padding: "1px 3px", fontSize: 9, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          売上 {line.manufacturer}
          <span style={{ marginLeft: 8 }}>{line.expense_category}</span>
        </td>
        <td style={{ padding: "1px 3px", textAlign: "right" }}></td>
        <td style={{ padding: "1px 3px", textAlign: "right", fontSize: 9, color: "#666" }}>
          ({line.list_price.toLocaleString()})
        </td>
        <td style={{ padding: "1px 3px", textAlign: "right" }}></td>
      </tr>
      <tr>
        <td style={{ padding: "1px 3px", fontSize: 9, textAlign: "right", overflow: "hidden", whiteSpace: "nowrap" }}>{line.delivery_number}</td>
        <td style={{ padding: "1px 3px 4px", fontSize: 9, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          {line.product_code && <span style={{ marginRight: 6 }}>{line.product_code}</span>}
          {line.product_name}
        </td>
        <td style={{ padding: "1px 3px 4px", textAlign: "right", fontSize: 9 }}>{line.quantity}</td>
        <td style={{ padding: "1px 3px 4px", textAlign: "right", fontSize: 9 }}>{line.unit_price.toLocaleString()}</td>
        <td style={{ padding: "1px 3px 4px", textAlign: "right", fontSize: 9, fontWeight: 700 }}>{line.amount.toLocaleString()}</td>
      </tr>
    </>
  )
}

// ─────────────────────────────────────
// styles
// ─────────────────────────────────────

const cellLabel: React.CSSProperties = {
  border: "1px solid #000",
  background: "#f0f0f0",
  fontSize: 9,
  fontWeight: "normal",
  padding: "2px 4px",
  textAlign: "center",
}

const cellNum: React.CSSProperties = {
  border: "1px solid #000",
  fontSize: 10,
  padding: "3px 6px",
  textAlign: "right",
  fontFamily: "'MS Mincho', monospace",
}

const btnDark: React.CSSProperties = { padding: "6px 14px", borderRadius: 6, border: "none", background: "#111", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }
const btnGray: React.CSSProperties = { padding: "6px 14px", borderRadius: 6, border: "1px solid #ddd", background: "#f7f7f7", fontSize: 12, cursor: "pointer", color: "#333" }
