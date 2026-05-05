"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { downloadCSV, toCSV } from "@/lib/csv"

type Order = { id: string; clinic_id: string; status: string; created_at: string; delivered_at: string | null; total_price: number; delivery_number: string | null; sales_rep?: string | null; invoice_id: string | null }
type OrderItem = { id: string; order_id: string; product_name: string | null; quantity: number; price: number }
type Clinic = { id: string; name: string; corporate_name?: string | null }

export default function DeliveriesPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [items, setItems] = useState<OrderItem[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [clinicFilter, setClinicFilter] = useState("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [sortBy, setSortBy] = useState<"date_desc" | "date_asc" | "amount_desc" | "amount_asc">("date_desc")
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [o, i, c] = await Promise.all([
      supabase.from("orders").select("id,clinic_id,status,created_at,delivered_at,total_price,delivery_number,sales_rep,invoice_id").eq("status", "納品済み").order("delivered_at", { ascending: false }),
      supabase.from("order_items").select("id,order_id,product_name,quantity,price").limit(50000),
      supabase.from("clinics").select("id,name,corporate_name"),
    ])
    setOrders((o.data as Order[]) || [])
    setItems((i.data as OrderItem[]) || [])
    setClinics((c.data as Clinic[]) || [])
    setLoading(false)
  }

  const clinicById = useMemo(() => new Map(clinics.map(c => [c.id, c])), [clinics])
  const itemsByOrder = useMemo(() => {
    const m = new Map<string, OrderItem[]>()
    items.forEach(it => { if (!m.has(it.order_id)) m.set(it.order_id, []); m.get(it.order_id)!.push(it) })
    return m
  }, [items])

  const norm = (v: string) => String(v || "").toLowerCase().normalize("NFKC")

  const filtered = useMemo(() => {
    const k = norm(search)
    return orders
      .filter(o => {
        const cl = clinicById.get(o.clinic_id)
        const dateStr = (o.delivered_at || o.created_at).slice(0, 10)
        if (from && dateStr < from) return false
        if (to && dateStr > to) return false
        if (clinicFilter !== "all" && o.clinic_id !== clinicFilter) return false
        if (!k) return true
        const target = norm(`${o.delivery_number || ""} ${cl?.name || ""}`)
        return target.includes(k)
      })
      .sort((a, b) => {
        const ad = a.delivered_at || a.created_at
        const bd = b.delivered_at || b.created_at
        if (sortBy === "date_desc") return bd.localeCompare(ad)
        if (sortBy === "date_asc") return ad.localeCompare(bd)
        if (sortBy === "amount_desc") return Number(b.total_price) - Number(a.total_price)
        if (sortBy === "amount_asc") return Number(a.total_price) - Number(b.total_price)
        return 0
      })
  }, [orders, clinicById, search, clinicFilter, from, to, sortBy])

  const totalAmount = useMemo(() => filtered.reduce((s, o) => s + Number(o.total_price || 0), 0), [filtered])

  function toggleSel(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  function selectAll() { setSelected(new Set(filtered.map(o => o.id))) }
  function clearSel() { setSelected(new Set()) }

  function bulkPrint() {
    if (selected.size === 0) { alert("選択がありません"); return }
    const ids = Array.from(selected).join(",")
    window.open(`/admin/deliveries/print?ids=${ids}`, "_blank")
  }

  function exportCSV() {
    const csv = toCSV(
      filtered.map(o => ({
        納品日: (o.delivered_at || o.created_at).slice(0, 10),
        納品書No: o.delivery_number || "",
        医院: clinicById.get(o.clinic_id)?.name || "",
        商品数: itemsByOrder.get(o.id)?.length || 0,
        金額: o.total_price,
        担当: o.sales_rep || "",
        請求書化: o.invoice_id ? "○" : "",
      })),
      ["納品日", "納品書No", "医院", "商品数", "金額", "担当", "請求書化"]
    )
    downloadCSV(`納品書一覧_${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900">
          📄 納品書一覧
          <span className="ml-2 text-xs font-normal text-gray-400">納品済み {filtered.length}/全{orders.length}件 ・ 合計 {fmtYen(totalAmount)}</span>
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={exportCSV} className="px-3 py-1.5 bg-white border border-gray-200 rounded text-xs hover:bg-gray-50">📤 CSV</button>
          <button onClick={bulkPrint} disabled={selected.size === 0} className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded hover:bg-emerald-700 disabled:opacity-50">
            🖨 選択を一括印刷 ({selected.size})
          </button>
        </div>
      </div>

      {/* フィルタ */}
      <div className="flex gap-1.5 items-center bg-gray-50 p-2 rounded-lg flex-wrap" style={{ border: "1px solid #e8eaed" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="納品書No・医院で検索"
          className="flex-1 min-w-[180px] px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <select value={clinicFilter} onChange={e => setClinicFilter(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white max-w-[200px]">
          <option value="all">全医院</option>
          {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <span className="text-xs text-gray-400">〜</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="date_desc">📅 新しい順</option>
          <option value="date_asc">📅 古い順</option>
          <option value="amount_desc">💰 金額大→小</option>
          <option value="amount_asc">💰 金額小→大</option>
        </select>
      </div>

      {/* 一括選択バー */}
      <div className="flex gap-2 items-center text-xs px-1">
        <button onClick={selectAll} className="px-2 py-0.5 border border-gray-200 rounded">全選択</button>
        <button onClick={clearSel} className="px-2 py-0.5 border border-gray-200 rounded text-gray-500">解除</button>
        <span className="text-gray-500">{selected.size}件選択中</span>
      </div>

      {/* テーブル */}
      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0", maxHeight: "calc(100vh - 240px)" }}>
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-100">
            <tr className="text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-2 py-1.5 text-center w-8">
                <input type="checkbox" checked={filtered.length > 0 && selected.size === filtered.length} onChange={(e) => e.target.checked ? selectAll() : clearSel()} />
              </th>
              <th className="px-2 py-1.5 text-center w-24">納品日</th>
              <th className="px-2 py-1.5 text-left w-36">納品書No</th>
              <th className="px-2 py-1.5 text-left">医院</th>
              <th className="px-2 py-1.5 text-center w-16">商品数</th>
              <th className="px-2 py-1.5 text-right w-28">金額(税抜)</th>
              <th className="px-2 py-1.5 text-center w-16">請求</th>
              <th className="px-2 py-1.5 text-center w-24">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">該当納品書なし</td></tr>
            ) : filtered.map((o, i) => {
              const cl = clinicById.get(o.clinic_id)
              const its = itemsByOrder.get(o.id) || []
              return (
                <tr key={o.id} className={"border-b border-gray-100 hover:bg-blue-50/40 " + (selected.has(o.id) ? "bg-blue-100" : i % 2 === 0 ? "" : "bg-gray-50/30")}>
                  <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={selected.has(o.id)} onChange={() => toggleSel(o.id)} /></td>
                  <td className="px-2 py-1.5 text-center text-[11px] text-gray-700">
                    {(o.delivered_at || o.created_at).slice(0, 10)}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-gray-700">{o.delivery_number || o.id.slice(0, 8)}</td>
                  <td className="px-2 py-1.5">{cl?.name || "(削除済み)"}</td>
                  <td className="px-2 py-1.5 text-center text-gray-600">{its.length}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-bold">{fmtYen(o.total_price || 0)}</td>
                  <td className="px-2 py-1.5 text-center">
                    {o.invoice_id ? <span className="text-emerald-600 text-[11px]">✓</span> : <span className="text-gray-300 text-[11px]">—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-center whitespace-nowrap">
                    <Link href={`/admin/deliveries/${o.id}`}><button className="text-[10px] px-2 py-0.5 border border-gray-200 rounded hover:bg-gray-50">開く</button></Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
