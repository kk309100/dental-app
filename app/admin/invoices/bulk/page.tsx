"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { calcBillingPeriod, calcDueDate, calcTax, generateInvoiceNumber, fmtYen, fmtDate, ymd } from "@/lib/invoice"
import Link from "next/link"
import { useRouter } from "next/navigation"

type Clinic = { id: string; name: string; corporate_name?: string | null; closing_day?: string | null }
type Order = {
  id: string; clinic_id: string; status: string; created_at: string
  total_price: number; delivery_number: string | null; invoice_id: string | null
}

const TARGET_STATUSES = ["納品済み"]
const CLOSING_DAYS = ["月末", "20日", "15日", "10日", "5日", "その他"]

type Row = {
  clinic: Clinic
  orders: Order[]
  subtotal: number
  tax: number
  total: number
  selected: boolean
}

export default function BulkInvoicePage() {
  const router = useRouter()
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [issueDate, setIssueDate] = useState(ymd(new Date()))
  const [closingFilter, setClosingFilter] = useState<string>("all")
  const [selectedClinics, setSelectedClinics] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState<{ clinicName: string; ok: boolean; message: string }[]>([])

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [c, o] = await Promise.all([
      supabase.from("clinics").select("id,name,corporate_name,closing_day").order("name"),
      supabase.from("orders").select("id,clinic_id,status,created_at,total_price,delivery_number,invoice_id"),
    ])
    setClinics(c.data || [])
    setOrders((o.data as Order[]) || [])
    setLoading(false)
  }

  // 各医院の締日に基づく期間 → その期間内の未請求注文を集計
  const rows: Row[] = useMemo(() => {
    return clinics
      .filter((c) => closingFilter === "all" || (c.closing_day || "月末") === closingFilter)
      .map((c) => {
        const period = calcBillingPeriod(c.closing_day || "月末", new Date(issueDate))
        const ords = orders
          .filter((o) => o.clinic_id === c.id)
          .filter((o) => TARGET_STATUSES.includes(o.status))
          .filter((o) => !o.invoice_id)
          .filter((o) => {
            const d = (o.created_at || "").slice(0, 10)
            return d >= period.from && d <= period.to
          })
        const subtotal = ords.reduce((s, o) => s + (o.total_price || 0), 0)
        const tax = calcTax(subtotal)
        return { clinic: c, orders: ords, subtotal, tax, total: subtotal + tax, selected: selectedClinics.has(c.id) }
      })
  }, [clinics, orders, issueDate, closingFilter, selectedClinics])

  // 対象あり医院だけデフォ選択（初回 / 期間変化時）
  useEffect(() => {
    setSelectedClinics(new Set(rows.filter((r) => r.orders.length > 0).map((r) => r.clinic.id)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closingFilter, issueDate, clinics.length, orders.length])

  function toggle(clinicId: string) {
    setSelectedClinics((prev) => {
      const next = new Set(prev)
      if (next.has(clinicId)) next.delete(clinicId); else next.add(clinicId)
      return next
    })
  }

  const targetRows = rows.filter((r) => r.selected && r.orders.length > 0)
  const grandTotal = targetRows.reduce((s, r) => s + r.total, 0)

  async function bulkIssue() {
    if (targetRows.length === 0) return
    if (!confirm(`${targetRows.length} 医院に一括で請求書を発行します。\n合計: ${fmtYen(grandTotal)}\nよろしいですか？`)) return

    setSubmitting(true)
    setResults([])
    setProgress({ done: 0, total: targetRows.length })

    const dueDate = calcDueDate(new Date(issueDate))
    const newResults: typeof results = []

    for (let i = 0; i < targetRows.length; i++) {
      const r = targetRows[i]
      try {
        const invoice_number = await generateInvoiceNumber(new Date(issueDate))
        const { data: inv, error: e1 } = await supabase
          .from("invoices")
          .insert({
            clinic_id: r.clinic.id,
            invoice_number,
            issue_date: issueDate,
            due_date: dueDate,
            subtotal: r.subtotal,
            tax: r.tax,
            total: r.total,
            status: "issued",
          })
          .select()
          .single()
        if (e1 || !inv) throw new Error(e1?.message || "発行失敗")
        const orderIds = r.orders.map((o) => o.id)
        const { error: e2 } = await supabase.from("orders").update({ invoice_id: inv.id }).in("id", orderIds)
        if (e2) throw new Error("紐付け失敗: " + e2.message)
        newResults.push({ clinicName: r.clinic.name, ok: true, message: `${invoice_number} (${r.orders.length}件 ${fmtYen(r.total)})` })
      } catch (e) {
        newResults.push({ clinicName: r.clinic.name, ok: false, message: (e as Error).message })
      }
      setProgress({ done: i + 1, total: targetRows.length })
      setResults([...newResults])
    }

    setSubmitting(false)
    // 完了したら一覧を再取得
    fetchData()
  }

  if (loading) return <main style={page}><p>読み込み中…</p></main>

  return (
    <main style={page}>
      <Link href="/admin/invoices"><button style={back}>← 請求書一覧</button></Link>
      <h1 style={{ fontSize: 24, margin: "0 0 16px" }}>締日別 一括請求書発行</h1>

      {/* 設定 */}
      <div style={section}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <label style={fieldLabel}>発行日</label>
            <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} style={input} />
          </div>
          <div>
            <label style={fieldLabel}>締日で絞り込み</label>
            <select value={closingFilter} onChange={(e) => setClosingFilter(e.target.value)} style={input}>
              <option value="all">すべての締日</option>
              {CLOSING_DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>
        <p style={{ fontSize: 11, color: "#999", margin: "8px 0 0" }}>
          ※ 各医院の締日から自動で集計期間が決まります（医院マスタの締日設定基準）
        </p>
      </div>

      {/* 対象医院プレビュー */}
      <div style={section}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <p style={{ ...sectionLabel, margin: 0 }}>対象医院（{targetRows.length} / {rows.filter((r) => r.orders.length > 0).length} 件選択）</p>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setSelectedClinics(new Set(rows.filter((r) => r.orders.length > 0).map((r) => r.clinic.id)))} style={btnGray}>全選択</button>
            <button onClick={() => setSelectedClinics(new Set())} style={btnGray}>全解除</button>
          </div>
        </div>

        {rows.length === 0 ? (
          <p style={{ color: "#999", fontSize: 13 }}>該当医院がありません</p>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={{ ...th, width: 36 }}></th>
                <th style={th}>医院</th>
                <th style={{ ...th, width: 60, textAlign: "right" }}>注文数</th>
                <th style={{ ...th, width: 100, textAlign: "right" }}>税抜</th>
                <th style={{ ...th, width: 100, textAlign: "right" }}>税込</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const period = calcBillingPeriod(r.clinic.closing_day || "月末", new Date(issueDate))
                const empty = r.orders.length === 0
                return (
                  <tr key={r.clinic.id} style={{ background: r.selected && !empty ? "#f0f9ff" : empty ? "#fafafa" : "#fff", color: empty ? "#999" : "#222" }}>
                    <td style={{ ...td, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={r.selected}
                        disabled={empty}
                        onChange={() => toggle(r.clinic.id)}
                      />
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{r.clinic.corporate_name && <span style={{ fontSize: 10, color: "#777" }}>{r.clinic.corporate_name} </span>}{r.clinic.name}</div>
                      <div style={{ fontSize: 10, color: "#999" }}>締日: {r.clinic.closing_day || "月末"} / 期間: {period.from} 〜 {period.to}</div>
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>{r.orders.length}件</td>
                    <td style={{ ...td, textAlign: "right" }}>{fmtYen(r.subtotal)}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtYen(r.total)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 発行 */}
      <div style={summary}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 13 }}>選択合計（{targetRows.length}医院）</span>
          <strong style={{ fontSize: 22 }}>{fmtYen(grandTotal)}</strong>
        </div>
        <button
          onClick={bulkIssue}
          disabled={submitting || targetRows.length === 0}
          style={{ ...btnDark, width: "100%", padding: 14, fontSize: 15, opacity: submitting || targetRows.length === 0 ? 0.5 : 1 }}
        >
          {submitting ? `発行中… ${progress.done}/${progress.total}` : `${targetRows.length}医院に一括発行する（${fmtYen(grandTotal)}）`}
        </button>
      </div>

      {/* 結果 */}
      {results.length > 0 && (
        <div style={section}>
          <p style={sectionLabel}>発行結果</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {results.map((r, i) => (
              <div key={i} style={{ padding: "8px 12px", borderRadius: 6, background: r.ok ? "#f0fdf4" : "#fef2f2", color: r.ok ? "#15803d" : "#dc2626", fontSize: 12 }}>
                <strong>{r.ok ? "✓" : "✗"} {r.clinicName}</strong> — {r.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  )
}

const page: React.CSSProperties = { maxWidth: 800, margin: "0 auto", padding: 20 }
const back: React.CSSProperties = { padding: "6px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", marginBottom: 16, cursor: "pointer" }
const section: React.CSSProperties = { background: "#fff", border: "1px solid #eee", borderRadius: 10, padding: 16, marginBottom: 12 }
const sectionLabel: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "#444", margin: "0 0 8px" }
const input: React.CSSProperties = { width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box", background: "#fff" }
const fieldLabel: React.CSSProperties = { display: "block", fontSize: 11, color: "#777", marginBottom: 4, fontWeight: 600 }
const btnGray: React.CSSProperties = { padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", background: "#f7f7f7", fontSize: 11, cursor: "pointer" }
const btnDark: React.CSSProperties = { padding: "8px 16px", borderRadius: 8, border: "none", background: "#111", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }
const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse" }
const th: React.CSSProperties = { borderBottom: "2px solid #111", padding: "6px 8px", textAlign: "left", fontSize: 11, fontWeight: 700, background: "#fafafa" }
const td: React.CSSProperties = { borderBottom: "1px solid #eee", padding: "6px 8px", fontSize: 12 }
const summary: React.CSSProperties = { background: "#fff", border: "2px solid #111", borderRadius: 10, padding: 16, marginBottom: 12 }
