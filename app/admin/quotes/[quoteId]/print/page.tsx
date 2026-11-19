"use client"

// 見積書（個別見積）の印刷。開設見積書と同じレイアウト。
//   ?unit=1  … 単価表（合計を出さず、品名と単価だけ）
//   ?total=0 … 合計金額（御見積金額・小計・消費税・合計）を出さない
// ページは、こちらで区切る（A4 1枚ずつ）。見出し（合算見積の元の見積）・小計は、ページの切れ目で、離れないようにする。
import { use, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import QuoteDoc, { type Quote, type Clinic, type Item, type Prod } from "@/app/components/QuoteDoc"
import { PRINT_CSS } from "@/lib/print-layout-css"
import { COMPANY_FALLBACK, getCompany, type Company } from "@/lib/company"

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

  return (
    <div className="oq">
      <style>{PRINT_CSS}</style>
      <div className="bar"><span>{quote.quote_number}</span><button onClick={() => window.print()}>印刷</button><span style={{ color: "#9ca3af" }}>（印刷画面の「余白」は「なし」、「背景のグラフィック」はオンにすると、きれいに出ます）</span></div>
      <QuoteDoc quote={quote} clinic={clinic} items={items} prods={prods} company={company} unit={unit} showTotal={showTotal} />
    </div>
  )
}
