"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { parseCSV } from "@/lib/csv"

type BankLine = {
  id?: string
  paid_on: string
  amount: number
  payer_name: string
  memo: string
  matched_invoice_id?: string | null
  matched_payment_id?: string | null
  status?: string
  // UI-only
  candidates?: InvoiceCandidate[]
  selectedInvoiceId?: string
  saved?: boolean
}
type InvoiceCandidate = { id: string; clinic_name: string; invoice_number: string; total: number; remaining: number; due_date: string | null }
type Invoice = { id: string; clinic_id: string | null; invoice_number: string; total: number; paid_amount: number | null; status: string; due_date: string | null }
type Clinic = { id: string; name: string }
type Payment = { invoice_id: string; amount: number }

const BANK_FORMATS = [
  { value: "auto", label: "自動判定" },
  { value: "shinkin", label: "信用金庫（汎用）" },
  { value: "smbc", label: "三井住友銀行" },
  { value: "mizuho", label: "みずほ銀行" },
  { value: "ufj", label: "三菱UFJ銀行" },
  { value: "generic", label: "汎用（日付・金額・摘要）" },
]

export default function BankImportPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [bankFormat, setBankFormat] = useState("auto")
  const [lines, setLines] = useState<BankLine[]>([])
  const [filter, setFilter] = useState<"all" | "unmatched" | "matched">("all")
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [i, c] = await Promise.all([
      supabase.from("invoices").select("id,clinic_id,invoice_number,total,paid_amount,status,due_date").neq("status", "cancelled").limit(50000),
      supabase.from("clinics").select("id,name"),
    ])
    setInvoices((i.data as Invoice[]) || [])
    setClinics((c.data as Clinic[]) || [])
    try {
      const { data: p } = await supabase.from("invoice_payments").select("invoice_id,amount")
      setPayments((p as Payment[]) || [])
    } catch { setPayments([]) }
    setLoading(false)
  }

  const clinicById = useMemo(() => new Map(clinics.map(c => [c.id, c])), [clinics])
  const paidByInvoice = useMemo(() => {
    const m = new Map<string, number>()
    payments.forEach(p => m.set(p.invoice_id, (m.get(p.invoice_id) || 0) + Number(p.amount || 0)))
    return m
  }, [payments])
  const remainingByInvoice = useMemo(() => {
    const m = new Map<string, number>()
    invoices.forEach(inv => {
      const paid = paidByInvoice.get(inv.id) || Number(inv.paid_amount || 0)
      m.set(inv.id, Number(inv.total) - paid)
    })
    return m
  }, [invoices, paidByInvoice])

  // 振込人名 ↔ 医院名 マッチ
  function findCandidates(payerName: string, amount: number): InvoiceCandidate[] {
    const norm = (s: string) => s.normalize("NFKC").replace(/[ァ-ン]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s+/g, "").toLowerCase()
    const payerKey = norm(payerName)
    // まず医院名と部分一致するクリニックを探す
    const matchedClinics = clinics.filter(c => {
      const cn = norm(c.name)
      return cn && (payerKey.includes(cn) || cn.includes(payerKey))
    }).map(c => c.id)

    const candidates: InvoiceCandidate[] = []
    invoices.forEach(inv => {
      const remaining = remainingByInvoice.get(inv.id) || 0
      if (remaining <= 0) return
      const cl = inv.clinic_id ? clinicById.get(inv.clinic_id) : null
      const matched = inv.clinic_id && matchedClinics.includes(inv.clinic_id)
      // 残高が一致 or 医院名マッチを優先
      candidates.push({
        id: inv.id,
        clinic_name: cl?.name || "(医院不明)",
        invoice_number: inv.invoice_number,
        total: Number(inv.total),
        remaining,
        due_date: inv.due_date,
      })
    })
    // 残高完全一致 > 医院名マッチ > 残高近似
    return candidates.sort((a, b) => {
      const aExact = Math.abs(a.remaining - amount) < 1
      const bExact = Math.abs(b.remaining - amount) < 1
      if (aExact !== bExact) return aExact ? -1 : 1
      const aClinicMatch = matchedClinics.includes(invoices.find(i => i.id === a.id)?.clinic_id || "")
      const bClinicMatch = matchedClinics.includes(invoices.find(i => i.id === b.id)?.clinic_id || "")
      if (aClinicMatch !== bClinicMatch) return aClinicMatch ? -1 : 1
      return Math.abs(a.remaining - amount) - Math.abs(b.remaining - amount)
    }).slice(0, 5)
  }

  async function importFile(file: File) {
    const text = await file.text()
    const rows = parseCSV(text)
    if (rows.length === 0) { alert("CSVが空です"); return }

    // ヘッダ柔軟解釈
    const pickKey = (r: Record<string, string>, ...keys: string[]) => {
      for (const k of keys) if (r[k] !== undefined && r[k] !== "") return r[k]
      return ""
    }

    const newLines: BankLine[] = []
    for (const r of rows) {
      const dateStr = pickKey(r, "日付", "取引日", "入金日", "Date").trim()
      const amountStr = pickKey(r, "入金額", "預入額", "金額", "お預入れ", "Amount").replace(/[¥,]/g, "").trim()
      const payerName = pickKey(r, "振込人", "振込依頼人", "お取引内容", "摘要", "Memo").trim()
      const amount = Number(amountStr)
      if (!dateStr || !amount || amount <= 0) continue
      // 日付の正規化（YYYY/MM/DD or YYYY-MM-DD）
      const d = dateStr.replace(/[年月]/g, "/").replace(/日/g, "").replace(/\./g, "/")
      const parts = d.split(/[\/\-]/).map(s => s.trim())
      let isoDate = ""
      if (parts.length === 3 && parts[0].length === 4) isoDate = `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`
      else if (parts.length === 3) isoDate = `20${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`
      else continue

      const candidates = findCandidates(payerName, amount)
      newLines.push({
        paid_on: isoDate,
        amount,
        payer_name: payerName,
        memo: "",
        candidates,
        selectedInvoiceId: candidates.length > 0 && Math.abs(candidates[0].remaining - amount) < 1 ? candidates[0].id : "",
        status: "未消込",
      })
    }
    setLines(newLines)
    if (fileRef.current) fileRef.current.value = ""
    alert(`${newLines.length}件の入金行を読み込みました。自動マッチ済: ${newLines.filter(l => l.selectedInvoiceId).length}件`)
  }

  function updateLine(idx: number, patch: Partial<BankLine>) {
    setLines(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }

  // 1行消込
  async function commit(idx: number) {
    const l = lines[idx]
    if (!l.selectedInvoiceId) { alert("請求書を選択してください"); return }
    setBusy(true)
    const { data: payment, error } = await supabase.from("invoice_payments").insert({
      invoice_id: l.selectedInvoiceId,
      paid_at: l.paid_on + "T12:00:00",
      amount: l.amount,
      method: "振込",
      note: `銀行CSV取込: ${l.payer_name}${l.memo ? " / " + l.memo : ""}`,
    }).select().single()
    if (error) { alert("消込失敗: " + error.message); setBusy(false); return }
    // invoice の paid_amount/status も更新
    const inv = invoices.find(i => i.id === l.selectedInvoiceId)
    if (inv) {
      const newPaid = (paidByInvoice.get(inv.id) || Number(inv.paid_amount || 0)) + l.amount
      const newStatus = newPaid >= Number(inv.total) ? "paid" : "partial"
      const upd: Record<string, unknown> = { paid_at: l.paid_on + "T12:00:00", paid_amount: newPaid, status: newStatus }
      const r = await supabase.from("invoices").update(upd).eq("id", inv.id)
      if (r.error) await supabase.from("invoices").update({ paid_at: l.paid_on + "T12:00:00", paid_amount: newPaid }).eq("id", inv.id)
    }
    updateLine(idx, { saved: true, status: "消込済", matched_payment_id: payment?.id })
    setBusy(false)
    fetchData()
  }

  async function commitAll() {
    const unsaved = lines.map((l, i) => ({ l, i })).filter(({ l }) => !l.saved && l.selectedInvoiceId)
    if (unsaved.length === 0) { alert("消込対象なし"); return }
    if (!confirm(`${unsaved.length}件を一括消込します`)) return
    setBusy(true)
    for (const { i } of unsaved) await commit(i)
    setBusy(false)
  }

  const filtered = useMemo(() => lines.filter(l => {
    if (filter === "matched") return !!l.selectedInvoiceId
    if (filter === "unmatched") return !l.selectedInvoiceId
    return true
  }), [lines, filter])

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  if (tableMissing) {
    return (
      <div className="max-w-2xl mx-auto bg-amber-50 border border-amber-200 rounded-lg p-6 mt-12">
        <h1 className="text-lg font-bold text-amber-900 mb-2">📥 銀行CSV消込（未セットアップ）</h1>
        <p className="text-sm text-amber-800">invoice_payments テーブルが必要です。<br />
          <code className="bg-white px-1.5 py-0.5 rounded">db/migrations/2026-05-05_full_overhaul.sql</code> を Supabase で実行してください。
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900">
          📥 銀行入金CSV消込
          <span className="ml-2 text-xs font-normal text-gray-400">CSVから自動マッチ → 1クリック消込</span>
        </h1>
        <Link href="/admin/receivables" className="text-xs text-gray-500 underline">→ 売掛金台帳</Link>
      </div>

      <div className="bg-white rounded-lg p-3 flex items-center gap-3 flex-wrap" style={{ border: "1px solid #e8eaed" }}>
        <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) importFile(f) }} />
        <button onClick={() => fileRef.current?.click()}
          className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded hover:bg-emerald-700">📥 銀行CSV選択</button>
        <select value={bankFormat} onChange={e => setBankFormat(e.target.value)}
          className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          {BANK_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <span className="text-xs text-gray-500">
          ※ 想定列: 日付 / 入金額 / 振込人（または摘要）
        </span>
        {lines.length > 0 && (
          <button onClick={commitAll} disabled={busy} className="ml-auto px-4 py-1.5 bg-blue-600 text-white text-xs font-bold rounded hover:bg-blue-700 disabled:bg-gray-300">
            {busy ? "処理中…" : `✓ マッチ済を一括消込（${lines.filter(l => !l.saved && l.selectedInvoiceId).length}件）`}
          </button>
        )}
      </div>

      {lines.length > 0 && (
        <>
          <div className="flex gap-1.5 items-center bg-gray-50 p-2 rounded-lg" style={{ border: "1px solid #e8eaed" }}>
            <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)}
              className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
              <option value="all">すべて ({lines.length})</option>
              <option value="matched">マッチ済 ({lines.filter(l => l.selectedInvoiceId).length})</option>
              <option value="unmatched">未マッチ ({lines.filter(l => !l.selectedInvoiceId).length})</option>
            </select>
            <button onClick={() => setLines([])} className="text-xs text-red-500 hover:underline ml-auto">クリア</button>
          </div>

          <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0" }}>
            <table className="w-full text-xs">
              <thead className="bg-gray-100">
                <tr className="text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
                  <th className="px-2 py-1.5 text-center w-24">入金日</th>
                  <th className="px-2 py-1.5 text-right w-24">金額</th>
                  <th className="px-2 py-1.5 text-left w-40">振込人</th>
                  <th className="px-2 py-1.5 text-left">マッチする請求書</th>
                  <th className="px-2 py-1.5 text-center w-24">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l, idx) => {
                  const realIdx = lines.indexOf(l)
                  return (
                    <tr key={realIdx} className={"border-b border-gray-100 " + (l.saved ? "bg-emerald-50/40" : !l.selectedInvoiceId ? "bg-amber-50/30" : "")}>
                      <td className="px-2 py-1.5 text-center text-[11px]">{l.paid_on}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-bold">{fmtYen(l.amount)}</td>
                      <td className="px-2 py-1.5">{l.payer_name}</td>
                      <td className="px-2 py-1.5">
                        {l.saved ? (
                          <span className="text-xs text-emerald-700 font-bold">✓ 消込済</span>
                        ) : l.candidates && l.candidates.length > 0 ? (
                          <select value={l.selectedInvoiceId || ""} onChange={e => updateLine(realIdx, { selectedInvoiceId: e.target.value })}
                            className="w-full px-2 py-1 border border-gray-200 rounded text-xs">
                            <option value="">— 選択 —</option>
                            {l.candidates.map(c => {
                              const exact = Math.abs(c.remaining - l.amount) < 1
                              return <option key={c.id} value={c.id}>
                                {exact ? "🎯 " : ""}{c.clinic_name} / {c.invoice_number} / 残{fmtYen(c.remaining)}
                              </option>
                            })}
                          </select>
                        ) : (
                          <span className="text-xs text-amber-700">⚠ マッチする請求書なし（手動でマッチが必要）</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {!l.saved && l.selectedInvoiceId && (
                          <button onClick={() => commit(realIdx)} disabled={busy}
                            className="text-[10px] px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300">
                            消込
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {lines.length === 0 && (
        <div className="bg-blue-50 rounded-lg p-6 text-center text-sm text-blue-900" style={{ border: "1px solid #c7d2fe" }}>
          📋 銀行のオンラインバンキングからCSVダウンロードして、上の「銀行CSV選択」から取込んでください。<br />
          振込人名と医院名・残高で自動マッチ → ワンクリックで売掛金消込。
        </div>
      )}
    </div>
  )
}
