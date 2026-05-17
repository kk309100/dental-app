"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { fmtYen, fmtDate } from "@/lib/invoice"
import { QUOTE_STATUSES, type QuoteStatus } from "@/lib/quote"
import { GroupViewTabs, useGroupView, type GroupableRow } from "@/app/components/GroupViewTabs"
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
type QuoteItem = { id: string; quote_id: string; product_name: string | null; quantity: number; unit_price: number; amount: number | null }

export default function QuotesPage() {
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [items, setItems] = useState<QuoteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | QuoteStatus | "active">("all")
  const [clinicFilter, setClinicFilter] = useState("all")
  const [groupView, setGroupView] = useGroupView()

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [q, c] = await Promise.all([
      supabase.from("quotes").select("*").order("issue_date", { ascending: false }).limit(50000),
      supabase.from("clinics").select("id,name").order("name").limit(50000),
    ])
    setQuotes((q.data as Quote[]) || [])
    setClinics(c.data || [])
    // 商品別集計用に明細取得（テーブル無ければスキップ）
    try {
      const { data: its } = await supabase.from("quote_items").select("id,quote_id,product_name,quantity,unit_price,amount").limit(50000)
      setItems((its as QuoteItem[]) || [])
    } catch { setItems([]) }
    setLoading(false)
  }

  const clinicById = useMemo(() => new Map(clinics.map(c => [c.id, c])), [clinics])
  const clinicName = (id: string | null) => id ? (clinicById.get(id)?.name || "(削除済み)") : "—"

  const norm = (v: string) => String(v || "").toLowerCase().normalize("NFKC")
  const filtered = useMemo(() => {
    const k = norm(search)
    return quotes.filter((q) => {
      // active = draft / sent / accepted（売上化前）
      if (statusFilter === "active" && (q.status === "converted" || q.status === "rejected" || q.status === "cancelled")) return false
      if (statusFilter !== "all" && statusFilter !== "active" && q.status !== statusFilter) return false
      if (clinicFilter !== "all" && q.clinic_id !== clinicFilter) return false
      if (!k) return true
      const target = norm(`${q.quote_number} ${clinicName(q.clinic_id)}`)
      return target.includes(k)
    })
  }, [quotes, search, statusFilter, clinicFilter])

  const counts = useMemo(() => ({
    active: quotes.filter(q => !["converted", "rejected", "cancelled"].includes(q.status)).length,
    converted: quotes.filter(q => q.status === "converted").length,
    total: quotes.length,
  }), [quotes])

  // GroupViewTabs 用の行データ
  const itemsByQuote = useMemo(() => {
    const m = new Map<string, QuoteItem[]>()
    items.forEach(it => {
      if (!m.has(it.quote_id)) m.set(it.quote_id, [])
      m.get(it.quote_id)!.push(it)
    })
    return m
  }, [items])

  const groupRows: GroupableRow[] = useMemo(() => filtered.map(q => ({
    id: q.id,
    date: (q.issue_date || "").slice(0, 10),
    party: clinicName(q.clinic_id),
    amount: Number(q.total || 0),
    items: (itemsByQuote.get(q.id) || []).map(it => ({
      name: it.product_name || "(不明)",
      quantity: Number(it.quantity || 0),
      price: Number(it.unit_price || 0),
    })),
  })), [filtered, clinics, itemsByQuote])

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  return (
    <div className="space-y-2">
      {/* 注文 / 見積 サブタブ */}
      <div className="flex items-center gap-1 border-b border-gray-200 mb-2">
        <Link href="/admin/orders" className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-t">
          🛒 注文
        </Link>
        <div className="px-4 py-2 text-sm font-bold text-gray-900 border-b-2 border-emerald-500 -mb-px">
          📋 見積
        </div>
      </div>

      {/* ヘッダ + アクションボタン */}
      <div className="flex items-center flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900">
          見積書管理
          <span className="ml-2 text-xs font-normal text-gray-400">
            該当 {filtered.length}/全{quotes.length} ・ 進行中 {counts.active} ・ 売上化済 {counts.converted}
          </span>
        </h1>
        <Link href="/admin/quotes/create" className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded hover:bg-emerald-700">
          ＋ 見積書を作成
        </Link>
      </div>

      {/* フィルタ */}
      <div className="flex gap-1.5 items-center bg-gray-50 p-2 rounded-lg flex-wrap" style={{ border: "1px solid #e8eaed" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="見積書番号・医院で検索"
          className="flex-1 min-w-[180px] px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white"
        />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="active">進行中のみ ({counts.active})</option>
          <option value="converted">売上化済のみ ({counts.converted})</option>
          <option value="all">すべて ({counts.total})</option>
          <optgroup label="細かいステータス">
            {Object.entries(QUOTE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </optgroup>
        </select>
        <select value={clinicFilter} onChange={(e) => setClinicFilter(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white max-w-[200px]">
          <option value="all">全医院</option>
          {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* テーブル */}
      <GroupViewTabs value={groupView} onChange={setGroupView} rows={groupRows} partyLabel="医院">
      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0", maxHeight: "calc(100vh - 280px)" }}>
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <thead className="sticky top-0 bg-gray-100">
            <tr className="text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-2 py-1.5 text-left w-32">見積書No</th>
              <th className="px-2 py-1.5 text-center w-24">状態</th>
              <th className="px-2 py-1.5 text-left">医院</th>
              <th className="px-2 py-1.5 text-center w-24">発行日</th>
              <th className="px-2 py-1.5 text-center w-24">期限</th>
              <th className="px-2 py-1.5 text-right w-28">金額(税込)</th>
              <th className="px-2 py-1.5 text-center w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">該当見積書なし</td></tr>
            ) : filtered.map((q, i) => {
              const sc = QUOTE_STATUSES[q.status]
              return (
                <tr key={q.id} className={"border-b border-gray-100 hover:bg-blue-50/40 " + (i % 2 === 0 ? "" : "bg-gray-50/30")}>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-gray-700">{q.quote_number}</td>
                  <td className="px-2 py-1.5 text-center">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: sc.color + "22", color: sc.color }}>
                      {sc.label}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">{clinicName(q.clinic_id)}</td>
                  <td className="px-2 py-1.5 text-center text-[11px] text-gray-600">{fmtDate(q.issue_date)}</td>
                  <td className="px-2 py-1.5 text-center text-[11px] text-gray-600">{q.expiry_date ? fmtDate(q.expiry_date) : "—"}</td>
                  <td className="px-2 py-1.5 text-right text-[12px] font-bold">{fmtYen(q.total)}</td>
                  <td className="px-2 py-1.5 text-center">
                    <Link href={`/admin/quotes/${q.id}`} className="text-[10px] px-2 py-0.5 border border-gray-200 rounded hover:bg-gray-50">開く</Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      </GroupViewTabs>
    </div>
  )
}
