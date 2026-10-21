"use client"

// 茶屋歯科フォーマット風 請求明細書（詳細版印刷）
// 既存の /admin/invoices/[invoiceId] のシンプル印刷とは別に、
// 業務用フォーマットで印刷したい時に使う
//
// レイアウト:
//   1ページ目: ヘッダー（宛先・自社・印影） + サマリー表（7列）+ 税率内訳 + カテゴリ別小計（12区分）+ 明細
//   2ページ目以降: ミニヘッダー（医院名 + Page N） + 明細続き
//   最終ページ: フッター（「上記の通り...」）

import { use, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { COMPANY_FALLBACK as COMPANY_DEFAULT, getCompany, type Company } from "@/lib/company"
import {
  fmtYen, fmtDate, parseDbDate, getClinicPrefix, getCorporateLabel,
  EXPENSE_CATEGORIES, normalizeExpenseCategory, isReducedTax, calcTaxFor, getTaxRounding,
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
    // 明細は、注文日の古い順に並べる（同じ日は伝票番号順。同じ伝票の中は、元の並びのまま）
    const orderIndex = new Map(items.map((it, i) => [it.id, i]))
    const sorted = items.slice().sort((a, b) => {
      const oa = orderMap.get(a.order_id), ob = orderMap.get(b.order_id)
      const da = oa ? String(oa.created_at) : "", db = ob ? String(ob.created_at) : ""
      return da.localeCompare(db) || String(oa?.delivery_number || "").localeCompare(String(ob?.delivery_number || "")) || (orderIndex.get(a.id) || 0) - (orderIndex.get(b.id) || 0)
    })
    return sorted.map(it => {
      const product = it.product_id ? productMap.get(it.product_id) : null
      const order = orderMap.get(it.order_id)
      const cat = normalizeExpenseCategory(product?.category)
      return {
        date: order ? parseDbDate(order.created_at).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "/") : "",
        delivery_number: order?.delivery_number || (order?.id.slice(0, 8) ?? ""),
        // 伝票: 注文日の月日4桁 + 納品書番号の末尾（例: 0925-674）。同じ日に複数の納品書があっても、区別できる
        slip4: order ? (() => {
          const d = parseDbDate(order.created_at)
          const md = String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0")
          const dn = String(order.delivery_number || order.id.slice(0, 8))
          const tail = dn.includes("-") ? dn.split("-").pop() : dn.slice(-3)
          return `${md}-${tail}`
        })() : "",
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
      tax10: calcTaxFor(amount10, 0.10, getTaxRounding()),
      amount8,
      tax8: calcTaxFor(amount8, 0.08, getTaxRounding()),
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

  // 1ページに入る明細の数: 初期値（余裕を見た固定値）で一度描いたあと、実際の高さを測って、入るだけ詰める。
  // 紙の下の端に達した時点で、次のページに続く。件数に頼らないので、行の高さや見出しの量が変わっても、はみ出さない。
  const [caps, setCaps] = useState<{ first: number; next: number }>({ first: 18, next: 26 })
  const miniRef = useRef<HTMLDivElement | null>(null)
  // 明細の表示: 1行（伝票番号を月日4桁にして、1商品を1行で）/ 2行（これまでの形）
  const [oneLine, setOneLine] = useState(true)
  useEffect(() => { try { const v = localStorage.getItem("invoicePrint.oneLine"); if (v === "0") setOneLine(false) } catch { /* 無視 */ } }, [])
  const chooseLayout = (v: boolean) => { setOneLine(v); try { localStorage.setItem("invoicePrint.oneLine", v ? "1" : "0") } catch { /* 無視 */ } }
  useLayoutEffect(() => {
    if (loading || lines.length === 0) return
    const probe = document.createElement("div")
    probe.style.cssText = "position:absolute;visibility:hidden;height:100mm;width:1px"
    document.body.appendChild(probe)
    const mm = probe.offsetHeight / 100
    probe.remove()
    const sec = document.querySelector(".invoice-page") as HTMLElement | null
    const table = sec?.querySelector("table") as HTMLElement | null
    const top = (sec?.querySelector("tr.dr-top") || sec?.querySelector("tr.dr-one")) as HTMLElement | null
    const bot = sec?.querySelector("tr.dr-bot") as HTMLElement | null
    if (!mm || !sec || !table || !top || (!oneLine && !bot)) return
    // 1商品の高さ: 2行表示は 5mm+8.5mm、1行表示は 8mm（どちらも固定）。測った値が小さくならないようにする
    const pairH = oneLine ? Math.max(top.offsetHeight, 8 * mm) : Math.max(top.offsetHeight + (bot?.offsetHeight || 0), 13.5 * mm)
    const theadH = (table.querySelector("thead") as HTMLElement | null)?.offsetHeight || 6 * mm
    const firstHeader = table.getBoundingClientRect().top - sec.getBoundingClientRect().top   // 1ページ目の、表より上の高さ（上の余白を含む）
    const miniH = (miniRef.current?.offsetHeight || 12 * mm) + 8                               // 2ページ目以降の、ミニヘッダー＋表の上の余白
    // 余裕: 画面で測った高さと、印刷したときの高さには、わずかな差が出る（1ページ目は、見出しが多いので、差が大きい）。
    const pageH = 297 * mm, pad = 10 * mm
    // 1ページ目の「表より上の高さ」は、画面で測った値より、印刷したときのほうが大きい（印刷で約102mm、画面で約60mm）。
    // 実際に印刷した請求明細書（スキャン）で測った値を、下限にする。これで、画面の測定が小さく出ても、はみ出さない。
    const firstHeaderPrint = Math.max(firstHeader, 112 * mm)
    const first = Math.max(4, Math.floor((pageH - firstHeaderPrint - pad - theadH - 4 * mm) / pairH))
    const next = Math.max(8, Math.floor((pageH - pad - pad - miniH - theadH - 8 * mm) / pairH))
    setCaps(prev => (prev.first === first && prev.next === next ? prev : { first, next }))
  }, [loading, lines.length, caps.first, caps.next, oneLine])

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}>読み込み中…</div>
  if (!invoice) return <div style={{ padding: 40, color: "#dc2626" }}>請求書が見つかりません</div>

  const corporateLabel = clinic ? getCorporateLabel(clinic.corporate_name, clinic.name, clinic.clinic_type) : ""
  const clinicPrefix = clinic ? getClinicPrefix(clinic.name, clinic.corporate_name, clinic.clinic_type) : ""
  const clinicFullName = `${clinicPrefix}${clinic?.name || "(医院不明)"}`

  // 1ページあたりの明細行数
  // ※ 各アイテムは2行（~9mm）で表示。1ページ目ヘッダー~65mm を差し引いた残り~212mmに収まる数
  // 1商品=2行で約9mm。A4の高さ（余白を除いて約277mm）に収まる数にする。多すぎると、表が次の紙にはみ出して、
  // 見出しだけが次のページに繰り返され、下の罫線も途切れてしまう。
  const FIRST_PAGE_LINES = caps.first
  const NEXT_PAGE_LINES = caps.next
  const FOOTER_ITEMS = oneLine ? 3 : 2   // 最終ページの「上記の通り…」のフッターが使う高さ（2行表示: 商品2件ぶん / 1行表示: 3行ぶん）
  const pages: typeof lines[] = []
  if (lines.length <= FIRST_PAGE_LINES - FOOTER_ITEMS) {
    pages.push(lines)
  } else {
    pages.push(lines.slice(0, FIRST_PAGE_LINES))
    let cursor = FIRST_PAGE_LINES
    while (cursor < lines.length) {
      const rest = lines.length - cursor
      if (rest <= NEXT_PAGE_LINES - FOOTER_ITEMS) { pages.push(lines.slice(cursor)); break }
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
        <span style={{ fontSize: 12, color: "#666" }}>明細の表示:</span>
        <button onClick={() => chooseLayout(true)} style={oneLine ? btnDark : btnGray}>1行</button>
        <button onClick={() => chooseLayout(false)} style={!oneLine ? btnDark : btnGray}>2行</button>
        <span style={{ fontSize: 12, color: "#666" }}>請求明細書（茶屋歯科フォーマット）</span>
        <button onClick={() => window.print()} style={btnDark}>🖨 印刷</button>
      </div>

      {/* ミニヘッダーの高さを測るための見本（画面にも印刷にも出ない） */}
      <div ref={miniRef} className="no-print" aria-hidden style={{ position: "absolute", visibility: "hidden", pointerEvents: "none", width: "186mm", left: 0, top: 0 }}>
        <MiniHeader clinicFullName={clinicFullName} pageInfo={{ current: 2, total: 9 }} />
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
              {/* カード決済ウォーターマーク（overflow:hidden を内側の絶対配置ラッパーに閉じ込める） */}
              {clinic?.payment_method === "カード" && (
                <div style={{
                  position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0,
                }}>
                  <div style={{
                    position: "absolute",
                    top: "50%", left: "50%",
                    transform: "translate(-50%, -50%) rotate(-25deg)",
                    fontSize: 52, fontWeight: 900,
                    color: "rgba(220, 38, 38, 0.13)",
                    border: "6px solid rgba(220, 38, 38, 0.13)",
                    padding: "10px 28px",
                    borderRadius: 6,
                    whiteSpace: "nowrap",
                    pointerEvents: "none",
                    letterSpacing: "0.15em",
                    WebkitPrintColorAdjust: "exact",
                    printColorAdjust: "exact",
                  } as React.CSSProperties}>カード決済</div>
                </div>
              )}

              {isFirstPage ? (
                <FullHeader
                  company={company}
                  clinic={clinic}
                  invoice={invoice}
                  corporateLabel={corporateLabel}
                  clinicFullName={clinicFullName}
                  pageInfo={{ current: 1, total: totalPages }}
                />
              ) : (
                <MiniHeader
                  clinicFullName={clinicFullName}
                  pageInfo={{ current: pageIdx + 1, total: totalPages }}
                />
              )}

              {isFirstPage && (
                <>
                  <SummaryTable summary={summary} />
                  <TaxBreakdownLine taxBreakdown={taxBreakdown} />
                  <CategoryTable byCategory={byCategory} />
                </>
              )}

              {/* 明細表（固定行数でパディング） */}
              <DetailTable
                oneLine={oneLine}
                lines={pageLines}
                startIdx={isFirstPage ? 0 : (FIRST_PAGE_LINES + (pageIdx - 1) * NEXT_PAGE_LINES)}
                fixedRows={(isFirstPage ? FIRST_PAGE_LINES : NEXT_PAGE_LINES) - (isLastPage ? FOOTER_ITEMS : 0)}
              />

              {/* フッター（最終ページのみ） */}
              {isLastPage && (
                <div style={{ fontSize: 10, marginTop: 4 }}>
                  <p style={{ margin: 0 }}>　上記の通り御請求申し上げます</p>
                  <p style={{ margin: 0 }}>　御照合の上、万が一相違の点が御座いましたら至急御連絡下さい</p>
                </div>
              )}
            </section>
          )
        })}
      </div>

      <style jsx global>{`
        /* ── admin-base.css の table/h1 強制スタイルを詳細印刷ページ内で上書き ── */
        /* 詳細: .main-inner table td (0,1,2) を .invoice-doc .invoice-page table td (0,2,2) で上回る */
        .invoice-doc .invoice-page table td,
        .invoice-doc .invoice-page table th {
          padding: 2px 4px !important;
          font-size: 9px !important;
        }
        .invoice-doc .invoice-page table td div,
        .invoice-doc .invoice-page table td span,
        .invoice-doc .invoice-page table td p,
        .invoice-doc .invoice-page table th div,
        .invoice-doc .invoice-page table th span {
          font-size: 9px !important;
        }
        .invoice-doc .invoice-page h1 {
          font-size: 22px !important;
        }
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
        /* 商品ごとの区切り線。セルの線（共通CSSの薄い線）のほうが強いため、セルに直接、濃い線を指定する */
        .invoice-doc .invoice-page table tr.dr-top > td { border-top: 1px solid #222 !important; }
        .invoice-doc .invoice-page table tr.dr-bot > td { border-bottom: 1px solid #222 !important; }
        /* 明細の文字の大きさ。共通CSSが 9px に強制しているため、明細表だけ、大きく指定し直す（行の高さは固定なので、ページの計算は、そのまま） */
        .invoice-doc .invoice-page table.detail1 td, .invoice-doc .invoice-page table.detail1 td span, .invoice-doc .invoice-page table.detail1 td div { font-size: 10.5px !important; }
        .invoice-doc .invoice-page table.detail2 td, .invoice-doc .invoice-page table.detail2 td span, .invoice-doc .invoice-page table.detail2 td div { font-size: 10px !important; }
        .invoice-doc .invoice-page table.detail1 th { font-size: 10px !important; }
        .invoice-doc .invoice-page table.detail1 tr.dr-one > td { border-bottom: 1px solid #222 !important; }
        .invoice-doc .invoice-page table.detail1 td.cat, .invoice-doc .invoice-page table.detail1 td.cat span { font-size: 9px !important; }
        /* 列を区切る縦線（最後の列は、外枠があるので、引かない） */
        .invoice-doc .invoice-page table.detail1 td, .invoice-doc .invoice-page table.detail1 th { border-right: 1px solid #555 !important; }
        .invoice-doc .invoice-page table.detail1 td:last-child, .invoice-doc .invoice-page table.detail1 th:last-child { border-right: none !important; }
        /* 集計表・カテゴリ表の囲い。共通CSSが、セルの下の線を、薄い灰色に強制するため、四方の線を黒で指定し直す */
        .invoice-doc .invoice-page table.frame td,
        .invoice-doc .invoice-page table.frame th { border: 1px solid #000 !important; }
        /* 1商品（2行）の途中で、ページが切れないようにする */
        .invoice-doc .invoice-page table tr, .invoice-doc .invoice-page table tbody.dr-group { break-inside: avoid; page-break-inside: avoid; }
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
        <div style={{ flex: 1, fontSize: 8, lineHeight: 1.4 }}>
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
        {/* 自社情報: 納品書と同じ並び（社名・登録番号を太字に、〒・住所2行・TEL・FAXを、それぞれ1行で、左をそろえる） */}
        <div style={{ flex: 1, fontSize: 10, lineHeight: 1.5, position: "relative", paddingRight: 60, textAlign: "left" }}>
          <div style={{ width: "fit-content", marginLeft: "auto" }}>
          <div style={{ fontWeight: 700 }}>{company.name}</div>
          {company.invoiceNumber && <div style={{ fontWeight: 700 }}>登録番号 {company.invoiceNumber}</div>}
          <div>〒{company.postalCode}</div>
          {(() => {
            // 住所は、最初の空白（全角・半角）で、2行に分ける（例: 「名古屋市中川区五月通2-37」/「黄金ステーションビル3階」）
            const m = String(company.address || "").match(/^(\S+?)[\s\u3000]+(.+)$/)
            return m ? <><div>{m[1]}</div><div>{m[2]}</div></> : <div>{company.address}</div>
          })()}
          <div>TEL {company.phone}</div>
          <div>FAX {company.fax}</div>
          {/* 振込先: 会社情報のすぐ下に、続けて入れる（間をあけない） */}
          <div>振込先: {company.bankName} {company.bankBranch} {company.bankType} {company.bankAccount}</div>
          <div>振込手数料は貴院負担でお願いいたします。</div>
          </div>
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
          {/* 締切日・支払期限（2行1列） */}
          {(() => {
            const issueDate = new Date(invoice.issue_date)
            const issueFmt = `${issueDate.getFullYear()}年${issueDate.getMonth() + 1}月${issueDate.getDate()}日`
            let dueFmt: string
            if (invoice.due_date) {
              const d = new Date(invoice.due_date)
              dueFmt = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
            } else {
              const endOfNextMonth = new Date(issueDate.getFullYear(), issueDate.getMonth() + 2, 0)
              dueFmt = `${endOfNextMonth.getFullYear()}年${endOfNextMonth.getMonth() + 1}月${endOfNextMonth.getDate()}日`
            }
            return (
              <div style={{ display: "inline-block", border: "1px solid #000", fontSize: 10, background: "#fff" }}>
                <div style={{ padding: "2px 10px", borderBottom: "1px solid #000", whiteSpace: "nowrap" }}>
                  締切日（請求日）：<strong>{issueFmt}</strong>
                </div>
                <div style={{ padding: "2px 10px", whiteSpace: "nowrap" }}>
                  お支払期限：<strong>{dueFmt}</strong>（締切日より1ヶ月後）
                </div>
              </div>
            )
          })()}
        </div>
      </div>
    </>
  )
}

// 全角カタカナを、半角カタカナに（濁点・半濁点は、2文字になる）。「ー」は、半角の「ｰ」にする
const HALF_KANA: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (let c = 0xff66; c <= 0xff9d; c++) { const h = String.fromCharCode(c); m[h.normalize("NFKC")] = h }
  for (const mark of ["ﾞ", "ﾟ"]) for (let c = 0xff66; c <= 0xff9d; c++) { const h = String.fromCharCode(c) + mark; const full = h.normalize("NFKC"); if (full.length === 1) m[full] = h }
  return m
})()
function toHalfKana(s: string): string { return Array.from(s).map(ch => HALF_KANA[ch] ?? ch).join("") }

function MiniHeader({ clinicFullName, pageInfo }: { clinicFullName: string; pageInfo: { current: number; total: number } }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 6, borderBottom: "2px solid #000", paddingBottom: 4 }}>
      <div style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{clinicFullName}　御中</div>
      <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.05em" }}>
        {pageInfo.current} / {pageInfo.total} ページ
      </div>
    </div>
  )
}

function SummaryTable({ summary }: { summary: { previousTotal: number; previousPaid: number; discount: number; carryOver: number; thisBuy: number; thisTax: number; thisTotal: number } }) {
  return (
    <table className="frame" style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 10 }}>
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
    <table className="frame" style={{ width: "100%", borderCollapse: "collapse", marginTop: 6, fontSize: 10 }}>
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
  date: string; delivery_number: string; slip4: string; manufacturer: string
  expense_category: ExpenseCategory; product_code: string; product_name: string
  quantity: number; list_price: number; unit_price: number; amount: number
}

function DetailTable({ lines, startIdx, fixedRows, oneLine }: { lines: LineRow[]; startIdx: number; fixedRows: number; oneLine: boolean }) {
  if (oneLine) return <DetailTableOneLine lines={lines} startIdx={startIdx} fixedRows={fixedRows} />
  // A4(210mm) - 左右パディング(12mm×2) = 186mm のコンテンツ幅
  // 固定列: 日付26mm + 数量10mm + 売単価24mm + 金額22mm = 82mm → 商品名列 = 104mm
  // 各アイテムは2行で表示するため、空スロット数 = fixedRows - lines.length
  const emptyCount = Math.max(0, fixedRows - lines.length)
  return (
    <table className="detail detail2" style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, fontSize: 9, tableLayout: "fixed", border: "2px solid #000" }}>
      <colgroup>
        <col style={{ width: "26mm" }} />
        <col />
        <col style={{ width: "10mm" }} />
        <col style={{ width: "24mm" }} />
        <col style={{ width: "22mm" }} />
      </colgroup>
      <thead>
        <tr style={{ background: "#f0f0f0", borderBottom: "2px solid #000" }}>
          <th style={{ ...cellLabel, border: "none", borderRight: "1px solid #999", textAlign: "left", padding: "2px 3px" }}>日付/伝票No.</th>
          <th style={{ ...cellLabel, border: "none", borderRight: "1px solid #999", textAlign: "left", padding: "2px 3px" }}>区分/メーカー/クラス/経費分類 // 商品コード/商品名</th>
          <th style={{ ...cellLabel, border: "none", borderRight: "1px solid #999", textAlign: "right", padding: "2px 3px" }}>数量</th>
          <th style={{ ...cellLabel, border: "none", borderRight: "1px solid #999", textAlign: "right", padding: "2px 3px" }}>(定価)/売単価</th>
          <th style={{ ...cellLabel, border: "none", textAlign: "right", padding: "2px 3px" }}>金額</th>
        </tr>
      </thead>
      {lines.length === 0 && emptyCount === 0 ? (
        <tbody><tr><td colSpan={5} style={{ padding: 16, textAlign: "center", color: "#999" }}>明細なし</td></tr></tbody>
      ) : lines.map((l, i) => (
        <DetailRowPair key={startIdx + i} line={l} />
      ))}
      {/* 固定行数に足りない分を、空白の枠（2行1組）で埋める */}
      {Array.from({ length: emptyCount }).map((_, i) => (
        <tbody key={`empty-${i}`} className="dr-group">
            <tr key={`empty-0-a`} className="dr-top" style={{ height: "5mm" }}>
              <td style={{ ...emptyCell, borderRight: "1px solid #aaa" }}></td>
              <td style={{ ...emptyCell, borderRight: "1px solid #aaa" }}></td>
              <td style={{ ...emptyCell, borderRight: "1px solid #aaa" }}></td>
              <td style={{ ...emptyCell, borderRight: "1px solid #aaa" }}></td>
              <td style={emptyCell}></td>
            </tr>
            <tr key={`empty-0-b`} className="dr-bot" style={{ height: "8.5mm" }}>
              <td style={{ ...emptyCell, borderRight: "1px solid #aaa" }}></td>
              <td style={{ ...emptyCell, borderRight: "1px solid #aaa" }}></td>
              <td style={{ ...emptyCell, borderRight: "1px solid #aaa" }}></td>
              <td style={{ ...emptyCell, borderRight: "1px solid #aaa" }}></td>
              <td style={emptyCell}></td>
            </tr>
        </tbody>
      ))}
    </table>
  )
}

// 1行表示: 1商品を1行で。伝票番号は、注文日の月日4桁（例: 0925）。商品名の欄を広く取り、メーカーは、商品名のあとに、薄く出す
function DetailTableOneLine({ lines, startIdx, fixedRows }: { lines: LineRow[]; startIdx: number; fixedRows: number }) {
  // 1商品=1行（8mm）。1ページに入る行数（fixedRows）は、1行の高さ（8mm）で計算してある
  const emptyCount = Math.max(0, fixedRows - lines.length)
  return (
    <table className="detail detail1" style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, tableLayout: "fixed", border: "2px solid #000" }}>
      <colgroup>
        <col style={{ width: "21mm" }} />
        <col style={{ width: "17mm" }} />
        <col />
        <col style={{ width: "13mm" }} />
        <col style={{ width: "10mm" }} />
        <col style={{ width: "20mm" }} />
        <col style={{ width: "22mm" }} />
      </colgroup>
      <thead>
        <tr style={{ background: "#f0f0f0", borderBottom: "2px solid #000" }}>
          <th style={{ ...cellLabel, border: "none", borderRight: "1px solid #999", textAlign: "left", padding: "2px 3px" }}>日付</th>
          <th style={{ ...cellLabel, border: "none", borderRight: "1px solid #999", textAlign: "center", padding: "2px 3px" }}>伝票</th>
          <th style={{ ...cellLabel, border: "none", borderRight: "1px solid #999", textAlign: "left", padding: "2px 3px" }}>商品コード / 商品名（メーカー）</th>
          <th style={{ ...cellLabel, border: "none", borderRight: "1px solid #999", textAlign: "center", padding: "2px 3px" }}>分類</th>
          <th style={{ ...cellLabel, border: "none", borderRight: "1px solid #999", textAlign: "right", padding: "2px 3px" }}>数量</th>
          <th style={{ ...cellLabel, border: "none", borderRight: "1px solid #999", textAlign: "right", padding: "2px 3px" }}>(定価)/売単価</th>
          <th style={{ ...cellLabel, border: "none", textAlign: "right", padding: "2px 3px" }}>金額</th>
        </tr>
      </thead>
      {lines.length === 0 && emptyCount === 0 ? (
        <tbody><tr><td colSpan={7} style={{ padding: 16, textAlign: "center", color: "#999" }}>明細なし</td></tr></tbody>
      ) : lines.map((l, i) => (
        <tbody key={startIdx + i} className="dr-group">
          <tr className="dr-one" style={{ height: "8mm" }}>
            <td style={{ padding: "1px 3px" }}>{l.date}</td>
            <td style={{ padding: "1px 3px", textAlign: "center" }}>{l.slip4}</td>
            <td style={{ padding: "1px 3px", overflow: "hidden" }}>
              {/* 長い商品名は、2行まで折り返して、全部見えるようにする（行の高さは固定のまま） */}
              <div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.2, wordBreak: "break-all" }}>
                {l.product_code && <span style={{ marginRight: 6 }}>{l.product_code}</span>}
                {l.product_name}
                {l.manufacturer && <span style={{ marginLeft: 6, color: "#666" }}>({l.manufacturer})</span>}
              </div>
            </td>
            <td className="cat" style={{ padding: "1px 1px", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden" }}>{l.expense_category}</td>
            <td style={{ padding: "1px 3px", textAlign: "right" }}>{l.quantity}</td>
            <td style={{ padding: "1px 3px", textAlign: "right", whiteSpace: "nowrap", lineHeight: 1.15 }}>
              <div style={{ color: "#555" }}>({l.list_price.toLocaleString()})</div>
              <div>{l.unit_price.toLocaleString()}</div>
            </td>
            <td style={{ padding: "1px 3px", textAlign: "right", fontWeight: 700 }}>{l.amount.toLocaleString()}</td>
          </tr>
        </tbody>
      ))}
      {Array.from({ length: emptyCount }).map((_, i) => (
        <tbody key={`empty-${i}`} className="dr-group">
          <tr className="dr-one" style={{ height: "8mm" }}>
            {Array.from({ length: 7 }).map((__, c) => <td key={c} style={{ ...emptyCell, borderRight: c < 6 ? "1px solid #aaa" : undefined }}></td>)}
          </tr>
        </tbody>
      ))}
    </table>
  )
}

function DetailRowPair({ line }: { line: LineRow }) {
  // 茶屋歯科風: 各明細を 2行 で表現
  // 1行目: 日付（左）、 売上 メーカー（中央）、 経費分類（右寄り）、 (定価)（右）
  // 2行目: 伝票No、 商品コード 商品名、 数量、 売単価、 金額
  return (
    <tbody className="dr-group">
      <tr className="dr-top" style={{ height: "5mm" }}>
        <td style={{ padding: "1px 3px", fontSize: 9 }}>{line.date}</td>
        {/* 経費分類を右端に寄せる（参考PDF準拠） */}
        <td style={{ padding: "1px 3px", fontSize: 9 }}>
          <div style={{ display: "flex", justifyContent: "space-between", overflow: "hidden" }}>
            <span style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
              売上　{line.manufacturer}
            </span>
            <span style={{ flexShrink: 0, marginLeft: 4 }}>{line.expense_category}</span>
          </div>
        </td>
        <td style={{ padding: "1px 3px", textAlign: "right" }}></td>
        <td style={{ padding: "1px 3px", textAlign: "right", fontSize: 9, color: "#555" }}>
          ({line.list_price.toLocaleString()})
        </td>
        <td style={{ padding: "1px 3px", textAlign: "right" }}></td>
      </tr>
      <tr className="dr-bot" style={{ height: "8.5mm" }}>
        <td style={{ padding: "1px 3px 3px", fontSize: 9, textAlign: "right" }}>{line.delivery_number}</td>
        <td style={{ padding: "1px 3px 3px", fontSize: 9, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          {line.product_code && <span style={{ marginRight: 6 }}>{line.product_code}</span>}
          {line.product_name}
        </td>
        <td style={{ padding: "1px 3px 3px", textAlign: "right", fontSize: 9 }}>{line.quantity}</td>
        <td style={{ padding: "1px 3px 3px", textAlign: "right", fontSize: 9 }}>{line.unit_price.toLocaleString()}</td>
        <td style={{ padding: "1px 3px 3px", textAlign: "right", fontSize: 9, fontWeight: 700 }}>{line.amount.toLocaleString()}</td>
      </tr>
    </tbody>
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

const emptyCell: React.CSSProperties = { padding: "1px 3px", fontSize: 9 }
const btnDark: React.CSSProperties = { padding: "6px 14px", borderRadius: 6, border: "none", background: "#111", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }
const btnGray: React.CSSProperties = { padding: "6px 14px", borderRadius: 6, border: "1px solid #ddd", background: "#f7f7f7", fontSize: 12, cursor: "pointer", color: "#333" }
