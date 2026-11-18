"use client"

// 開設見積書の作成・編集。見積番号を入力すると、その個別見積が「内訳」として組み込まれる。
import { use, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import ClinicSelect, { type ClinicOption } from "@/app/components/ClinicSelect"
import { calcTax, ensureTaxRounding, fmtYen } from "@/lib/invoice"
import { logOp } from "@/lib/op-log"
import { findQuotes, loadQuoteItems, nextManageNo, sectionStats, type OpeningQuote, type QuoteItem, type QuoteLite, type SectionRow } from "@/lib/opening-quote"

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const inp = "w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white"

export default function OpeningQuoteEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const isNew = id === "new"
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [oq, setOq] = useState<OpeningQuote | null>(null)
  const [clinics, setClinics] = useState<ClinicOption[]>([])
  const [clinicId, setClinicId] = useState("")
  const [title, setTitle] = useState("")
  const [issueDate, setIssueDate] = useState(ymd(new Date()))
  const [deliveryDate, setDeliveryDate] = useState("")
  const [deliveryPlace, setDeliveryPlace] = useState("")
  const [inspection, setInspection] = useState("")
  const [payment, setPayment] = useState("")
  const [expiry, setExpiry] = useState("")
  const [discount, setDiscount] = useState("0")
  const [note, setNote] = useState("")
  const [sections, setSections] = useState<SectionRow[]>([])
  const [quotes, setQuotes] = useState<Map<string, QuoteLite>>(new Map())
  const [items, setItems] = useState<QuoteItem[]>([])
  const [numInput, setNumInput] = useState("")
  const [cands, setCands] = useState<QuoteLite[] | null>(null)
  const [msg, setMsg] = useState("")

  useEffect(() => { (async () => {
    await ensureTaxRounding()
    const { data: cl } = await supabase.from("clinics").select("id,name,corporate_name,clinic_code").order("name")
    setClinics((cl as ClinicOption[]) || [])
    if (!isNew) {
      const { data: o, error } = await supabase.from("opening_quotes").select("*").eq("id", id).single()
      if (error || !o) { setMissing(true); setLoading(false); return }
      const q = o as OpeningQuote
      setOq(q); setClinicId(q.clinic_id || ""); setTitle(q.title || ""); setIssueDate(q.issue_date || ymd(new Date()))
      setDeliveryDate(q.delivery_date || ""); setDeliveryPlace(q.delivery_place || ""); setInspection(q.inspection_period || ""); setPayment(q.payment_terms || ""); setExpiry(q.expiry_text || "")
      setDiscount(String(q.discount || 0)); setNote(q.note || "")
      const { data: ss } = await supabase.from("opening_quote_sections").select("quote_id,title_override,sort_order").eq("opening_quote_id", id).order("sort_order")
      const rows = ((ss as { quote_id: string; title_override: string | null }[]) || []).map(s => ({ quote_id: s.quote_id, title_override: s.title_override || "" }))
      setSections(rows)
      await loadMore(rows.map(r => r.quote_id))
    } else {
      const probe = await supabase.from("opening_quotes").select("id").limit(1)
      if (probe.error) setMissing(true)
    }
    setLoading(false)
  })() }, [id, isNew])

  async function loadMore(ids: string[]) {
    const need = ids.filter(x => !quotes.has(x))
    if (need.length === 0) return
    const { data: qs } = await supabase.from("quotes").select("id,quote_number,title,subtotal,total,clinic_id").in("id", need)
    setQuotes(prev => { const m = new Map(prev); for (const q of (qs as QuoteLite[]) || []) m.set(q.id, q); return m })
    const its = await loadQuoteItems(need)
    setItems(prev => [...prev.filter(p => !need.includes(p.quote_id)), ...its])
  }

  async function searchAdd() {
    setMsg("")
    const r = await findQuotes(numInput)
    if (r.length === 0) { setMsg("その見積番号は、見つかりません"); setCands(null); return }
    if (r.length === 1) { await addSection(r[0]); return }
    setCands(r)
  }
  async function addSection(q: QuoteLite) {
    if (sections.some(s => s.quote_id === q.id) && !confirm(`${q.quote_number} は、すでに内訳に入っています。もう一度、入れますか？`)) return
    setSections(prev => [...prev, { quote_id: q.id, title_override: "" }])
    setQuotes(prev => new Map(prev).set(q.id, q))
    await loadMore([q.id])
    setNumInput(""); setCands(null); setMsg(`${q.quote_number} を、内訳に入れました`)
  }
  const move = (i: number, d: number) => setSections(prev => { const a = [...prev]; const j = i + d; if (j < 0 || j >= a.length) return prev; [a[i], a[j]] = [a[j], a[i]]; return a })

  const stats = useMemo(() => sections.map(s => sectionStats(items.filter(it => it.quote_id === s.quote_id))), [sections, items])
  const subtotal = stats.reduce((n, s) => n + s.total, 0)
  const disc = Math.max(0, Number(discount) || 0)
  const tax = calcTax(Math.max(0, subtotal - disc))
  const total = Math.max(0, subtotal - disc) + tax

  async function save(): Promise<string | null> {
    if (!clinicId) { alert("医院を選んでください"); return null }
    if (sections.length === 0) { alert("内訳が1つもありません。見積番号を入れて、追加してください"); return null }
    setSaving(true)
    try {
      const body = {
        clinic_id: clinicId, title: title.trim() || null, issue_date: issueDate || null, delivery_date: deliveryDate || null, delivery_place: deliveryPlace || null,
        inspection_period: inspection || null, payment_terms: payment || null, expiry_text: expiry || null, discount: disc, note: note || null,
        subtotal, tax, total, section_count: sections.length,
      }
      let oqId = oq?.id || ""
      if (!oq) {
        const manage_no = await nextManageNo()
        const { data, error } = await supabase.from("opening_quotes").insert({ ...body, manage_no }).select().single()
        if (error || !data) { alert("登録できませんでした: " + (error?.message || "")); return null }
        oqId = (data as OpeningQuote).id; setOq(data as OpeningQuote)
      } else {
        const { error } = await supabase.from("opening_quotes").update(body).eq("id", oq.id)
        if (error) { alert("登録できませんでした: " + error.message); return null }
      }
      await supabase.from("opening_quote_sections").delete().eq("opening_quote_id", oqId)
      const { error: se } = await supabase.from("opening_quote_sections").insert(sections.map((s, i) => ({ opening_quote_id: oqId, quote_id: s.quote_id, sort_order: i, title_override: s.title_override.trim() || null })))
      if (se) { alert("内訳を登録できませんでした: " + se.message); return null }
      await logOp(oq ? "開設見積を更新" : "開設見積を登録", { entity: "opening_quote", id: oqId, detail: { sections: sections.length, total } })
      return oqId
    } finally { setSaving(false) }
  }

  async function onSave() {
    const r = await save()
    if (!r) return
    if (isNew) router.replace(`/admin/opening-quotes/${r}`)
    setMsg("登録しました")
  }
  async function onSavePrint() {
    const r = await save()
    if (r) window.open(`/admin/opening-quotes/${r}/print`, "_blank")
  }

  // 注文にする: すべての内訳の明細を、1つの注文にまとめて作る（受注処理は、注文管理で行う）
  async function toOrder() {
    const oqId = await save()
    if (!oqId) return
    if (oq?.order_id && !confirm("この開設見積は、すでに注文にしています。もう一度、注文を作りますか？")) return
    const rows = sections.flatMap(s => items.filter(it => it.quote_id === s.quote_id).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)))
    if (rows.length === 0) { alert("明細がありません"); return }
    const clinicName = clinics.find(c => c.id === clinicId)?.name || ""
    if (!confirm(`${clinicName} の注文を作ります。\n\n・明細 ${rows.length}行（内訳 ${sections.length}つぶん）\n・金額 ${fmtYen(subtotal)}（税別・値引きは、注文には入れません）\n\nよろしいですか？`)) return
    setSaving(true)
    try {
      const now = new Date(), stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`
      const { data: today } = await supabase.from("orders").select("id").gte("created_at", `${ymd(now)}T00:00:00`).lte("created_at", `${ymd(now)}T23:59:59`)
      const deliveryNumber = `DN-${stamp}-${String(((today || []).length) + 1).padStart(4, "0")}-${Math.floor(Math.random() * 900) + 100}`
      const orderNote = `開設見積 管理No.${oq?.manage_no || ""}`
      const base = { clinic_id: clinicId, status: "注文受付", total_price: subtotal, delivery_number: deliveryNumber }
      let { data: order, error } = await supabase.from("orders").insert([{ ...base, note: orderNote, source: "admin" }]).select().single()
      if (error || !order) ({ data: order, error } = await supabase.from("orders").insert([base]).select().single())
      if (error || !order) { alert("注文を作れませんでした: " + (error?.message || "")); return }
      const { error: ie } = await supabase.from("order_items").insert(rows.map(r => ({ order_id: (order as { id: string }).id, product_id: r.product_id, product_name: r.product_name, quantity: Number(r.quantity), price: Number(r.price) })))
      if (ie) { alert("明細を入れられませんでした: " + ie.message); return }
      await supabase.from("opening_quotes").update({ status: "ordered", order_id: (order as { id: string }).id }).eq("id", oqId)
      await logOp("開設見積を注文にした", { entity: "opening_quote", id: oqId, detail: { order: (order as { id: string }).id.slice(0, 8), delivery_number: deliveryNumber, lines: rows.length } })
      alert(`注文を作りました（${deliveryNumber}）。\n注文管理で、受注処理を進めてください。`)
      router.push("/admin/orders")
    } finally { setSaving(false) }
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>
  if (missing) return <p className="text-red-600 text-center py-12">開設見積の表が、まだ作られていません（SQLの実行が必要です）。</p>

  return (
    <div className="max-w-5xl mx-auto space-y-3 pb-24">
      <div className="flex items-center flex-wrap gap-2">
        <Link href="/admin/opening-quotes" className="px-3 py-1.5 border border-gray-200 rounded text-sm bg-white hover:bg-gray-50">← 開設見積一覧</Link>
        <h1 className="font-bold text-gray-900" style={{ fontSize: 20 }}>開設見積書</h1>
        <span className="text-sm text-gray-500">管理番号 {oq ? oq.manage_no : "（登録時に決まります）"}</span>
        {oq?.status === "ordered" && <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">注文にしました</span>}
      </div>

      <div className="grid md:grid-cols-2 gap-3 bg-white border border-gray-200 rounded-lg p-3">
        <label className="text-xs text-gray-600">表題<input value={title} onChange={e => setTitle(e.target.value)} className={inp} placeholder="例）BF中日ビル歯科・矯正歯科 材料お見積り" /></label>
        <label className="text-xs text-gray-600">作成日付<input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className={inp} /></label>
        <div className="text-xs text-gray-600">得意先（医院）<div className="mt-0.5"><ClinicSelect clinics={clinics} value={clinicId} onChange={setClinicId} style={{ width: "100%" }} /></div></div>
        <label className="text-xs text-gray-600">本見積書 有効期限<input value={expiry} onChange={e => setExpiry(e.target.value)} className={inp} placeholder="例）2026年8月31日" /></label>
        <label className="text-xs text-gray-600">納期<input value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} className={inp} /></label>
        <label className="text-xs text-gray-600">納入場所<input value={deliveryPlace} onChange={e => setDeliveryPlace(e.target.value)} className={inp} /></label>
        <label className="text-xs text-gray-600">検収期間<input value={inspection} onChange={e => setInspection(e.target.value)} className={inp} /></label>
        <label className="text-xs text-gray-600">支払条件<input value={payment} onChange={e => setPayment(e.target.value)} className={inp} /></label>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <b className="text-sm">内訳（個別見積）を追加</b>
          <input value={numInput} onChange={e => setNumInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); searchAdd() } }}
            placeholder="見積番号を入力（例: QUO-202611-006 / 一部でも可）" className="flex-1 min-w-[240px] px-2 py-1.5 border border-gray-300 rounded text-sm" />
          <button onClick={searchAdd} className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white">追加</button>
          <Link href="/admin/quotes" target="_blank" className="text-xs text-gray-500 underline">見積一覧を開く</Link>
        </div>
        {msg && <p className="text-xs text-emerald-700">{msg}</p>}
        {cands && (
          <div className="border border-amber-200 bg-amber-50 rounded p-2 text-sm">
            <p className="text-xs text-amber-800 mb-1">候補が複数あります。選んでください。</p>
            {cands.map(c => <button key={c.id} onClick={() => addSection(c)} className="block w-full text-left px-2 py-1 hover:bg-amber-100 rounded">{c.quote_number}　{c.title || "(表題なし)"}　{fmtYen(Number(c.subtotal || 0))}</button>)}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-xs text-gray-600">
              <th className="px-1 py-1 w-14">順</th><th className="px-2 py-1 text-left whitespace-nowrap">内訳管理No.</th><th className="px-2 py-1 text-left">内訳表題</th>
              <th className="px-2 py-1 text-right whitespace-nowrap">(定価)明細合計</th><th className="px-2 py-1 text-right whitespace-nowrap">(見積)明細合計</th><th className="px-2 py-1 text-right">利益</th><th className="px-2 py-1 text-right">利益率</th><th className="px-1 py-1"></th>
            </tr></thead>
            <tbody>
              {sections.length === 0 && <tr><td colSpan={8} className="text-center text-gray-400 py-6">見積番号を入れて「追加」を押すと、ここに内訳が並びます</td></tr>}
              {sections.map((s, i) => {
                const q = quotes.get(s.quote_id), st = stats[i]
                return (
                  <tr key={s.quote_id + i} className="border-t border-gray-100">
                    <td className="px-1 py-1 text-center whitespace-nowrap"><button onClick={() => move(i, -1)} className="px-1 text-gray-500">▲</button><button onClick={() => move(i, 1)} className="px-1 text-gray-500">▼</button></td>
                    <td className="px-2 py-1 font-mono text-xs whitespace-nowrap">{q ? <Link href={`/admin/quotes/${q.id}`} target="_blank" className="text-blue-700 underline">{q.quote_number}</Link> : "(見積が見つかりません)"}</td>
                    <td className="px-2 py-1"><input value={s.title_override} onChange={e => setSections(prev => prev.map((x, j) => j === i ? { ...x, title_override: e.target.value } : x))} placeholder={q?.title || "(表題なし)"} className="w-full px-2 py-1 border border-gray-200 rounded text-sm" /></td>
                    <td className="px-2 py-1 text-right tabular-nums text-gray-500">{fmtYen(st.list)}</td>
                    <td className="px-2 py-1 text-right tabular-nums font-bold">{fmtYen(st.total)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-gray-600">{fmtYen(st.profit)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-gray-600">{st.rate == null ? "-" : `${st.rate}%`}</td>
                    <td className="px-1 py-1"><button onClick={() => setSections(prev => prev.filter((_, j) => j !== i))} className="text-xs px-2 py-0.5 border border-gray-300 rounded text-red-600 bg-white">削除</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid md:grid-cols-[1fr_280px] gap-3">
        <label className="text-xs text-gray-600 bg-white border border-gray-200 rounded-lg p-3">備考（印刷は、全角35字×4行まで）
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={4} className={inp + " mt-1"} /></label>
        <div className="bg-white border border-gray-200 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between"><span>(見積)明細合計</span><b className="tabular-nums">{fmtYen(subtotal)}</b></div>
          <div className="flex justify-between items-center"><span>値引</span><input value={discount} onChange={e => setDiscount(e.target.value)} inputMode="numeric" className="w-28 px-2 py-1 border border-gray-300 rounded text-right text-sm" /></div>
          <div className="flex justify-between"><span>消費税</span><span className="tabular-nums">{fmtYen(tax)}</span></div>
          <div className="flex justify-between border-t pt-1"><span className="font-bold">合計</span><b className="tabular-nums text-lg">{fmtYen(total)}</b></div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2 flex gap-2 justify-end flex-wrap" style={{ zIndex: 30 }}>
        <Link href="/admin/opening-quotes" className="px-4 py-2 text-sm rounded border border-gray-300 bg-white">中止</Link>
        {oq && <button onClick={toOrder} disabled={saving} className="px-4 py-2 text-sm rounded bg-emerald-600 text-white disabled:opacity-50">注文にする</button>}
        <button onClick={onSavePrint} disabled={saving} className="px-4 py-2 text-sm rounded bg-gray-800 text-white disabled:opacity-50">登録して印刷</button>
        <button onClick={onSave} disabled={saving} className="px-5 py-2 text-sm font-bold rounded bg-blue-600 text-white disabled:opacity-50">{saving ? "登録中…" : "登録"}</button>
      </div>
    </div>
  )
}
