"use client"

// 開設見積書の印刷。総括ページ（内訳の一覧と合計）と、内訳ごとのページ（商品の明細）。
// ページはこちらで区切る（1ページに入る行数を決めて、A4 1枚ずつ作る）ので、ブラウザの余白・ヘッダーに左右されない。
import { use, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
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
    <table className="grid totals"><colgroup><col style={{ width: "9%" }} /><col /><col style={{ width: "22%" }} /></colgroup>
      <tbody><tr>
        <td className="remark-h">備<br />考</td>
        <td className="remark" rowSpan={1}>{noteText}</td>
        <td className="sums">
          <div><span>明 細 計</span><b>{yen(subtotal)}</b></div>
          <div><span>値　　引</span><b>{disc ? yen(disc) : ""}</b></div>
          <div><span>消 費 税</span><b>{yen(tax)}</b></div>
          <div className="grand"><span>合　　計</span><b>{yen(total)}</b></div>
        </td>
      </tr></tbody>
    </table>
  )

  const Head = ({ title, no, sub }: { title: string; no: string; sub?: string }) => (
    <header className="head">
      <h1>{title}</h1>
      <div className="meta">{dateStr}<br />{no}{sub ? <><br />{sub}</> : null}</div>
    </header>
  )

  return (
    <div className="oq">
      <style>{`
        .oq.oq { font-family: "Yu Mincho","MS PMincho","Hiragino Mincho ProN","Noto Serif JP",serif; color:#111; background:#e5e7eb; }
        .oq.oq .bar { position:sticky; top:0; background:#111827; color:#fff; padding:8px 16px; display:flex; gap:12px; align-items:center; z-index:10; font-family:sans-serif; font-size:13px; }
        .oq.oq .bar button { background:#2563eb; color:#fff; border:none; padding:6px 18px; border-radius:6px; font-size:13px; cursor:pointer; }
        .oq.oq .page { width:210mm; height:297mm; margin:12px auto; background:#fff; padding:13mm 14mm 11mm; box-sizing:border-box; box-shadow:0 1px 6px rgba(0,0,0,.25); overflow:hidden; position:relative; }
        .oq.oq h1 { font-family:inherit !important; font-size:24px !important; font-weight:700 !important; letter-spacing:.45em !important; color:#111 !important; text-align:center; margin:0 !important; padding:0 0 0 .45em; line-height:1.3 !important; }
        .oq.oq .head { position:relative; border-bottom:2.5px double #111; padding-bottom:7px; margin-bottom:10px; }
        .oq.oq .meta { position:absolute; right:0; top:2px; font-size:10.5px; line-height:1.55; text-align:right; }
        .oq.oq .to { font-size:18px; font-weight:700; border-bottom:1px solid #111; display:inline-block; min-width:60%; padding:0 6px 3px 0; margin:6px 0 10px; }
        .oq.oq .subject { font-size:14px; font-weight:700; margin:0 0 8px; }
        .oq.oq table.grid { width:100% !important; border-collapse:collapse; table-layout:fixed; }
        .oq.oq table.grid th { border:1px solid #111 !important; background:#eef0f3 !important; color:#111 !important; font-size:10.5px !important; font-weight:700 !important; padding:3px 5px !important; text-align:center; white-space:normal !important; letter-spacing:.05em !important; line-height:1.3; }
        .oq.oq table.grid td { border:1px solid #111 !important; background:#fff !important; color:#111 !important; font-size:11px !important; padding:2px 6px !important; vertical-align:middle !important; line-height:1.35; }
        .oq.oq table.grid tbody tr:hover td { background:#fff !important; }
        .oq.oq table.grid td.r { text-align:right; font-variant-numeric:tabular-nums; }
        .oq.oq table.grid td.c { text-align:center; }
        .oq.oq table.grid td.mono { font-family:"Consolas","Courier New",monospace; font-size:10px !important; }
        .oq.oq table.terms { width:44% !important; flex:none; }
        .oq.oq table.terms th { width:30%; background:#eef0f3 !important; }
        .oq.oq table.terms td { height:6.2mm; }
        .oq.oq table.sumlist tbody tr { height:7.6mm; }
        .oq.oq .company { position:relative; font-size:10.5px; line-height:1.65; padding-right:62px; }
        .oq.oq .company .nm { font-size:14px; font-weight:700; margin-bottom:2px; }
        .oq.oq .company .seal { position:absolute; top:-2px; right:0; }
        .oq.oq .grand-box { margin:14px 0 12px; text-align:center; border-top:1.5px solid #111; border-bottom:1.5px solid #111; padding:9px 0; }
        .oq.oq .grand-box .lb { font-size:13px; letter-spacing:.2em; margin-right:18px; }
        .oq.oq .grand-box .am { font-size:25px; font-weight:700; letter-spacing:.04em; }
        .oq.oq .grand-box .tx { font-size:10px; margin-left:8px; }
        .oq.oq table.totals { margin-top:-1px; }
        .oq.oq table.totals td.remark-h { text-align:center; vertical-align:top !important; background:#eef0f3 !important; font-size:10.5px !important; line-height:1.4; }
        .oq.oq table.totals td.remark { vertical-align:top !important; white-space:pre-wrap; height:23mm; font-size:10.5px !important; }
        .oq.oq table.totals td.sums { padding:0 !important; vertical-align:top !important; }
        .oq.oq .sums div { display:flex; justify-content:space-between; padding:2.5px 8px; border-bottom:1px solid #111; font-size:11px; }
        .oq.oq .sums div:last-child { border-bottom:none; }
        .oq.oq .sums .grand { background:#eef0f3; font-size:12.5px; font-weight:700; }
        .oq.oq .sec-title { text-align:center; font-size:15px; font-weight:700; margin:2px 0 4px; }
        .oq.oq .sec-total { text-align:center; margin:2px 0 11px; font-size:16px; font-weight:700; border-top:1px solid #111; border-bottom:1px solid #111; padding:6px 0; }
        .oq.oq table.detail tbody tr { height:11.2mm; }
        .oq.oq table.detail td.code { padding:0 !important; }
        .oq.oq .nm2 { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
        .oq.oq .pcode { display:flex; justify-content:space-between; font-size:9.5px; color:#444; gap:6px; }
        .oq.oq .lp { font-size:9.5px; color:#555; }
        .oq.oq .pgno { position:absolute; bottom:6mm; left:0; right:0; text-align:center; font-size:9.5px; color:#555; }
        @media print {
          .oq.oq { background:#fff; }
          .oq.oq .bar { display:none !important; }
          .oq.oq .page { margin:0; box-shadow:none; break-after:page; page-break-after:always; }
          .oq.oq .page:last-of-type { break-after:auto; page-break-after:auto; }
          @page { size:A4; margin:0; }
        }
      `}</style>
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
                <table className="grid terms"><tbody>
                  {([["納　　期", oq.delivery_date], ["納入場所", oq.delivery_place], ["検収期間", oq.inspection_period], ["有効期限", oq.expiry_text], ["支払条件", oq.payment_terms]] as [string, string | null][]).map(([k, v]) => (
                    <tr key={k}><th>{k}</th><td>{v || ""}</td></tr>
                  ))}
                </tbody></table>
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
          <table className="grid sumlist">
            <colgroup><col style={{ width: "7%" }} /><col style={{ width: "21%" }} /><col /><col style={{ width: "20%" }} /></colgroup>
            <thead><tr><th>No.</th><th>内訳管理No.</th><th>表　題</th><th>金額（税別）</th></tr></thead>
            <tbody>
              {rows.map(({ s, i }) => (
                <tr key={i}><td className="c">{i + 1}</td><td className="mono">{s.quote?.quote_number || ""}</td><td>{s.title}</td><td className="r">{yen(s.total)}</td></tr>
              ))}
            </tbody>
          </table>
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
            <table className="grid detail">
              <colgroup><col style={{ width: "5%" }} /><col /><col style={{ width: "15%" }} /><col style={{ width: "7%" }} /><col style={{ width: "16%" }} /><col style={{ width: "13%" }} /></colgroup>
              <thead><tr><th></th><th>商品コード ／ メーカー ／ 商品名</th><th>(定価)／単価</th><th>数量</th><th>金　額</th><th>摘　要</th></tr></thead>
              <tbody>
                {rows.map(({ it, i }) => {
                  const p = it.product_id ? prods.get(it.product_id) : undefined
                  const amount = Number(it.quantity || 0) * Number(it.price || 0)
                  return (
                    <tr key={it.id}>
                      <td className="c">{i + 1}</td>
                      <td><div className="pcode"><span>{p?.product_code || ""}</span><span>{p?.manufacturer || ""}</span></div><div className="nm2">{it.product_name}</div></td>
                      <td className="r"><div className="lp">{Number(it.list_price || 0) > 0 ? `(${yen(Number(it.list_price))})` : ""}</div><div>{yen(Number(it.price || 0))}</div></td>
                      <td className="r">{it.quantity}</td>
                      <td className="r">{yen(amount)}</td>
                      <td></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="pgno">{pages.length > 1 ? `${pi + 1} / ${pages.length}` : ""}</div>
          </section>
        ))
      })}
    </div>
  )
}
