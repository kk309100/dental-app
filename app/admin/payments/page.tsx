"use client"

// 入金処理専用ページ
// 発行済・一部入金の請求書を一覧し、素早く入金記録できる

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { fmtYen, fmtDate, type InvoiceStatus } from "@/lib/invoice"
import Link from "next/link"

type Invoice = {
  id: string
  clinic_id: string | null
  invoice_number: string
  issue_date: string
  due_date: string | null
  subtotal: number
  tax: number
  total: number
  status: InvoiceStatus
  paid_at: string | null
  paid_amount: number | null
  notes: string | null
}
type Clinic = { id: string; name: string; payment_method?: string | null }
type Payment = { id: string; invoice_id: string; paid_at: string; amount: number; method: string | null; note: string | null }

function isOverdue(iv: Invoice) {
  if (!iv.due_date) return false
  return iv.due_date.slice(0, 10) < new Date().toISOString().slice(0, 10)
}
function overdueDays(iv: Invoice) {
  if (!iv.due_date) return 0
  return Math.max(0, Math.floor((new Date().getTime() - new Date(iv.due_date).getTime()) / 86400000))
}

type ActiveRow = {
  invoiceId: string
  amount: string
  date: string
  method: string
  note: string
}

export default function PaymentsPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [activeRow, setActiveRow] = useState<ActiveRow | null>(null)
  const [clinicFilter, setClinicFilter] = useState("all")
  const [search, setSearch] = useState("")

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [iv, cl, py] = await Promise.all([
      supabase.from("invoices").select("*")
        .in("status", ["issued", "partial"])
        .order("due_date", { ascending: true, nullsFirst: false }),
      supabase.from("clinics").select("id,name,payment_method").order("name").limit(50000),
      supabase.from("invoice_payments").select("*").limit(50000),
    ])
    setInvoices((iv.data as Invoice[]) || [])
    setClinics(cl.data || [])
    setPayments((py.data as Payment[]) || [])
    setLoading(false)
  }

  const clinicById = useMemo(() => new Map(clinics.map(c => [c.id, c])), [clinics])
  const clinicName = (id: string | null) => id ? (clinicById.get(id)?.name || "(削除済み)") : "-"

  // 入金履歴を請求書IDでまとめる
  const paysByInvoice = useMemo(() => {
    const m = new Map<string, Payment[]>()
    payments.forEach(p => {
      if (!m.has(p.invoice_id)) m.set(p.invoice_id, [])
      m.get(p.invoice_id)!.push(p)
    })
    return m
  }, [payments])

  function paidTotal(iv: Invoice) {
    const pays = paysByInvoice.get(iv.id) || []
    return pays.reduce((s, p) => s + Number(p.amount), 0) || Number(iv.paid_amount || 0)
  }
  function remaining(iv: Invoice) {
    return Math.max(0, Number(iv.total) - paidTotal(iv))
  }

  const filtered = useMemo(() => {
    const k = search.toLowerCase()
    return invoices.filter(iv => {
      if (clinicFilter !== "all" && iv.clinic_id !== clinicFilter) return false
      if (k) {
        const t = `${iv.invoice_number} ${clinicName(iv.clinic_id)}`.toLowerCase()
        if (!t.includes(k)) return false
      }
      return true
    })
  }, [invoices, clinicFilter, search, clinics])

  // 延滞→一部入金→通常の順
  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const ao = isOverdue(a) ? 0 : a.status === "partial" ? 1 : 2
    const bo = isOverdue(b) ? 0 : b.status === "partial" ? 1 : 2
    if (ao !== bo) return ao - bo
    return (a.due_date || "").localeCompare(b.due_date || "")
  }), [filtered])

  function openRow(iv: Invoice) {
    const rem = remaining(iv)
    setActiveRow({
      invoiceId: iv.id,
      amount: String(rem),
      date: new Date().toISOString().slice(0, 10),
      method: "振込",
      note: "",
    })
  }

  async function savePayment() {
    if (!activeRow) return
    const iv = invoices.find(i => i.id === activeRow.invoiceId)
    if (!iv) return
    const amt = Number(activeRow.amount.replace(/[^\d]/g, ""))
    if (!amt || amt <= 0) { alert("入金額を入力してください"); return }
    setSaving(activeRow.invoiceId)

    const dt = new Date(activeRow.date + "T12:00:00").toISOString()
    const { error: peErr } = await supabase.from("invoice_payments").insert({
      invoice_id: iv.id,
      paid_at: dt,
      amount: amt,
      method: activeRow.method || "振込",
      note: activeRow.note || null,
    })

    const newTotal = paidTotal(iv) + amt
    const newStatus: InvoiceStatus = newTotal >= Number(iv.total) ? "paid" : "partial"
    if (!peErr) {
      await supabase.from("invoices").update({ status: newStatus, paid_at: dt, paid_amount: newTotal }).eq("id", iv.id)
    } else {
      // fallback
      await supabase.from("invoices").update({
        status: newTotal >= Number(iv.total) ? "paid" : iv.status,
        paid_at: dt,
        paid_amount: (Number(iv.paid_amount || 0) + amt),
      }).eq("id", iv.id)
    }

    setSaving(null)
    setActiveRow(null)
    fetchData()
  }

  if (loading) return <main style={page}><p>読み込み中…</p></main>

  const overdueCount = sorted.filter(isOverdue).length
  const totalRemaining = sorted.reduce((s, iv) => s + remaining(iv), 0)

  return (
    <main style={page}>
      {/* ヘッダー */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <Link href="/admin/invoices"><button style={btnGray}>← 請求書一覧</button></Link>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111", margin: 0 }}>入金処理</h1>
          <p style={{ fontSize: 12, color: "#9ca3af", margin: "1px 0 0" }}>
            未収 {sorted.length}件 / 合計 {fmtYen(totalRemaining)}
            {overdueCount > 0 && <span style={{ marginLeft: 8, color: "#dc2626", fontWeight: 700 }}>（延滞 {overdueCount}件）</span>}
          </p>
        </div>
      </div>

      {/* フィルタ */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="請求書番号・医院名で検索"
          style={inputStyle}
        />
        <select value={clinicFilter} onChange={e => setClinicFilter(e.target.value)} style={selectStyle}>
          <option value="all">すべての医院</option>
          {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* 一覧 */}
      {sorted.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: "#9ca3af" }}>
          <p style={{ fontSize: 18 }}>✓</p>
          <p>未収の請求書はありません</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sorted.map(iv => {
            const overdue = isOverdue(iv)
            const days = overdue ? overdueDays(iv) : 0
            const paid = paidTotal(iv)
            const rem = remaining(iv)
            const paysForIv = paysByInvoice.get(iv.id) || []
            const isActive = activeRow?.invoiceId === iv.id
            const borderColor = overdue ? "#dc2626" : iv.status === "partial" ? "#f59e0b" : "#3b82f6"
            return (
              <div key={iv.id} style={{
                background: "#fff",
                border: `1px solid ${isActive ? borderColor : "#e5e7eb"}`,
                borderLeft: `4px solid ${borderColor}`,
                borderRadius: 10,
                overflow: "hidden",
                boxShadow: isActive ? `0 0 0 2px ${borderColor}40` : "none",
              }}>
                {/* 行ヘッダー */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      {overdue && (
                        <span style={{ padding: "1px 7px", background: "#dc2626", color: "#fff", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
                          延滞 {days}日
                        </span>
                      )}
                      {iv.status === "partial" && !overdue && (
                        <span style={{ padding: "1px 7px", background: "#fef3c7", color: "#d97706", border: "1px solid #fcd34d", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
                          一部入金
                        </span>
                      )}
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{clinicName(iv.clinic_id)}</span>
                      <span style={{ fontFamily: "monospace", fontSize: 12, color: "#6b7280" }}>{iv.invoice_number}</span>
                    </div>
                    <div style={{ display: "flex", gap: 12, marginTop: 3, fontSize: 11, color: "#9ca3af", flexWrap: "wrap" }}>
                      <span>発行 {fmtDate(iv.issue_date)}</span>
                      {iv.due_date && (
                        <span style={{ color: overdue ? "#dc2626" : "#9ca3af", fontWeight: overdue ? 700 : 400 }}>
                          期限 {fmtDate(iv.due_date)}
                        </span>
                      )}
                      {paysForIv.length > 0 && (
                        <span style={{ color: "#10b981" }}>入金 {paysForIv.length}回</span>
                      )}
                    </div>
                  </div>

                  {/* 金額サマリ */}
                  <div style={{ display: "flex", gap: 16, alignItems: "center", flexShrink: 0 }}>
                    {paid > 0 && (
                      <div style={{ textAlign: "right" }}>
                        <p style={{ margin: 0, fontSize: 10, color: "#9ca3af" }}>入金済</p>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#10b981" }}>{fmtYen(paid)}</p>
                      </div>
                    )}
                    <div style={{ textAlign: "right" }}>
                      <p style={{ margin: 0, fontSize: 10, color: "#9ca3af" }}>残額</p>
                      <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: overdue ? "#dc2626" : "#111" }}>{fmtYen(rem)}</p>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {!isActive ? (
                        <button
                          onClick={() => openRow(iv)}
                          style={{ ...btnGreen, padding: "7px 14px", fontSize: 13 }}
                        >
                          入金記録
                        </button>
                      ) : (
                        <button
                          onClick={() => setActiveRow(null)}
                          style={{ ...btnGray, padding: "7px 10px", fontSize: 12 }}
                        >
                          ✕
                        </button>
                      )}
                      <Link href={`/admin/invoices/${iv.id}`}>
                        <button style={{ ...btnGray, padding: "7px 10px", fontSize: 12 }}>詳細</button>
                      </Link>
                    </div>
                  </div>
                </div>

                {/* インライン入金フォーム */}
                {isActive && activeRow && (
                  <div style={{ borderTop: `1px solid ${borderColor}40`, padding: "12px 14px", background: "#f8fffe" }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                      <div>
                        <label style={fLabel}>入金日</label>
                        <input type="date" value={activeRow.date}
                          onChange={e => setActiveRow({ ...activeRow, date: e.target.value })}
                          style={{ ...fInput, width: 140 }} />
                      </div>
                      <div>
                        <label style={fLabel}>入金金額</label>
                        <input type="number" value={activeRow.amount}
                          onChange={e => setActiveRow({ ...activeRow, amount: e.target.value })}
                          placeholder={String(rem)} style={{ ...fInput, width: 120 }} />
                      </div>
                      <div>
                        <label style={fLabel}>方法</label>
                        <select value={activeRow.method}
                          onChange={e => setActiveRow({ ...activeRow, method: e.target.value })}
                          style={{ ...fInput, width: 100 }}>
                          {["振込", "現金", "相殺", "値引", "手数料相殺", "その他"].map(m => <option key={m}>{m}</option>)}
                        </select>
                      </div>
                      <div style={{ flex: 1, minWidth: 120 }}>
                        <label style={fLabel}>備考</label>
                        <input value={activeRow.note}
                          onChange={e => setActiveRow({ ...activeRow, note: e.target.value })}
                          placeholder="例: 振込手数料差引き" style={{ ...fInput, width: "100%" }} />
                      </div>
                      <button
                        onClick={savePayment}
                        disabled={saving === iv.id}
                        style={{ ...btnGreen, padding: "8px 20px", fontSize: 13, fontWeight: 700, marginBottom: 8 }}
                      >
                        {saving === iv.id ? "保存中…" : "記録する"}
                      </button>
                    </div>

                    {/* 入金履歴 */}
                    {paysForIv.length > 0 && (
                      <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #e5e7eb" }}>
                        <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, color: "#555" }}>入金履歴</p>
                        {paysForIv.map(p => (
                          <div key={p.id} style={{ display: "flex", gap: 8, fontSize: 11, color: "#555", padding: "2px 0" }}>
                            <span>{new Date(p.paid_at).toLocaleDateString("ja-JP")}</span>
                            <span style={{ padding: "0 5px", background: "#eef2ff", color: "#3730a3", borderRadius: 99 }}>{p.method || "振込"}</span>
                            <span style={{ fontWeight: 600 }}>{fmtYen(p.amount)}</span>
                            {p.note && <span style={{ color: "#9ca3af" }}>{p.note}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}

const page: React.CSSProperties = { maxWidth: 900, margin: "0 auto", padding: 20 }
const btnGray: React.CSSProperties = { padding: "7px 14px", borderRadius: 7, border: "1px solid #ddd", background: "#f7f7f7", color: "#333", fontSize: 13, cursor: "pointer" }
const btnGreen: React.CSSProperties = { padding: "7px 14px", borderRadius: 7, border: "1px solid #86efac", background: "#f0fdf4", fontSize: 13, fontWeight: 700, cursor: "pointer", color: "#15803d" }
const inputStyle: React.CSSProperties = { flex: 1, minWidth: 180, padding: "7px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }
const selectStyle: React.CSSProperties = { padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, background: "#fff" }
const fLabel: React.CSSProperties = { fontSize: 11, color: "#6b7280", display: "block", marginBottom: 2 }
const fInput: React.CSSProperties = { padding: "7px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13, background: "#fff", boxSizing: "border-box" }
