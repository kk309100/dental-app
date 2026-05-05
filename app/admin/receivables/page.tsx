"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"

type Invoice = { id: string; clinic_id: string | null; invoice_number: string; issue_date: string; due_date: string | null; total: number; status: string; paid_amount: number | null }
type Clinic = { id: string; name: string; corporate_name?: string | null }
type Payment = { id: string; invoice_id: string; amount: number; paid_at: string }

export default function ReceivablesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [showZero, setShowZero] = useState(false)
  const [overdueOnly, setOverdueOnly] = useState(false)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [i, c] = await Promise.all([
      supabase.from("invoices").select("id,clinic_id,invoice_number,issue_date,due_date,total,status,paid_amount").neq("status", "cancelled").limit(50000),
      supabase.from("clinics").select("id,name,corporate_name").limit(50000),
    ])
    setInvoices((i.data as Invoice[]) || [])
    setClinics((c.data as Clinic[]) || [])
    // 入金明細（無くてもOK）
    try {
      const { data: p } = await supabase.from("invoice_payments").select("id,invoice_id,amount,paid_at")
      setPayments((p as Payment[]) || [])
    } catch { setPayments([]) }
    setLoading(false)
  }

  const clinicById = useMemo(() => new Map(clinics.map(c => [c.id, c])), [clinics])
  const paymentsByInvoice = useMemo(() => {
    const m = new Map<string, number>()
    payments.forEach(p => m.set(p.invoice_id, (m.get(p.invoice_id) || 0) + Number(p.amount || 0)))
    return m
  }, [payments])

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // エイジングバケット（経過日数で分類）
  function bucketOf(dueDate: string | null): "current" | "0-30" | "30-60" | "60-90" | "90+" {
    if (!dueDate) return "current"
    const due = new Date(dueDate)
    if (due >= today) return "current"
    const days = Math.floor((today.getTime() - due.getTime()) / 86400000)
    if (days <= 30) return "0-30"
    if (days <= 60) return "30-60"
    if (days <= 90) return "60-90"
    return "90+"
  }

  const enriched = useMemo(() => invoices.map(inv => {
    const paid = paymentsByInvoice.get(inv.id) || Number(inv.paid_amount || 0)
    const remaining = Number(inv.total) - paid
    const overdue = inv.due_date ? new Date(inv.due_date) < today && remaining > 0 : false
    const bucket = remaining > 0 ? bucketOf(inv.due_date) : "current"
    return { inv, paid, remaining, overdue, bucket }
  }), [invoices, paymentsByInvoice, today])

  // 医院別に集計（エイジング含む）
  const byClinic = useMemo(() => {
    const m = new Map<string, { name: string; total: number; paid: number; remaining: number; overdueAmount: number; invoiceCount: number; oldestDue: string | null; aging: { current: number; "0-30": number; "30-60": number; "60-90": number; "90+": number } }>()
    enriched.forEach(({ inv, paid, remaining, overdue, bucket }) => {
      const cl = inv.clinic_id ? clinicById.get(inv.clinic_id) : null
      const key = inv.clinic_id || "(医院不明)"
      const name = cl?.name || "(医院不明)"
      const e = m.get(key) || { name, total: 0, paid: 0, remaining: 0, overdueAmount: 0, invoiceCount: 0, oldestDue: null, aging: { current: 0, "0-30": 0, "30-60": 0, "60-90": 0, "90+": 0 } }
      e.total += Number(inv.total)
      e.paid += paid
      e.remaining += remaining
      if (overdue) e.overdueAmount += remaining
      e.invoiceCount += 1
      if (remaining > 0) e.aging[bucket] += remaining
      if (inv.due_date && remaining > 0) {
        if (!e.oldestDue || inv.due_date < e.oldestDue) e.oldestDue = inv.due_date
      }
      m.set(key, e)
    })
    return Array.from(m.entries())
      .map(([id, v]) => ({ id, ...v }))
      .filter(r => showZero || r.remaining !== 0)
      .filter(r => !overdueOnly || r.overdueAmount > 0)
      .filter(r => !search || r.name.includes(search))
      .sort((a, b) => b.remaining - a.remaining)
  }, [enriched, clinicById, showZero, overdueOnly, search])

  // 全体エイジング合計
  const agingTotal = useMemo(() => {
    const t = { current: 0, "0-30": 0, "30-60": 0, "60-90": 0, "90+": 0 }
    enriched.forEach(({ remaining, bucket }) => { if (remaining > 0) t[bucket] += remaining })
    return t
  }, [enriched])

  const totals = useMemo(() => byClinic.reduce(
    (s, r) => ({ total: s.total + r.total, paid: s.paid + r.paid, remaining: s.remaining + r.remaining, overdue: s.overdue + r.overdueAmount }),
    { total: 0, paid: 0, remaining: 0, overdue: 0 }
  ), [byClinic])

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900">
          売掛金台帳
          <span className="ml-2 text-xs font-normal text-gray-400">医院別の未収金を一覧</span>
        </h1>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KPI label="請求合計" value={totals.total} />
        <KPI label="入金合計" value={totals.paid} color="#10b981" />
        <KPI label="未収合計" value={totals.remaining} color="#3b82f6" highlight />
        <KPI label="期限超過" value={totals.overdue} color="#dc2626" highlight />
      </div>

      {/* エイジングサマリ */}
      <div className="bg-white rounded p-3" style={{ border: "1px solid #e8eaed" }}>
        <p className="text-[10px] text-gray-500 font-bold mb-2">エイジング（未収金の経過日数別）</p>
        <div className="grid grid-cols-5 gap-2 text-center">
          <Aging label="期限内" amount={agingTotal["current"]} bg="#ecfdf5" color="#065f46" />
          <Aging label="0-30日" amount={agingTotal["0-30"]} bg="#fef3c7" color="#92400e" />
          <Aging label="30-60日" amount={agingTotal["30-60"]} bg="#fed7aa" color="#9a3412" />
          <Aging label="60-90日" amount={agingTotal["60-90"]} bg="#fecaca" color="#991b1b" />
          <Aging label="90日超" amount={agingTotal["90+"]} bg="#fee2e2" color="#7f1d1d" highlight />
        </div>
      </div>

      <div className="flex gap-1.5 items-center bg-gray-50 p-2 rounded-lg flex-wrap" style={{ border: "1px solid #e8eaed" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="医院名で検索"
          className="flex-1 min-w-[180px] px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <label className="flex items-center gap-1 text-xs text-gray-700 cursor-pointer px-2">
          <input type="checkbox" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} />
          期限超過のみ
        </label>
        <label className="flex items-center gap-1 text-xs text-gray-700 cursor-pointer px-2">
          <input type="checkbox" checked={showZero} onChange={e => setShowZero(e.target.checked)} />
          残高0円も表示
        </label>
      </div>

      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0" }}>
        <table className="w-full text-xs">
          <thead className="bg-gray-100 sticky top-0">
            <tr className="text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-3 py-1.5 text-left">医院</th>
              <th className="px-2 py-1.5 text-center w-16">請求件数</th>
              <th className="px-2 py-1.5 text-right w-28">請求合計</th>
              <th className="px-2 py-1.5 text-right w-28">入金合計</th>
              <th className="px-2 py-1.5 text-right w-28">残高</th>
              <th className="px-2 py-1.5 text-right w-28">うち期限超過</th>
              <th className="px-2 py-1.5 text-center w-32">最古未収期限</th>
            </tr>
          </thead>
          <tbody>
            {byClinic.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">対象なし</td></tr>
            ) : byClinic.map(r => (
              <tr key={r.id} className="border-b border-gray-100 hover:bg-blue-50/40">
                <td className="px-3 py-1.5">
                  <Link href={`/admin/invoices?clinic=${r.id}`} className="text-blue-700 hover:underline">{r.name}</Link>
                </td>
                <td className="px-2 py-1.5 text-center text-gray-600">{r.invoiceCount}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmtYen(r.total)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">{fmtYen(r.paid)}</td>
                <td className={"px-2 py-1.5 text-right tabular-nums font-bold " + (r.remaining > 0 ? "text-blue-700" : r.remaining < 0 ? "text-amber-700" : "text-gray-400")}>{fmtYen(r.remaining)}</td>
                <td className={"px-2 py-1.5 text-right tabular-nums " + (r.overdueAmount > 0 ? "text-red-600 font-bold" : "text-gray-300")}>
                  {r.overdueAmount > 0 ? fmtYen(r.overdueAmount) : "—"}
                </td>
                <td className="px-2 py-1.5 text-center text-[11px] text-gray-600">
                  {r.oldestDue ? new Date(r.oldestDue).toLocaleDateString("ja-JP") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function KPI({ label, value, color = "#374151", highlight = false }: { label: string; value: number; color?: string; highlight?: boolean }) {
  return (
    <div className="bg-white rounded p-3" style={{ border: "1px solid #e8eaed" }}>
      <p className="text-[10px] text-gray-500 font-bold">{label}</p>
      <p className={"tabular-nums mt-1 " + (highlight ? "text-xl font-bold" : "text-base font-bold")} style={{ color }}>{fmtYen(value)}</p>
    </div>
  )
}

function Aging({ label, amount, bg, color, highlight = false }: { label: string; amount: number; bg: string; color: string; highlight?: boolean }) {
  return (
    <div className="rounded p-2" style={{ background: bg }}>
      <p className="text-[10px] font-bold" style={{ color }}>{label}</p>
      <p className={"tabular-nums mt-1 " + (highlight ? "text-base font-bold" : "text-sm font-bold")} style={{ color }}>{amount > 0 ? fmtYen(amount) : "—"}</p>
    </div>
  )
}
