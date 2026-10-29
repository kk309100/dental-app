"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase, fetchAllData } from "@/lib/supabase"
import { romajiAlt } from "@/lib/romaji"
import { calcBillingPeriod, calcDueDate, calcInvoiceTax, generateInvoiceNumber, fmtYen, fmtDate, ymd } from "@/lib/invoice"
import Link from "next/link"
import { useRouter } from "next/navigation"

type Clinic = { id: string; name: string; corporate_name?: string | null; closing_day?: string | null; clinic_code?: string | null }
type Order = {
  id: string
  clinic_id: string
  status: string
  created_at: string
  total_price: number
  delivery_number: string | null
  invoice_id: string | null
}

// 「納品済」「納品済み」両方を請求書発行対象として扱う（DB の表記ゆれを吸収）
const TARGET_STATUSES = ["納品済み", "納品済"]

const toKata = (t: string) => t.normalize("NFKC").toLowerCase().replace(/[ぁ-ん]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60)).replace(/\s+/g, " ").trim()
const clinicLabel = (c: Clinic) => (c.corporate_name ? `${c.corporate_name} ${c.name}` : c.name)

function ClinicSearchBox({ clinics, value, onChange }: { clinics: Clinic[]; value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const selected = clinics.find(c => c.id === value)
  const hits = useMemo(() => {
    const tokens = toKata(q).split(" ").filter(Boolean)
    if (tokens.length === 0) return clinics.slice(0, 30)
    return clinics.filter(c => {
      const key = toKata(`${c.corporate_name || ""} ${c.name} ${c.clinic_code || ""}`)
      return tokens.every(t => key.includes(t) || (romajiAlt(t) ? key.includes(toKata(romajiAlt(t) as string)) : false))
    }).slice(0, 30)
  }, [clinics, q])

  if (selected && !open) {
    return (
      <div style={{ ...input, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontWeight: 700 }}>{clinicLabel(selected)}<span style={{ fontWeight: 400, color: "#666" }}>（締日: {selected.closing_day || "月末"}）</span></span>
        <button type="button" onClick={() => { onChange(""); setQ(""); setOpen(true) }}
          style={{ padding: "2px 10px", fontSize: 12, border: "1px solid #ccc", borderRadius: 6, background: "#fff", cursor: "pointer" }}>変更</button>
      </div>
    )
  }
  return (
    <div style={{ position: "relative" }}>
      <input type="text" autoFocus={open} value={q} placeholder="医院名・かな・ローマ字・医院コードで検索"
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        style={input} />
      {open && (
        <div style={{ position: "absolute", zIndex: 20, left: 0, right: 0, top: "100%", marginTop: 2, maxHeight: 320, overflowY: "auto", background: "#fff", border: "1px solid #ccc", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.12)" }}>
          {hits.length === 0 ? (
            <div style={{ padding: "10px 12px", color: "#999", fontSize: 13 }}>該当する医院がありません</div>
          ) : hits.map(c => (
            <button key={c.id} type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(c.id); setOpen(false); setQ("") }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", fontSize: 13, background: "#fff", border: "none", borderBottom: "1px solid #f0f0f0", cursor: "pointer" }}>
              {clinicLabel(c)}<span style={{ color: "#888", marginLeft: 6 }}>{c.clinic_code ? `[${c.clinic_code}] ` : ""}締日: {c.closing_day || "月末"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function CreateInvoicePage() {
  const router = useRouter()
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // 入力
  const [clinicId, setClinicId] = useState("")
  const [issueDate, setIssueDate] = useState(ymd(new Date()))
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState("")
  const [error, setError] = useState("")

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [c, o] = await Promise.all([
      supabase.from("clinics").select("id,name,corporate_name,closing_day,clinic_code").order("name").limit(50000),
      fetchAllData("orders", "id,clinic_id,status,created_at,total_price,delivery_number,invoice_id"),
    ])
    setClinics(c.data || [])
    setOrders((o.data as Order[]) || [])
    setLoading(false)
  }

  const clinic = useMemo(() => clinics.find((c) => c.id === clinicId), [clinicId, clinics])

  // 医院選択時に締日から期間を自動セット
  useEffect(() => {
    if (!clinic) return
    const p = calcBillingPeriod(clinic.closing_day || "月末", new Date(issueDate))
    setFrom(p.from)
    setTo(p.to)
  }, [clinic, issueDate])

  // 期間内の未請求の納品済み注文
  const candidateOrders = useMemo(() => {
    if (!clinicId || !from || !to) return []
    return orders
      .filter((o) => o.clinic_id === clinicId)
      .filter((o) => TARGET_STATUSES.includes(o.status))
      .filter((o) => !o.invoice_id)
      .filter((o) => {
        const d = (o.created_at || "").slice(0, 10)
        return d >= from && d <= to
      })
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
  }, [orders, clinicId, from, to])

  // 期間が変わったら全選択をリセット（候補が変わるため）
  useEffect(() => {
    setSelected(new Set(candidateOrders.map((o) => o.id)))
  }, [candidateOrders])

  // 税計算規約:
  //   orders.total_price は **税抜** で保存される（orders/new/page.tsx と order/page.tsx の total = price×qty 計算と一致）
  //   ここで calcTax で消費税を加算 → total = subtotal + tax （税抜 + 10%）
  //   ★ もし将来 products.price を税込に変える場合、この箇所と invoices/bulk/page.tsx と
  //     delivery/page.tsx の同じ計算を「subtotal = total_price / 1.1」「tax = total_price - subtotal」に変更すること
  const subtotal = useMemo(
    () => candidateOrders.filter((o) => selected.has(o.id)).reduce((s, o) => s + (o.total_price || 0), 0),
    [candidateOrders, selected]
  )
  // 消費税: 設定に合わせて、請求書の合計に1回 / 納品書ごとに出して合計
  const tax = calcInvoiceTax(candidateOrders.filter((o) => selected.has(o.id)).map((o) => o.total_price || 0))
  const total = subtotal + tax
  const dueDate = calcDueDate(new Date(issueDate))

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function issueInvoice() {
    setError("")
    if (!clinicId) { setError("医院を選択してください"); return }
    if (selected.size === 0) { setError("対象注文を1件以上選択してください"); return }

    setSubmitting(true)
    try {
      // 1) 採番
      const invoice_number = await generateInvoiceNumber(new Date(issueDate))
      // 2) invoice 作成
      const { data: inv, error: e1 } = await supabase
        .from("invoices")
        .insert({
          clinic_id: clinicId,
          invoice_number,
          issue_date: issueDate,
          due_date: dueDate,
          subtotal,
          tax,
          total,
          status: "issued",
          notes: notes || null,
        })
        .select()
        .single()
      if (e1 || !inv) throw new Error(e1?.message || "請求書の作成に失敗しました")

      // 3) 対象注文に invoice_id を紐付け
      const orderIds = Array.from(selected)
      const { error: e2 } = await supabase
        .from("orders")
        .update({ invoice_id: inv.id })
        .in("id", orderIds)
      if (e2) throw new Error("注文紐付けに失敗: " + e2.message)

      // 4) 詳細ページへ遷移
      router.push(`/admin/invoices/${inv.id}`)
    } catch (e) {
      setError((e as Error).message)
      setSubmitting(false)
    }
  }

  if (loading) return <main style={page}><p>読み込み中…</p></main>

  return (
    <main style={page}>
      <Link href="/admin/invoices"><button style={back}>← 請求書一覧</button></Link>
      <h1 style={{ fontSize: 24, margin: "0 0 16px" }}>請求書を発行</h1>

      {error && <div style={errBox}>{error}</div>}

      {/* ステップ1: 医院選択 */}
      <div style={section}>
        <p style={sectionLabel}>① 医院</p>
        <ClinicSearchBox clinics={clinics} value={clinicId} onChange={setClinicId} />
      </div>

      {/* ステップ2: 期間 */}
      <div style={section}>
        <p style={sectionLabel}>② 集計期間（医院の締日から自動セット、変更可）</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <div>
            <label style={fieldLabel}>発行日</label>
            <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} style={input} />
          </div>
          <div>
            <label style={fieldLabel}>期間: 開始</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={input} />
          </div>
          <div>
            <label style={fieldLabel}>期間: 終了</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={input} />
          </div>
        </div>
        <p style={{ fontSize: 11, color: "#999", margin: "6px 0 0" }}>支払期限: {fmtDate(dueDate)}（翌月末）</p>
      </div>

      {/* ステップ3: 対象注文 */}
      <div style={section}>
        <p style={sectionLabel}>③ 対象注文（期間内の納品済み・未請求）</p>
        {!clinicId ? (
          <p style={{ color: "#999", fontSize: 13 }}>先に医院を選択してください</p>
        ) : candidateOrders.length === 0 ? (
          <p style={{ color: "#999", fontSize: 13 }}>該当する注文がありません</p>
        ) : (
          <>
            <div style={{ marginBottom: 6, display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => setSelected(new Set(candidateOrders.map((o) => o.id)))} style={btnGray}>全選択</button>
              <button onClick={() => setSelected(new Set())} style={btnGray}>全解除</button>
              <span style={{ fontSize: 11, color: "#777" }}>{selected.size} / {candidateOrders.length} 件選択中</span>
            </div>
            <div style={ordersWrap}>
              {candidateOrders.map((o) => (
                <label key={o.id} style={{ ...orderRow, background: selected.has(o.id) ? "#f0f9ff" : "#fff" }}>
                  <input
                    type="checkbox"
                    checked={selected.has(o.id)}
                    onChange={() => toggle(o.id)}
                    style={{ marginRight: 8 }}
                  />
                  <span style={{ flex: 1, fontSize: 13 }}>
                    {o.delivery_number || o.id.slice(0, 8)} — {fmtDate(o.created_at)}
                  </span>
                  <span style={{ fontWeight: 700 }}>{fmtYen(o.total_price)}</span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ステップ4: 備考 */}
      <div style={section}>
        <p style={sectionLabel}>④ 備考（請求書に印字）</p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="例: いつもありがとうございます。"
          style={{ ...input, minHeight: 60, resize: "vertical", fontFamily: "inherit" }}
        />
      </div>

      {/* 集計 + 発行 */}
      <div style={summary}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span>税抜小計</span><span>{fmtYen(subtotal)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 13 }}>
          <span>消費税（10%）</span><span>{fmtYen(tax)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #eee", paddingTop: 8, marginTop: 8 }}>
          <strong>合計</strong><strong style={{ fontSize: 20 }}>{fmtYen(total)}</strong>
        </div>
        <button
          onClick={issueInvoice}
          disabled={submitting || !clinicId || selected.size === 0}
          style={{ ...btnDark, width: "100%", marginTop: 14, padding: 14, fontSize: 15, opacity: submitting || !clinicId || selected.size === 0 ? 0.5 : 1 }}
        >
          {submitting ? "発行中…" : `請求書を発行する（${selected.size}件・${fmtYen(total)}）`}
        </button>
      </div>
    </main>
  )
}

const page: React.CSSProperties = { maxWidth: 720, margin: "0 auto", padding: 20 }
const back: React.CSSProperties = { padding: "6px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", marginBottom: 16, cursor: "pointer" }
const section: React.CSSProperties = { background: "#fff", border: "1px solid #eee", borderRadius: 10, padding: 16, marginBottom: 12 }
const sectionLabel: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "#444", margin: "0 0 8px" }
const input: React.CSSProperties = { width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box", background: "#fff" }
const fieldLabel: React.CSSProperties = { display: "block", fontSize: 11, color: "#777", marginBottom: 4, fontWeight: 600 }
const ordersWrap: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, maxHeight: 320, overflowY: "auto", border: "1px solid #eee", borderRadius: 6, padding: 4 }
const orderRow: React.CSSProperties = { display: "flex", alignItems: "center", padding: "8px 10px", borderRadius: 6, cursor: "pointer", border: "1px solid transparent" }
const btnGray: React.CSSProperties = { padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", background: "#f7f7f7", fontSize: 11, cursor: "pointer" }
const btnDark: React.CSSProperties = { padding: "8px 16px", borderRadius: 8, border: "none", background: "#111", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }
const summary: React.CSSProperties = { background: "#fff", border: "1px solid #eee", borderRadius: 10, padding: 16, marginBottom: 30 }
const errBox: React.CSSProperties = { padding: 10, background: "#fff5f5", border: "1px solid #fcc", borderRadius: 6, color: "#dc2626", fontSize: 12, marginBottom: 12 }
