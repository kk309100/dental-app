"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { fmtYen, fmtDate, INVOICE_STATUSES, type InvoiceStatus } from "@/lib/invoice"
import Link from "next/link"
import { GroupViewTabs, useGroupView, type GroupableRow } from "@/app/components/GroupViewTabs"

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
type Clinic = { id: string; name: string }

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | InvoiceStatus>("all")
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
      supabase.from("clinics").select("id,name").order("name").limit(50000),
    ])
    setInvoices((i.data as Invoice[]) || [])
    setClinics(c.data || [])
    // 商品別集計用に明細も取得（テーブル無い時はスキップ）
    try {
      const { data: items } = await supabase.from("invoice_items").select("invoice_id,product_name,quantity,unit_price").limit(50000)
      setInvoiceItems((items as any[]) || [])
    } catch { setInvoiceItems([]) }
    setLoading(false)
  }

  const clinicName = (id: string | null) => id ? (clinics.find((c) => c.id === id)?.name || "(削除済み)") : "-"

  const filtered = useMemo(() => {
    const k = search.toLowerCase().normalize("NFKC")
    return invoices.filter((iv) => {
      if (statusFilter !== "all" && iv.status !== statusFilter) return false
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

  // 明細を請求書IDでグループ化
  const itemsByInvoice = useMemo(() => {
    const m = new Map<string, { product_name: string | null; quantity: number; unit_price: number }[]>()
    invoiceItems.forEach(it => {
      if (!m.has(it.invoice_id)) m.set(it.invoice_id, [])
      m.get(it.invoice_id)!.push(it)
    })
    return m
  }, [invoiceItems])

  // GroupViewTabs 用の行データ
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
  function bulkPrint() {
    if (selected.size === 0) { alert("選択がありません"); return }
    window.open(`/admin/invoices/print?ids=${Array.from(selected).join(",")}`, "_blank")
  }

  // 集計
  const totalIssued = filtered.filter((i) => i.status === "issued").reduce((s, i) => s + i.total, 0)
  const totalPaid = filtered.filter((i) => i.status === "paid").reduce((s, i) => s + i.total, 0)

  if (loading) return <main style={page}><p>読み込み中…</p></main>

  return (
    <main style={page}>
      <Link href="/admin"><button style={back}>← 戻る</button></Link>

      <div style={header}>
        <div>
          <h1 style={{ fontSize: 26, margin: 0 }}>請求書管理</h1>
          <p style={{ fontSize: 12, color: "#999", margin: "4px 0 0" }}>{invoices.length}件</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={bulkPrint} disabled={selected.size === 0} style={{ ...btnGray, background: "#1f2937", color: "#fff", opacity: selected.size === 0 ? 0.4 : 1 }}>
            🖨 選択を一括印刷 ({selected.size})
          </button>
          <Link href="/admin/invoices/bulk"><button style={btnGray}>📋 一括発行</button></Link>
          <Link href="/admin/invoices/create"><button style={btnDark}>＋ 請求書を発行</button></Link>
        </div>
      </div>

      {/* KPI */}
      <div style={kpiGrid}>
        <Kpi label="未収金（発行済）" val={fmtYen(totalIssued)} sub={`${filtered.filter((i) => i.status === "issued").length}件`} />
        <Kpi label="入金済" val={fmtYen(totalPaid)} sub={`${filtered.filter((i) => i.status === "paid").length}件`} />
        <Kpi label="合計件数" val={`${filtered.length}件`} sub="" />
      </div>

      {/* フィルタ */}
      <div style={filters}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="請求書番号・医院名で検索"
          style={searchInput}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | InvoiceStatus)} style={select}>
          <option value="all">すべての状態</option>
          {Object.entries(INVOICE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={clinicFilter} onChange={(e) => setClinicFilter(e.target.value)} style={select}>
          <option value="all">すべての医院</option>
          {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={select} />
        <span style={{ color: "#999", fontSize: 12 }}>〜</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={select} />
        <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} style={select}>
          <option value="date_desc">📅 新しい順</option>
          <option value="date_asc">📅 古い順</option>
          <option value="amount_desc">💰 金額大→小</option>
          <option value="amount_asc">💰 金額小→大</option>
        </select>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, padding: "0 4px" }}>
        <button onClick={selectAll} style={{ padding: "2px 8px", border: "1px solid #ddd", borderRadius: 4, background: "#fff", cursor: "pointer" }}>全選択</button>
        <button onClick={clearSel} style={{ padding: "2px 8px", border: "1px solid #ddd", borderRadius: 4, background: "#fff", cursor: "pointer", color: "#666" }}>解除</button>
        <span style={{ color: "#666" }}>{selected.size}件選択中</span>
      </div>

      {/* 一覧 */}
      <GroupViewTabs value={groupView} onChange={setGroupView} rows={groupRows} partyLabel="医院">
      <div style={listWrap}>
        {filtered.length === 0 ? (
          <p style={{ padding: 32, textAlign: "center", color: "#999" }}>請求書がありません</p>
        ) : (
          filtered.map((iv) => (
            <div key={iv.id} style={{ ...card, background: selected.has(iv.id) ? "#dbeafe" : "#fff" }}>
              <input type="checkbox" checked={selected.has(iv.id)} onChange={() => toggleSel(iv.id)} style={{ marginRight: 8, marginTop: 4 }} />
              <Link href={`/admin/invoices/${iv.id}`} style={{ textDecoration: "none", color: "inherit", display: "flex", flex: 1, gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={cardHead}>
                    <span style={cardNum}>{iv.invoice_number}</span>
                    <StatusBadge status={iv.status} />
                  </div>
                  <p style={cardClinic}>{clinicName(iv.clinic_id)}</p>
                  <div style={cardMeta}>
                    <span>📅 発行: {fmtDate(iv.issue_date)}</span>
                    {iv.due_date && <span>⏰ 期限: {fmtDate(iv.due_date)}</span>}
                    {iv.paid_at && <span style={{ color: "#10b981" }}>✓ 入金: {fmtDate(iv.paid_at)}</span>}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={cardAmount}>{fmtYen(iv.total)}</p>
                  <p style={cardSubtotal}>税抜 {fmtYen(iv.subtotal)}</p>
                </div>
              </Link>
            </div>
          ))
        )}
      </div>
      </GroupViewTabs>
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

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const s = INVOICE_STATUSES[status]
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 10px",
      borderRadius: 99,
      background: s.color + "22",
      color: s.color,
      fontSize: 11,
      fontWeight: 700,
    }}>
      {s.label}
    </span>
  )
}

const page: React.CSSProperties = { maxWidth: 960, margin: "0 auto", padding: 20 }
const back: React.CSSProperties = { padding: "6px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", marginBottom: 16, cursor: "pointer" }
const header: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 12 }
const btnDark: React.CSSProperties = { padding: "8px 16px", borderRadius: 8, border: "none", background: "#111", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }
const btnGray: React.CSSProperties = { padding: "8px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#f7f7f7", color: "#333", fontSize: 13, cursor: "pointer" }
const kpiGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 12 }
const kpiCard: React.CSSProperties = { background: "#fff", border: "1px solid #eee", borderRadius: 10, padding: 14 }
const filters: React.CSSProperties = { display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }
const searchInput: React.CSSProperties = { flex: 1, minWidth: 180, padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }
const select: React.CSSProperties = { padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, background: "#fff" }
const listWrap: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 8 }
const card: React.CSSProperties = { background: "#fff", border: "1px solid #eee", borderRadius: 10, padding: 14, display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer", transition: "background 0.1s" }
const cardHead: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }
const cardNum: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: "#111" }
const cardClinic: React.CSSProperties = { fontSize: 13, color: "#444", margin: "2px 0", fontWeight: 600 }
const cardMeta: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11, color: "#777", marginTop: 4 }
const cardAmount: React.CSSProperties = { fontSize: 18, fontWeight: 800, color: "#111", margin: 0 }
const cardSubtotal: React.CSSProperties = { fontSize: 10, color: "#999", margin: "2px 0 0" }
