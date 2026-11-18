"use client"

// 開設見積書の印刷。1ページ目が「総括」、2ページ目以降が、内訳ごとの「内訳」ページ。
import { use, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import Seal from "@/app/components/Seal"
import { calcTax, ensureTaxRounding } from "@/lib/invoice"
import { COMPANY_FALLBACK, getCompany, type Company } from "@/lib/company"
import { loadQuoteItems, sectionStats, type OpeningQuote, type QuoteItem, type QuoteLite } from "@/lib/opening-quote"

type Sec = { quote: QuoteLite | null; title: string; items: QuoteItem[]; total: number }
type Prod = { id: string; product_code: string | null; manufacturer: string | null }
const yen = (n: number) => Math.round(n).toLocaleString("ja-JP")

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
  const dateStr = `${d.getFullYear()} 年 ${String(d.getMonth() + 1).padStart(2, "0")} 月 ${String(d.getDate()).padStart(2, "0")} 日`
  const noteLines = String(oq.note || "").split("\n").slice(0, 4)

  return (
    <div className="oq">
      <style>{`
        body { margin:0; background:#e5e7eb; }
        .oq { font-family: "MS PMincho","Yu Mincho","Hiragino Mincho ProN",serif; color:#000; }
        .oq .bar { position:sticky; top:0; background:#111827; color:#fff; padding:8px 16px; display:flex; gap:12px; align-items:center; z-index:10; font-family:sans-serif; font-size:13px; }
        .oq .bar button { background:#2563eb; color:#fff; border:none; padding:6px 16px; border-radius:6px; font-size:13px; cursor:pointer; }
        .oq .page { width:210mm; min-height:297mm; margin:12px auto; background:#fff; padding:14mm 14mm 12mm; box-sizing:border-box; box-shadow:0 1px 6px rgba(0,0,0,.2); }
        .oq h1 { text-align:center; font-size:20px; margin:0 0 6px; text-decoration:underline; text-underline-offset:4px; }
        .oq table { border-collapse:collapse; }
        .oq .grid td, .oq .grid th { border:1px solid #000; padding:2px 6px; font-size:11px; }
        .oq .grid th { background:#fff; font-weight:normal; text-align:center; }
        .oq .grid tr { break-inside:avoid; }
        .oq .grid thead { display:table-header-group; }
        .oq .r { text-align:right; font-variant-numeric:tabular-nums; }
        @media print { body { background:#fff; } .oq .bar { display:none; } .oq .page { margin:0; box-shadow:none; width:auto; min-height:0; padding:0; page-break-after:always; } .oq .page:last-child { page-break-after:auto; } @page { size:A4; margin:12mm; } }
      `}</style>
      <div className="bar"><span>開設見積書 {oq.manage_no}</span><button onClick={() => window.print()}>印刷</button><span style={{ color: "#9ca3af" }}>（印刷画面で「ヘッダーとフッター」を、オフにしてください）</span></div>

      {/* 総括ページ */}
      <section className="page">
        <h1>開設見積書</h1>
        <div style={{ textAlign: "right", fontSize: 11, lineHeight: 1.6 }}>{dateStr}<br />No. {oq.manage_no}</div>
        <p style={{ fontSize: 15, fontWeight: 700, margin: "10px 0 14px" }}>{clinicName}　御中</p>
        <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", textDecoration: "underline", textUnderlineOffset: 3 }}>{oq.title || ""}</p>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <table className="grid" style={{ width: "46%" }}><tbody>
            {([["納　期", oq.delivery_date], ["納入場所", oq.delivery_place], ["検収期間", oq.inspection_period], ["有効期限", oq.expiry_text], ["支払条件", oq.payment_terms]] as [string, string | null][]).map(([k, v]) => (
              <tr key={k}><th style={{ width: 62 }}>{k}</th><td style={{ height: 16 }}>{v || ""}</td></tr>
            ))}
          </tbody></table>
          <div style={{ position: "relative", fontSize: 11, lineHeight: 1.6, paddingRight: 70, minWidth: "46%" }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{company.name}</div>
            <div>登録番号 {company.invoiceNumber}</div>
            <div>〒{company.postalCode}</div>
            <div>{company.address}</div>
            <div>TEL {company.phone}　FAX {company.fax}</div>
            <div style={{ position: "absolute", top: -4, right: 0 }}><Seal size={66} /></div>
          </div>
        </div>
        <p style={{ textAlign: "center", fontSize: 20, fontWeight: 700, margin: "26px 0 20px" }}>
          <span style={{ textDecoration: "underline", textUnderlineOffset: 5 }}>御見積合計金額　　¥ {yen(total)}</span>
        </p>
        <table className="grid" style={{ width: "100%" }}>
          <thead><tr><th style={{ width: 26 }}></th><th style={{ width: 96 }}>内訳管理No.</th><th>表題</th><th style={{ width: 92 }}>金額</th></tr></thead>
          <tbody>
            {secs.map((s, i) => (
              <tr key={i}><td className="r">{i + 1}</td><td className="r" style={{ fontFamily: "monospace", fontSize: 10 }}>{s.quote?.quote_number || ""}</td><td>{s.title}</td><td className="r">{yen(s.total)}</td></tr>
            ))}
          </tbody>
        </table>
        <table className="grid" style={{ width: "100%", marginTop: -1 }}>
          <tbody><tr>
            <td style={{ width: 28, textAlign: "center", verticalAlign: "top", lineHeight: 1.3 }}>備<br />考</td>
            <td style={{ verticalAlign: "top", whiteSpace: "pre-wrap", height: 64 }}>{noteLines.join("\n")}</td>
            <td style={{ width: 150, padding: 0, verticalAlign: "top" }}>
              <table style={{ width: "100%" }}><tbody>
                {([["明細計", subtotal], ["値　引", disc], ["消費税", tax], ["合　計", total]] as [string, number][]).map(([k, v]) => (
                  <tr key={k}><td style={{ border: "none", borderBottom: "1px solid #000", padding: "2px 6px", fontSize: 11, width: 52 }}>{k}</td><td className="r" style={{ border: "none", borderBottom: "1px solid #000", padding: "2px 6px", fontSize: 11 }}>{k === "値　引" && v === 0 ? "" : yen(v)}</td></tr>
                ))}
              </tbody></table>
            </td>
          </tr></tbody>
        </table>
      </section>

      {/* 内訳ページ */}
      {secs.map((s, si) => (
        <section className="page" key={si}>
          <h1>開設見積書(内訳)</h1>
          <div style={{ textAlign: "right", fontSize: 10, lineHeight: 1.6 }}>{dateStr}<br />内訳管理No. {s.quote?.quote_number || ""}　（{si + 1}/{secs.length}）</div>
          <p style={{ fontSize: 14, fontWeight: 700, margin: "4px 0 16px" }}>{clinicName}　御中</p>
          <p style={{ textAlign: "center", fontSize: 15, fontWeight: 700, margin: "0 0 6px", textDecoration: "underline", textUnderlineOffset: 4 }}>{s.title}</p>
          <p style={{ textAlign: "center", fontSize: 16, fontWeight: 700, margin: "0 0 14px" }}><span style={{ textDecoration: "underline", textUnderlineOffset: 4 }}>内訳合計金額(税別)　　¥{yen(s.total)}</span></p>
          <table className="grid" style={{ width: "100%" }}>
            <thead><tr><th style={{ width: 22 }}></th><th>商品コード / メーカー // 商品名</th><th style={{ width: 66 }}>(定価)/単価</th><th style={{ width: 34 }}>数量</th><th style={{ width: 72 }}>金額</th><th style={{ width: 96 }}>摘要</th></tr></thead>
            <tbody>
              {s.items.map((it, i) => {
                const p = it.product_id ? prods.get(it.product_id) : undefined
                const amount = Number(it.quantity || 0) * Number(it.price || 0)
                return (
                  <tr key={it.id}>
                    <td className="r" style={{ verticalAlign: "middle" }}>{i + 1}</td>
                    <td><div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}><span>{p?.product_code || ""}</span><span>{p?.manufacturer || ""}</span></div><div>{it.product_name}</div></td>
                    <td className="r"><div style={{ fontSize: 10 }}>{Number(it.list_price || 0) > 0 ? yen(Number(it.list_price)) : "0"}</div><div>{yen(Number(it.price || 0))}</div></td>
                    <td className="r" style={{ verticalAlign: "middle" }}>{it.quantity}</td>
                    <td className="r" style={{ verticalAlign: "middle" }}>{yen(amount)}</td>
                    <td></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}
