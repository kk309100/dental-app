"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { fmtYen, fmtDate } from "@/lib/invoice"
import { QUOTE_STATUSES, type QuoteStatus } from "@/lib/quote"
import Link from "next/link"

type Quote = {
  id: string
  clinic_id: string | null
  quote_number: string
  issue_date: string
  expiry_date: string | null
  subtotal: number
  tax: number
  total: number
  status: QuoteStatus
  notes: string | null
  invoice_id: string | null
  created_at: string
}
type Clinic = { id: string; name: string }

export default function QuotesPage() {
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | QuoteStatus>("all")

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [q, c] = await Promise.all([
      supabase.from("quotes").select("*").order("issue_date", { ascending: false }),
      supabase.from("clinics").select("id,name").order("name"),
    ])
    setQuotes((q.data as Quote[]) || [])
    setClinics(c.data || [])
    setLoading(false)
  }

  const clinicName = (id: string | null) => id ? (clinics.find((c) => c.id === id)?.name || "(削除済み)") : "-"

  const filtered = useMemo(() => {
    const k = search.toLowerCase().normalize("NFKC")
    return quotes.filter((q) => {
      if (statusFilter !== "all" && q.status !== statusFilter) return false
      if (!k) return true
      const target = `${q.quote_number} ${clinicName(q.clinic_id)}`.toLowerCase().normalize("NFKC")
      return target.includes(k)
    })
  }, [quotes, search, statusFilter])

  const totalDraft = filtered.filter((q) => q.status === "draft" || q.status === "sent").reduce((s, q) => s + q.total, 0)
  const totalConverted = filtered.filter((q) => q.status === "converted").reduce((s, q) => s + q.total, 0)

  if (loading) return <main style={page}><p>読み込み中…</p></main>

  return (
    <main style={page}>
      {/* 注文 / 見積 サブタブ */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, borderBottom: "1px solid #e5e7eb", marginBottom: 16 }}>
        <Link href="/admin/orders" style={{ padding: "8px 16px", fontSize: 13, color: "#6b7280", textDecoration: "none" }}>
          🛒 注文
        </Link>
        <div style={{ padding: "8px 16px", fontSize: 13, fontWeight: 700, color: "#111", borderBottom: "2px solid #6366f1", marginBottom: -1 }}>
          📋 見積
        </div>
      </div>

      <div style={header}>
        <div>
          <h1 style={{ fontSize: 26, margin: 0 }}>見積書管理</h1>
          <p style={{ fontSize: 12, color: "#999", margin: "4px 0 0" }}>{quotes.length}件</p>
        </div>
        <Link href="/admin/quotes/create"><button style={btnDark}>＋ 見積書を作成</button></Link>
      </div>

      <div style={kpiGrid}>
        <Kpi label="下書き・送付済" val={fmtYen(totalDraft)} sub={`${filtered.filter((q) => q.status === "draft" || q.status === "sent").length}件`} />
        <Kpi label="売上化済" val={fmtYen(totalConverted)} sub={`${filtered.filter((q) => q.status === "converted").length}件`} />
        <Kpi label="合計" val={`${filtered.length}件`} sub="" />
      </div>

      <div style={filters}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="見積書番号・医院名で検索" style={searchInput} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | QuoteStatus)} style={select}>
          <option value="all">すべての状態</option>
          {Object.entries(QUOTE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div style={listWrap}>
        {filtered.length === 0 ? (
          <p style={{ padding: 32, textAlign: "center", color: "#999" }}>見積書がありません</p>
        ) : (
          filtered.map((q) => (
            <Link key={q.id} href={`/admin/quotes/${q.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div style={card}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={cardHead}>
                    <span style={cardNum}>{q.quote_number}</span>
                    <StatusBadge status={q.status} />
                  </div>
                  <p style={cardClinic}>{clinicName(q.clinic_id)}</p>
                  <div style={cardMeta}>
                    <span>📅 {fmtDate(q.issue_date)}</span>
                    {q.expiry_date && <span>⏰ 期限 {fmtDate(q.expiry_date)}</span>}
                    {q.invoice_id && <span style={{ color: "#8b5cf6" }}>→ 請求書済</span>}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={cardAmount}>{fmtYen(q.total)}</p>
                  <p style={cardSubtotal}>税抜 {fmtYen(q.subtotal)}</p>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </main>
  )
}

function Kpi({ label, val, sub }: { label: string; val: string; sub: string }) {
  return (
    <div style={kpiCard}>
      <p style={{ fontSize: 11, color: "#777", margin: 0 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, margin: "4px 0" }}>{val}</p>
      {sub && <p style={{ fontSize: 10, color: "#999", margin: 0 }}>{sub}</p>}
    </div>
  )
}

function StatusBadge({ status }: { status: QuoteStatus }) {
  const s = QUOTE_STATUSES[status]
  return (
    <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 99, background: s.color + "22", color: s.color, fontSize: 11, fontWeight: 700 }}>
      {s.label}
    </span>
  )
}

const page: React.CSSProperties = { maxWidth: 960, margin: "0 auto", padding: 20 }
const back: React.CSSProperties = { padding: "6px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", marginBottom: 16, cursor: "pointer" }
const header: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 12 }
const btnDark: React.CSSProperties = { padding: "8px 16px", borderRadius: 8, border: "none", background: "#111", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }
const kpiGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 12 }
const kpiCard: React.CSSProperties = { background: "#fff", border: "1px solid #eee", borderRadius: 10, padding: 14 }
const filters: React.CSSProperties = { display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }
const searchInput: React.CSSProperties = { flex: 1, minWidth: 180, padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }
const select: React.CSSProperties = { padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, background: "#fff" }
const listWrap: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 8 }
const card: React.CSSProperties = { background: "#fff", border: "1px solid #eee", borderRadius: 10, padding: 14, display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer" }
const cardHead: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }
const cardNum: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: "#111" }
const cardClinic: React.CSSProperties = { fontSize: 13, color: "#444", margin: "2px 0", fontWeight: 600 }
const cardMeta: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11, color: "#777", marginTop: 4 }
const cardAmount: React.CSSProperties = { fontSize: 18, fontWeight: 800, color: "#111", margin: 0 }
const cardSubtotal: React.CSSProperties = { fontSize: 10, color: "#999", margin: "2px 0 0" }
