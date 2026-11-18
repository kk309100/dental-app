"use client"

// 見積書（個別見積）の印刷。開設見積書と同じレイアウト。
//   ?unit=1  … 単価表（合計を出さず、品名と単価だけ）
//   ?total=0 … 合計金額（御見積金額・小計・消費税・合計）を出さない
// ページは、こちらで区切る（A4 1枚ずつ）。見出し（合算見積の元の見積）・小計は、ページの切れ目で、離れないようにする。
import { use, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import Seal from "@/app/components/Seal"
import { PRINT_CSS } from "@/lib/print-layout-css"
import { COMPANY_FALLBACK, getCompany, type Company } from "@/lib/company"
import { fmtDate, getClinicPrefix, getCorporateLabel } from "@/lib/invoice"

type Quote = { id: string; clinic_id: string | null; title: string | null; quote_number: string; issue_date: string; expiry_date: string | null; subtotal: number; tax: number; total: number; notes: string | null }
type Clinic = { id: string; name: string; corporate_name: string | null; clinic_type: string | null }
type Item = { id: string; product_id: string | null; product_name: string | null; quantity: number; price: number; list_price: number | null; sort_order: number; section_label?: string | null }
type Prod = { id: string; product_code: string | null; manufacturer: string | null }
type Row = { kind: "sec"; label: string } | { kind: "item"; it: Item; no: number } | { kind: "sub"; label: string; amount: number } | { kind: "gap" }
const yen = (n: number) => Math.round(n).toLocaleString("ja-JP")

// 1行の高さ（目安）。1ページに入る量を、これで数える
const H = { item: 1, sec: 0.7, sub: 0.7, gap: 0.3, totals: 2.8, notesOnly: 2.1 }
const CAP_FIRST = 14.3, CAP_REST = 20.3

export default function QuotePrintPage({ params }: { params: Promise<{ quoteId: string }> }) {
  const { quoteId } = use(params)
  const [opts, setOpts] = useState<{ unit: boolean; total: boolean } | null>(null)
  useEffect(() => { const sp = new URLSearchParams(window.location.search); setOpts({ unit: sp.get("unit") === "1", total: sp.get("total") !== "0" }) }, [])
  const unit = !!opts?.unit
  const showTotal = !!opts?.total && !unit
  const [quote, setQuote] = useState<Quote | null>(null)
  const [clinic, setClinic] = useState<Clinic | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [prods, setProds] = useState<Map<string, Prod>>(new Map())
  const [company, setCompany] = useState<Company>(COMPANY_FALLBACK as Company)
  const [ready, setReady] = useState(false)

  useEffect(() => { (async () => {
    getCompany().then(setCompany)
    const { data: q } = await supabase.from("quotes").select("*").eq("id", quoteId).single()
    if (!q) return
    setQuote(q as Quote)
    if ((q as Quote).clinic_id) setClinic(((await supabase.from("clinics").select("*").eq("id", (q as Quote).clinic_id).single()).data as Clinic) || null)
    const { data: its } = await supabase.from("quote_items").select("*").eq("quote_id", quoteId).order("sort_order")
    const list = (its as Item[]) || []
    setItems(list)
    const pids = Array.from(new Set(list.map(i => i.product_id).filter(Boolean) as string[]))
    const pm = new Map<string, Prod>()
    for (let i = 0; i < pids.length; i += 200) {
      const { data: ps } = await supabase.from("products").select("id,product_code,manufacturer").in("id", pids.slice(i, i + 200))
      for (const p of (ps as Prod[]) || []) pm.set(p.id, p)
    }
    setProds(pm)
    setReady(true)
  })() }, [quoteId])

  if (!quote || !ready || !opts) return <p style={{ padding: 24, color: "#888" }}>読み込み中…</p>

  const prefix = clinic ? getClinicPrefix(clinic.name, clinic.corporate_name, clinic.clinic_type) : ""
  const corp = clinic ? getCorporateLabel(clinic.corporate_name, clinic.name, clinic.clinic_type) : ""
  const d = new Date(quote.issue_date + "T00:00:00")
  const dateStr = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`

  // 行の並び: 見出し → 明細 → 小計（見出しつきの見積）→ すきま
  const groups: Row[][] = []
  items.forEach((it, idx) => {
    const g: Row[] = []
    const label = it.section_label || null
    if (label && label !== (items[idx - 1]?.section_label || null)) g.push({ kind: "sec", label })
    g.push({ kind: "item", it, no: idx + 1 })
    if (showTotal && label && label !== (items[idx + 1]?.section_label || null)) {
      g.push({ kind: "sub", label, amount: items.filter(x => (x.section_label || null) === label).reduce((n, x) => n + Number(x.price) * Number(x.quantity), 0) })
      if (items[idx + 1]) g.push({ kind: "gap" })
    }
    groups.push(g)
  })
  const hOf = (g: Row[]) => g.reduce((n, r) => n + (r.kind === "item" && unit ? 0.82 : H[r.kind]), 0)
  // 見出し〜最初の明細は、離さない。最後の明細は、合計・備考と、離さない（最後のページに、まとめて載せる）
  const tail = showTotal ? H.totals : H.notesOnly
  const pages: Row[][] = [[]]
  let used = 0
  groups.forEach((g, gi) => {
    const isLast = gi === groups.length - 1
    const need = hOf(g) + (isLast ? tail : 0)
    const cap = pages.length === 1 ? CAP_FIRST : CAP_REST
    if (used + need > cap && used > 0) { pages.push([]); used = 0 }
    pages[pages.length - 1].push(...g)
    used += hOf(g)
  })

  const cols = unit ? "8% 1fr 22%" : "5% 1fr 14% 7% 16%"
  const span = unit ? 2 : 4
  const renderRows = (rows: Row[]) => rows.flatMap((r, i) => {
    if (r.kind === "sec") return [<div className="sec" key={i + "s"}>■ {r.label}</div>]
    if (r.kind === "gap") return [<div className="gapc" key={i + "g"} />]
    if (r.kind === "sub") return [<div className="subl" key={i + "l"} style={{ gridColumn: `1 / span ${span}` }}>{r.label} 小計</div>, <div className="subr" key={i + "r"}>{yen(r.amount)}</div>]
    const it = r.it
    const p = it.product_id ? prods.get(it.product_id) : undefined
    if (unit) return [
      <div className="c" key={i + "a"}>{r.no}</div>,
      <div className="nmcell" key={i + "b"}><div className="nm2">{it.product_name}</div></div>,
      <div className="r" key={i + "c"}><b>{yen(Number(it.price))}</b></div>,
    ]
    return [
      <div className="c" key={i + "a"}>{r.no}</div>,
      <div className="nmcell" key={i + "b"}><div className="pcode"><span>{p?.product_code || ""}</span><span>{p?.manufacturer || ""}</span></div><div className="nm2">{it.product_name}</div></div>,
      <div className="pricecell" key={i + "c"}><div className="lp">{it.list_price != null && Number(it.list_price) > 0 ? `(${yen(Number(it.list_price))})` : ""}</div><div>{yen(Number(it.price))}</div></div>,
      <div className="r" key={i + "d"}>{it.quantity}</div>,
      <div className="r" key={i + "e"}>{yen(Number(it.price) * Number(it.quantity))}</div>,
    ]
  })

  const Head = ({ cont }: { cont?: boolean }) => (
    <header className="head">
      <h1>{unit ? "単 価 表" : "御 見 積 書"}</h1>
      <div className="meta">{dateStr}<br />No. {quote.quote_number}{cont ? <><br />（続き）</> : null}</div>
    </header>
  )
  const Tail = () => showTotal ? (
    <div className="gt" style={{ gridTemplateColumns: "9% 1fr 24%", marginTop: -1 }}>
      <div className="remark-h">備<br />考</div>
      <div className="remark">{quote.notes || ""}</div>
      <div className="sums">
        <div><span>小　　計</span><b>{yen(quote.subtotal)}</b></div>
        <div><span>消 費 税</span><b>{yen(quote.tax)}</b></div>
        <div className="grand"><span>合　　計</span><b>{yen(quote.total)}</b></div>
      </div>
    </div>
  ) : quote.notes ? (
    <div className="gt" style={{ gridTemplateColumns: "9% 1fr", marginTop: -1 }}>
      <div className="remark-h">備<br />考</div>
      <div className="remark">{quote.notes}</div>
    </div>
  ) : null

  return (
    <div className="oq">
      <style>{PRINT_CSS}</style>
      <div className="bar"><span>{quote.quote_number}</span><button onClick={() => window.print()}>印刷</button><span style={{ color: "#9ca3af" }}>（印刷画面の「余白」は「なし」、「背景のグラフィック」はオンにすると、きれいに出ます）</span></div>
      {pages.map((rows, pi) => (
        <section className="page" key={pi}>
          {pi === 0 ? (
            <>
              <Head />
              {corp && <div style={{ fontSize: 12, margin: "6px 0 0" }}>{corp}</div>}
              <div className="to">{prefix}{clinic?.name || ""}　御中</div>
              {quote.title && <p className="subject">{quote.title}</p>}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
                <div className="gt terms" style={{ gridTemplateColumns: "34% 1fr", gridAutoRows: "6.2mm" }}>
                  <div className="h">発 行 日</div><div className="l">{fmtDate(quote.issue_date)}</div>
                  <div className="h">有効期限</div><div className="l">{quote.expiry_date ? fmtDate(quote.expiry_date) : ""}</div>
                </div>
                <div className="company" style={{ flex: 1 }}>
                  <div className="nm">{company.name}</div>
                  <div>登録番号 {company.invoiceNumber}</div>
                  <div>〒{company.postalCode}　{company.address}</div>
                  <div>TEL {company.phone}　FAX {company.fax}</div>
                  <div className="seal"><Seal size={62} /></div>
                </div>
              </div>
              {showTotal && <div className="grand-box"><span className="lb">御見積金額</span><span className="am">¥ {yen(quote.total)}</span><span className="tx">（消費税込）</span></div>}
              <p className="lead">{unit ? "下記の各案より、ご希望のものをお選びください。" : "下記のとおり御見積申し上げます。"}</p>
            </>
          ) : <Head cont />}
          <div className={"gt quote" + (unit ? " unit" : "")} style={{ gridTemplateColumns: cols }}>
            {unit ? <><div className="h">No.</div><div className="h">品　名</div><div className="h">単　価</div></> : <><div className="h">No.</div><div className="h">商品コード ／ メーカー ／ 商品名</div><div className="h">(定価)／単価</div><div className="h">数量</div><div className="h">金　額</div></>}
            {renderRows(rows)}
            {items.length === 0 && <div className="notecell" style={{ minHeight: "12mm" }}>明細なし</div>}
          </div>
          {pi === pages.length - 1 && <Tail />}
          <div className="pgno">{pages.length > 1 ? `${pi + 1} / ${pages.length}` : ""}</div>
        </section>
      ))}
    </div>
  )
}
