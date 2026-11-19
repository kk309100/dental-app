"use client"

// 開設見積書の印刷。総括ページ（内訳の一覧と合計）と、内訳ごとのページ（商品の明細）。
// ページはこちらで区切る（1ページに入る行数を決めて、A4 1枚ずつ作る）ので、ブラウザの余白・ヘッダーに左右されない。
import { use, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { PRINT_CSS } from "@/lib/print-layout-css"
import Seal from "@/app/components/Seal"
import { calcTax, ensureTaxRounding } from "@/lib/invoice"
import { COMPANY_FALLBACK, getCompany, type Company } from "@/lib/company"
import { loadQuoteItems, sectionStats, type OpeningQuote, type QuoteItem, type QuoteLite } from "@/lib/opening-quote"

type Sec = { quote: QuoteLite | null; title: string; items: QuoteItem[]; total: number }
type Prod = { id: string; product_code: string | null; manufacturer: string | null }
const yen = (n: number) => Math.round(n).toLocaleString("ja-JP")
const chunk = <T,>(a: T[], first: number, rest: number): T[][] => {
  if (a.length === 0) return [[]]
  const out: T[][] = [a.slice(0, first)]
  for (let i = first; i < a.length; i += rest) out.push(a.slice(i, i + rest))
  return out
}

const SUM_FIRST = 12      // 総括ページ（1枚目）に入る内訳の行数
const SUM_REST = 30       // 総括が、2枚目以降に続くときの行数
const DETAIL_ROWS = 18    // 内訳ページ1枚の明細の行数

export default function OpeningQuotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [oq, setOq] = useState<OpeningQuote | null>(null)
  const [clinicName, setClinicName] = useState("")
  const [secs, setSecs] = useState<Sec[]>([])
  const [prods, setProds] = useState<Map<string, Prod>>(new Map())
  const [company, setCompany] = useState<Company>(COMPANY_FALLBACK as Company)
  const [ready, setReady] = useState(false)

  useEffect(() => { (async () => {
    await ensureTaxRounding()
    getCompany().then(setCompany)
    const { data: o } = await supabase.from("opening_quotes").select("*").eq("id", id).single()
    if (!o) return
    const q = o as OpeningQuote
    setOq(q)
    if (q.clinic_id) setClinicName(((await supabase.from("clinics").select("name").eq("id", q.clinic_id).single()).data as { name?: string } | null)?.name || "")
    const { data: ss } = await supabase.from("opening_quote_sections").select("quote_id,title_override,sort_order").eq("opening_quote_id", id).order("sort_order")
    const rows = (ss as { quote_id: string; title_override: string | null }[]) || []
    const ids = rows.map(r => r.quote_id)
    const { data: qs } = await supabase.from("quotes").select("id,quote_number,title,subtotal,total,clinic_id").in("id", ids)
    const qmap = new Map(((qs as QuoteLite[]) || []).map(x => [x.id, x]))
    const its = await loadQuoteItems(ids)
    const pids = Array.from(new Set(its.map(i => i.product_id).filter(Boolean) as string[]))
    const pm = new Map<string, Prod>()
    for (let i = 0; i < pids.length; i += 200) {
      const { data: ps } = await supabase.from("products").select("id,product_code,manufacturer").in("id", pids.slice(i, i + 200))
      for (const p of (ps as Prod[]) || []) pm.set(p.id, p)
    }
    setProds(pm)
    setSecs(rows.map(r => {
      const quote = qmap.get(r.quote_id) || null
      const items = its.filter(i => i.quote_id === r.quote_id).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      return { quote, title: r.title_override || quote?.title || "", items, total: sectionStats(items).total }
    }))
    setReady(true)
  })() }, [id])

  if (!oq || !ready) return <p style={{ padding: 24, color: "#888" }}>読み込み中…</p>
  const subtotal = secs.reduce((n, s) => n + s.total, 0)
  const disc = Number(oq.discount || 0)
  const tax = calcTax(Math.max(0, subtotal - disc))
  const total = Math.max(0, subtotal - disc) + tax
  const d = oq.issue_date ? new Date(oq.issue_date + "T00:00:00") : new Date()
  const dateStr = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  const noteText = String(oq.note || "").split("\n").slice(0, 4).join("\n")
  const sumPages = chunk(secs.map((s, i) => ({ s, i })), SUM_FIRST, SUM_REST)

  const Totals = () => (
    <div className="gt" style={{ gridTemplateColumns: "9% 1fr 22%", marginTop: -1 }}>
      <div className="remark-h">備<br />考</div>
      <div className="remark">{noteText}</div>
      <div className="sums">
        <div><span>明 細 計</span><b>{yen(subtotal)}</b></div>
        <div><span>値　　引</span><b>{disc ? yen(disc) : ""}</b></div>
        <div><span>消 費 税</span><b>{yen(tax)}</b></div>
        <div className="grand"><span>合　　計</span><b>{yen(total)}</b></div>
      </div>
    </div>
  )

  const Head = ({ title, no, sub }: { title: string; no: string; sub?: string }) => (
    <header className="head">
      <h1>{title}</h1>
      <div className="meta">{dateStr}<br />{no}{sub ? <><br />{sub}</> : null}</div>
    </header>
  )

  return (
    <div className="oq">
      <style>{PRINT_CSS}</style>
      <div className="bar"><span>開設見積書 {oq.manage_no}</span><button onClick={() => window.print()}>印刷</button><span style={{ color: "#9ca3af" }}>（印刷画面の「余白」は「なし」、「背景のグラフィック」はオンにすると、きれいに出ます）</span></div>

      {/* 総括 */}
      {sumPages.map((rows, pi) => (
        <section className="page" key={"s" + pi}>
          {pi === 0 ? (
            <>
              <Head title="開設見積書" no={`No. ${oq.manage_no}`} />
              <div className="to">{clinicName}　御中</div>
              <p className="subject">{oq.title || ""}</p>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
                <div className="gt terms" style={{ gridTemplateColumns: "30% 1fr" }}>
                  {([["納　　期", oq.delivery_date], ["納入場所", oq.delivery_place], ["検収期間", oq.inspection_period], ["有効期限", oq.expiry_text], ["支払条件", oq.payment_terms]] as [string, string | null][]).flatMap(([k, v]) => [
                    <div className="h" key={k}>{k}</div>, <div className="l" key={k + "v"}>{v || ""}</div>,
                  ])}
                </div>
                <div className="company" style={{ flex: 1 }}>
                  <div className="nm">{company.name}</div>
                  <div>登録番号 {company.invoiceNumber}</div>
                  <div>〒{company.postalCode}　{company.address}</div>
                  <div>TEL {company.phone}　FAX {company.fax}</div>
                  <div className="seal"><Seal size={62} /></div>
                </div>
              </div>
              <div className="grand-box"><span className="lb">御見積合計金額</span><span className="am">¥ {yen(total)}</span><span className="tx">（消費税込）</span></div>
            </>
          ) : <Head title="開設見積書" no={`No. ${oq.manage_no}`} sub="（内訳の続き）" />}
          <div className="gt sumlist" style={{ gridTemplateColumns: "7% 21% 1fr 20%" }}>
            <div className="h">No.</div><div className="h">内訳管理No.</div><div className="h">内　訳</div><div className="h">金額（税別）</div>
            {rows.flatMap(({ s, i }) => [
              <div className="c" key={i + "a"}>{i + 1}</div>,
              <div className="mono" key={i + "b"}>{s.quote?.quote_number || ""}</div>,
              <div className="l" key={i + "c"}>{s.title}</div>,
              <div className="r" key={i + "d"}>{yen(s.total)}</div>,
            ])}
          </div>
          {pi === sumPages.length - 1 && <Totals />}
          <div className="pgno">{sumPages.length > 1 ? `総括 ${pi + 1} / ${sumPages.length}` : ""}</div>
        </section>
      ))}

      {/* 内訳 */}
      {secs.map((s, si) => {
        const pages = chunk(s.items.map((it, i) => ({ it, i })), DETAIL_ROWS, DETAIL_ROWS)
        return pages.map((rows, pi) => (
          <section className="page" key={`d${si}-${pi}`}>
            <Head title="開設見積書（内訳）" no={`内訳管理No. ${s.quote?.quote_number || ""}`} sub={`内訳 ${si + 1} / ${secs.length}`} />
            <div className="to" style={{ fontSize: 15, minWidth: "50%" }}>{clinicName}　御中</div>
            <div className="sec-title">{s.title}</div>
            <div className="sec-total">内訳合計金額（税別）　　¥ {yen(s.total)}</div>
            <div className="gt detail" style={{ gridTemplateColumns: "5% 1fr 15% 7% 16% 13%" }}>
              <div className="h"></div><div className="h">商品コード ／ メーカー ／ 商品名</div><div className="h">(定価)／単価</div><div className="h">数量</div><div className="h">金　額</div><div className="h">摘　要</div>
              {rows.flatMap(({ it, i }) => {
                const p = it.product_id ? prods.get(it.product_id) : undefined
                const amount = Number(it.quantity || 0) * Number(it.price || 0)
                return [
                  <div className="c" key={it.id + "a"}>{i + 1}</div>,
                  <div className="nmcell" key={it.id + "b"}><div className="pcode"><span>{p?.product_code || ""}</span><span>{p?.manufacturer || ""}</span></div><div className="nm2">{it.product_name}</div></div>,
                  <div className="pricecell" key={it.id + "c"}><div className="lp">{Number(it.list_price || 0) > 0 ? `(${yen(Number(it.list_price))})` : ""}</div><div>{yen(Number(it.price || 0))}</div></div>,
                  <div className="r" key={it.id + "d"}>{it.quantity}</div>,
                  <div className="r" key={it.id + "e"}>{yen(amount)}</div>,
                  <div className="l nt" key={it.id + "f"}><span className="ntt">{(it as { note?: string | null }).note || ""}</span></div>,
                ]
              })}
            </div>
            <div className="pgno">{pages.length > 1 ? `${pi + 1} / ${pages.length}` : ""}</div>
          </section>
        ))
      })}
    </div>
  )
}
