"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { fmtYen, fmtDate, INVOICE_STATUSES, type InvoiceStatus } from "@/lib/invoice"
import Link from "next/link"
import { GroupViewTabs, useGroupView, type GroupableRow } from "@/app/components/GroupViewTabs"
import PaymentBadge from "@/app/components/PaymentBadge"

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
  created_at: string
}
type Clinic = { id: string; name: string; payment_method?: string | null }

function isOverdue(iv: Invoice) {
  if (iv.status !== "issued" && iv.status !== "partial") return false
  if (!iv.due_date) return false
  return iv.due_date.slice(0, 10) < new Date().toISOString().slice(0, 10)
}
function overdueDays(iv: Invoice) {
  if (!iv.due_date) return 0
  const diff = new Date().getTime() - new Date(iv.due_date).getTime()
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)))
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | InvoiceStatus | "overdue">("all")
  const [clinicFilter, setClinicFilter] = useState<string>("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [sortBy, setSortBy] = useState<"date_desc" | "date_asc" | "amount_desc" | "amount_asc">("date_desc")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [groupView, setGroupView] = useGroupView()
  const [invoiceItems, setInvoiceItems] = useState<{ invoice_id: string; product_name: string | null; quantity: number; unit_price: number }[]>([])

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [i, c] = await Promise.all([
      supabase.from("invoices").select("*").order("issue_date", { ascending: false }).limit(50000),
      supabase.from("clinics").select("id,name,payment_method").order("name").limit(50000),
    ])
    setInvoices((i.data as Invoice[]) || [])
    setClinics(c.data || [])
    try {
      const { data: items } = await supabase.from("invoice_items").select("invoice_id,product_name,quantity,unit_price").limit(50000)
      setInvoiceItems((items as any[]) || [])
    } catch { setInvoiceItems([]) }
    setLoading(false)
  }

  const clinicById = useMemo(() => new Map(clinics.map(c => [c.id, c])), [clinics])
  const clinicName = (id: string | null) => id ? (clinicById.get(id)?.name || "(削除済み)") : "-"
  const clinicPayment = (id: string | null): string | null => id ? (clinicById.get(id)?.payment_method ?? null) : null

  const filtered = useMemo(() => {
    const k = search.toLowerCase().normalize("NFKC")
    return invoices.filter((iv) => {
      if (statusFilter === "overdue") {
        if (!isOverdue(iv)) return false
      } else if (statusFilter !== "all" && iv.status !== statusFilter) {
        return false
      }
      if (clinicFilter !== "all" && iv.clinic_id !== clinicFilter) return false
      const dateStr = (iv.issue_date || "").slice(0, 10)
      if (from && dateStr < from) return false
      if (to && dateStr > to) return false
      if (!k) return true
      const target = `${iv.invoice_number} ${clinicName(iv.clinic_id)}`.toLowerCase().normalize("NFKC")
      return target.includes(k)
    }).sort((a, b) => {
      if (sortBy === "date_desc") return (b.issue_date || "").localeCompare(a.issue_date || "")
      if (sortBy === "date_asc") return (a.issue_date || "").localeCompare(b.issue_date || "")
      if (sortBy === "amount_desc") return Number(b.total) - Number(a.total)
      if (sortBy === "amount_asc") return Number(a.total) - Number(b.total)
      return 0
    })
  }, [invoices, search, statusFilter, clinicFilter, from, to, sortBy])

  const itemsByInvoice = useMemo(() => {
    const m = new Map<string, { product_name: string | null; quantity: number; unit_price: number }[]>()
    invoiceItems.forEach(it => {
      if (!m.has(it.invoice_id)) m.set(it.invoice_id, [])
      m.get(it.invoice_id)!.push(it)
    })
    return m
  }, [invoiceItems])

  const groupRows: GroupableRow[] = useMemo(() => filtered.map(iv => ({
    id: iv.id,
    date: (iv.issue_date || "").slice(0, 10),
    party: clinicName(iv.clinic_id),
    amount: Number(iv.total || 0),
    items: (itemsByInvoice.get(iv.id) || []).map(it => ({
      name: it.product_name || "(不明)",
      quantity: Number(it.quantity || 0),
      price: Number(it.unit_price || 0),
    })),
  })), [filtered, clinics, itemsByInvoice])

  function toggleSel(id: string) { setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n }) }
  function selectAll() { setSelected(new Set(filtered.map(i => i.id))) }
  function clearSel() { setSelected(new Set()) }
  function scrollTop() { window.scrollTo({ top: 0, behavior: "smooth" }) }

  function bulkPrint() {
    if (selected.size === 0) { alert("選択がありません"); return }
    window.open(`/admin/invoices/print?ids=${Array.from(selected).join(",")}`, "_blank")
  }

  async function bulkMarkPaid() {
    if (selected.size === 0) { alert("選択がありません"); return }
    const targets = invoices.filter(iv => selected.has(iv.id) && (iv.status === "issued" || iv.status === "partial"))
    if (targets.length === 0) { alert("発行済・一部入金の請求書が選択されていません"); return }
    if (!confirm(`${targets.length}件を入金済にしますか？`)) return
    const today = new Date().toISOString()
    await Promise.all(targets.map(iv =>
      supabase.from("invoices").update({ status: "paid", paid_at: today, paid_amount: iv.total }).eq("id", iv.id)
    ))
    clearSel()
    fetchData()
  }

  // KPI（全件ベース）
  const overdueInvs = invoices.filter(isOverdue)
  const issuedInvs = invoices.filter(iv => iv.status === "issued" && !isOverdue(iv))
  const partialInvs = invoices.filter(iv => iv.status === "partial")
  const paidInvs = invoices.filter(iv => iv.status === "paid")

  function resetFilters() {
    setSearch(""); setStatusFilter("all"); setClinicFilter("all"); setFrom(""); setTo(""); setSortBy("date_desc")
  }
  const hasFilter = !!(search || statusFilter !== "all" || clinicFilter !== "all" || from || to)

  if (loading) return <main style={page}><p>読み込み中…</p></main>

  return (
    <main style={page}>
      {/* ヘッダー */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <Link href="/admin"><button style={back}>← 戻る</button></Link>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: 0 }}>請求書管理</h1>
          <p style={{ fontSize: 12, color: "#9ca3af", margin: "1px 0 0" }}>全 {invoices.length}件</p>
        </div>
        <div style={{ flex: 1 }} />
        {/* 選択中の操作（選択件数があるときに展開） */}
        {selected.size > 0 && (
          <>
            <span style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>{selected.size}件選択</span>
            <button onClick={bulkMarkPaid} style={{ ...btnGray, color: "#15803d", borderColor: "#86efac" }}>
              ✓ 入金済に
            </button>
            <button onClick={bulkPrint} style={{ ...btnGray, background: "#1f2937", color: "#fff", borderColor: "#1f2937" }}>
              🖨 印刷
            </button>
            <button onClick={clearSel} style={{ ...btnGray, fontSize: 12 }}>✕ 解除</button>
          </>
        )}
        <Link href="/admin/payments"><button style={btnGray}>💳 入金処理</button></Link>
        <Link href="/admin/invoices/bulk"><button style={btnGray}>📋 一括発行</button></Link>
        <Link href="/admin/invoices/create"><button style={btnDark}>＋ 請求書を発行</button></Link>
      </div>

      {/* KPIカード */}
      <div style={kpiGrid}>
        <KpiCard
          label="延滞" count={overdueInvs.length}
          val={fmtYen(overdueInvs.reduce((s, i) => s + Number(i.total), 0))}
          color="#dc2626" bg="#fef2f2"
          active={statusFilter === "overdue"}
          onClick={() => setStatusFilter(prev => prev === "overdue" ? "all" : "overdue")}
        />
        <KpiCard
          label="請求中" count={issuedInvs.length}
          val={fmtYen(issuedInvs.reduce((s, i) => s + Number(i.total), 0))}
          color="#2563eb" bg="#eff6ff"
          active={statusFilter === "issued"}
          onClick={() => setStatusFilter(prev => prev === "issued" ? "all" : "issued")}
        />
        <KpiCard
          label="一部入金" count={partialInvs.length}
          val={fmtYen(partialInvs.reduce((s, i) => s + Number(i.total), 0))}
          color="#d97706" bg="#fffbeb"
          active={statusFilter === "partial"}
          onClick={() => setStatusFilter(prev => prev === "partial" ? "all" : "partial")}
        />
        <KpiCard
          label="入金済" count={paidInvs.length}
          val={fmtYen(paidInvs.reduce((s, i) => s + Number(i.total), 0))}
          color="#16a34a" bg="#f0fdf4"
          active={statusFilter === "paid"}
          onClick={() => setStatusFilter(prev => prev === "paid" ? "all" : "paid")}
        />
      </div>

      {/* フィルタバー */}
      <div style={filterBar}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="請求書番号・医院名で検索"
          style={searchInput}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={selectStyle}>
          <option value="all">すべての状態</option>
          <option value="overdue">⚠ 延滞</option>
          {Object.entries(INVOICE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={clinicFilter} onChange={(e) => setClinicFilter(e.target.value)} style={selectStyle}>
          <option value="all">すべての医院</option>
          {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={selectStyle} />
        <span style={{ color: "#9ca3af", fontSize: 12 }}>〜</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={selectStyle} />
        <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} style={selectStyle}>
          <option value="date_desc">新しい順</option>
          <option value="date_asc">古い順</option>
          <option value="amount_desc">金額 大→小</option>
          <option value="amount_asc">金額 小→大</option>
        </select>
        {hasFilter && (
          <button onClick={resetFilters} style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff5f5", color: "#dc2626", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
            ✕ リセット
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, padding: "0 2px", marginBottom: 8 }}>
        <button onClick={selectAll} style={selBtn}>全選択</button>
        <span style={{ color: "#d1d5db" }}>|</span>
        <span style={{ color: "#6b7280" }}>{filtered.length}件表示</span>
        <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 4 }}>（行をダブルクリックで選択）</span>
      </div>

      {/* テーブル */}
      <GroupViewTabs value={groupView} onChange={setGroupView} rows={groupRows} partyLabel="医院">
        <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 8, overflow: "auto", maxHeight: "calc(100vh - 360px)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ position: "sticky", top: 0, background: "#f8fafc", zIndex: 1 }}>
              <tr style={{ borderBottom: "2px solid #d1d5db" }}>
                <th style={{ ...thS, width: 32, textAlign: "center" }}>
                  <input type="checkbox"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={e => e.target.checked ? selectAll() : clearSel()} />
                </th>
                <th style={{ ...thS, textAlign: "left", minWidth: 140 }}>請求書No</th>
                <th style={{ ...thS, textAlign: "center", minWidth: 80 }}>状態</th>
                <th style={{ ...thS, textAlign: "left" }}>医院</th>
                <th style={{ ...thS, textAlign: "center", minWidth: 72 }}>決済</th>
                <th style={{ ...thS, textAlign: "center", minWidth: 90 }}>発行日</th>
                <th style={{ ...thS, textAlign: "center", minWidth: 110 }}>期限</th>
                <th style={{ ...thS, textAlign: "center", minWidth: 90 }}>入金日</th>
                <th style={{ ...thS, textAlign: "right", minWidth: 80 }}>税抜</th>
                <th style={{ ...thS, textAlign: "right", minWidth: 90 }}>税込</th>
                <th style={{ ...thS, textAlign: "center", minWidth: 56 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={11} style={{ padding: "40px 16px", textAlign: "center", color: "#9ca3af" }}>該当する請求書がありません</td></tr>
              ) : filtered.map((iv, i) => {
                const overdue = isOverdue(iv)
                const days = overdue ? overdueDays(iv) : 0
                const st = INVOICE_STATUSES[iv.status]
                const leftColor = overdue ? "#dc2626"
                  : iv.status === "issued" ? "#3b82f6"
                  : iv.status === "partial" ? "#f59e0b"
                  : iv.status === "paid" ? "#10b981"
                  : "#e5e7eb"
                return (
                  <tr key={iv.id}
                    onDoubleClick={() => toggleSel(iv.id)}
                    style={{
                      borderBottom: "1px solid #f0f0f0",
                      background: selected.has(iv.id) ? "#dbeafe" : i % 2 === 0 ? "#fff" : "#fafafa",
                      borderLeft: `3px solid ${leftColor}`,
                      cursor: "default",
                    }}
                  >
                    <td style={{ ...tdS, textAlign: "center" }}>
                      <input type="checkbox" checked={selected.has(iv.id)} onChange={() => toggleSel(iv.id)} />
                    </td>
                    <td style={{ ...tdS, fontFamily: "monospace", fontSize: 12, color: "#374151", whiteSpace: "nowrap" }}>
                      {iv.invoice_number}
                    </td>
                    <td style={{ ...tdS, textAlign: "center", whiteSpace: "nowrap" }}>
                      {overdue ? (
                        <span style={badge("#dc2626", "#fef2f2")}>延滞</span>
                      ) : (
                        <span style={badge(st.color, st.color + "20")}>{st.label}</span>
                      )}
                    </td>
                    <td style={{ ...tdS, whiteSpace: "nowrap" }}>{clinicName(iv.clinic_id)}</td>
                    <td style={{ ...tdS, textAlign: "center", whiteSpace: "nowrap" }}>
                      <PaymentBadge method={clinicPayment(iv.clinic_id)} />
                    </td>
                    <td style={{ ...tdS, textAlign: "center", fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>
                      {fmtDate(iv.issue_date)}
                    </td>
                    <td style={{ ...tdS, textAlign: "center", whiteSpace: "nowrap" }}>
                      {iv.due_date ? (
                        <span style={{ fontSize: 12, color: overdue ? "#dc2626" : "#6b7280", fontWeight: overdue ? 700 : 400 }}>
                          {fmtDate(iv.due_date)}
                          {overdue && (
                            <span style={{ marginLeft: 4, padding: "1px 5px", background: "#dc2626", color: "#fff", borderRadius: 3, fontSize: 10 }}>
                              {days}日超過
                            </span>
                          )}
                        </span>
                      ) : <span style={{ color: "#d1d5db" }}>—</span>}
                    </td>
                    <td style={{ ...tdS, textAlign: "center", fontSize: 12, color: iv.paid_at ? "#10b981" : "#d1d5db", whiteSpace: "nowrap" }}>
                      {iv.paid_at ? fmtDate(iv.paid_at) : "—"}
                    </td>
                    <td style={{ ...tdS, textAlign: "right", fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>
                      {fmtYen(iv.subtotal)}
                    </td>
                    <td style={{ ...tdS, textAlign: "right", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                      {fmtYen(iv.total)}
                    </td>
                    <td style={{ ...tdS, textAlign: "center", whiteSpace: "nowrap" }}>
                      <Link href={`/admin/invoices/${iv.id}`} style={{
                        fontSize: 12, padding: "3px 10px", border: "1px solid #e5e7eb",
                        borderRadius: 5, background: "#fff", textDecoration: "none", color: "#374151",
                      }}>開く</Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </GroupViewTabs>

      {/* スクロールトップボタン */}
      <button
        onClick={scrollTop}
        title="トップへ戻る"
        style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 40,
          width: 44, height: 44, borderRadius: "50%",
          background: "#1f2937", color: "#fff",
          border: "none", fontSize: 18, cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >↑</button>
    </main>
  )
}

function KpiCard({ label, count, val, color, bg, active, onClick }: {
  label: string; count: number; val: string
  color: string; bg: string; active: boolean; onClick: () => void
}) {
  return (
    <button onClick={onClick} style={{
      background: active ? bg : "#fff",
      border: `1.5px solid ${active ? color : "#e5e7eb"}`,
      borderLeft: `4px solid ${color}`,
      borderRadius: 10, padding: "12px 16px", cursor: "pointer",
      textAlign: "left", transition: "all 0.15s",
      boxShadow: active ? `0 0 0 2px ${color}33` : "none",
    }}>
      <p style={{ fontSize: 11, color: "#6b7280", margin: 0, fontWeight: 600 }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 800, margin: "4px 0 0", color: active ? color : "#111" }}>{val}</p>
      <p style={{ fontSize: 12, color, margin: "2px 0 0", fontWeight: 600 }}>{count}件</p>
    </button>
  )
}

function badge(color: string, bg: string): React.CSSProperties {
  return { display: "inline-block", padding: "2px 8px", borderRadius: 99, background: bg, color, fontSize: 11, fontWeight: 700 }
}

const page: React.CSSProperties = { width: "100%", padding: 0 }
const back: React.CSSProperties = { padding: "6px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontSize: 13 }
const btnDark: React.CSSProperties = { padding: "8px 16px", borderRadius: 8, border: "none", background: "#111", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }
const btnGray: React.CSSProperties = { padding: "8px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#f7f7f7", color: "#333", fontSize: 13, cursor: "pointer" }
const kpiGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 12 }
const filterBar: React.CSSProperties = { display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }
const searchInput: React.CSSProperties = { flex: 1, minWidth: 180, padding: "7px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }
const selectStyle: React.CSSProperties = { padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, background: "#fff" }
const selBtn: React.CSSProperties = { padding: "2px 8px", border: "1px solid #e5e7eb", borderRadius: 4, background: "#fff", cursor: "pointer", fontSize: 12 }
const thS: React.CSSProperties = { padding: "8px 10px", fontSize: 12, fontWeight: 700, color: "#4b5563", whiteSpace: "nowrap" }
const tdS: React.CSSProperties = { padding: "7px 10px" }
