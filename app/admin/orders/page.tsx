"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import Link from "next/link"
import { fmtYen } from "@/lib/invoice"

type Order = { id: string; clinic_id: string; status: string; created_at: string; total_price: number; delivery_number: string | null; invoice_id: string | null }
type OrderItem = { id: string; order_id: string; product_id: string | null; product_name: string | null; quantity: number; price: number }
type Clinic = { id: string; name: string; corporate_name?: string | null }

const STATUSES = ["注文受付", "確認中", "準備中", "納品済み", "キャンセル"] as const
const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  "注文受付": { bg: "#fef3c7", color: "#92400e" },
  "確認中": { bg: "#dbeafe", color: "#1e40af" },
  "準備中": { bg: "#e0e7ff", color: "#3730a3" },
  "納品済み": { bg: "#dcfce7", color: "#15803d" },
  "キャンセル": { bg: "#f3f4f6", color: "#6b7280" },
}
const PAGE_SIZE = 100

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("すべて")
  const [clinicFilter, setClinicFilter] = useState("すべて")
  const [openId, setOpenId] = useState("")
  const [page, setPage] = useState(1)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [o, i, c] = await Promise.all([
      supabase.from("orders").select("*").order("created_at", { ascending: false }),
      supabase.from("order_items").select("*"),
      supabase.from("clinics").select("id,name,corporate_name"),
    ])
    setOrders((o.data as Order[]) || [])
    setOrderItems((i.data as OrderItem[]) || [])
    setClinics((c.data as Clinic[]) || [])
    setLoading(false)
  }

  const clinicName = (id: string) => clinics.find((c) => c.id === id)?.name || "—"
  const getItems = (orderId: string) => orderItems.filter((i) => i.order_id === orderId)
  const norm = (v: string) => String(v || "").toLowerCase().normalize("NFKC")

  const filteredOrders = useMemo(() => {
    const k = norm(search)
    return orders.filter((order) => {
      const items = getItems(order.id)
      const target = norm(`${order.delivery_number || ""} ${order.status || ""} ${clinicName(order.clinic_id)} ${items.map((i) => i.product_name || "").join(" ")}`)
      const matchSearch = !k || target.includes(k)
      const matchStatus = statusFilter === "すべて" || order.status === statusFilter
      const matchClinic = clinicFilter === "すべて" || order.clinic_id === clinicFilter
      return matchSearch && matchStatus && matchClinic
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, orderItems, search, statusFilter, clinicFilter, clinics])

  const counts = useMemo(() => ({
    pending: orders.filter((o) => ["注文受付", "確認中", "準備中"].includes(o.status)).length,
    delivered: orders.filter((o) => o.status === "納品済み").length,
  }), [orders])

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE))
  const pageItems = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  useEffect(() => { if (page > totalPages) setPage(1) }, [totalPages, page])

  async function updateStatus(orderId: string, status: string) {
    await supabase.from("orders").update({ status }).eq("id", orderId)
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status } : o)))
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900">
          注文管理
          <span className="ml-2 text-xs font-normal text-gray-400">該当 {filteredOrders.length}/全{orders.length}件 ・ 処理中 {counts.pending} ・ 納品済 {counts.delivered}</span>
        </h1>
      </div>

      {/* 検索バー */}
      <div className="flex gap-1.5 items-center bg-gray-50 p-2 rounded-lg" style={{ border: "1px solid #e8eaed" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="納品書番号・医院・商品で検索"
          className="flex-1 min-w-[160px] px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="すべて">すべての状態</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={clinicFilter} onChange={(e) => setClinicFilter(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="すべて">すべての医院</option>
          {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* 密テーブル */}
      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0", maxHeight: "calc(100vh - 240px)" }}>
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-100 text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-2 py-1.5 text-left w-24" style={td0}>状態</th>
              <th className="px-2 py-1.5 text-left w-28" style={td0}>納品書No.</th>
              <th className="px-2 py-1.5 text-left" style={td0}>医院</th>
              <th className="px-2 py-1.5 text-left w-28" style={td0}>日付</th>
              <th className="px-2 py-1.5 text-right w-24" style={td0}>金額</th>
              <th className="px-2 py-1.5 text-center w-20" style={td0}>操作</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">該当注文なし</td></tr>
            ) : pageItems.map((o, i) => {
              const open = openId === o.id
              const items = getItems(o.id)
              const sc = STATUS_COLORS[o.status] || { bg: "#f3f4f6", color: "#6b7280" }
              return (
                <>
                  <tr key={o.id} className={"border-b border-gray-100 hover:bg-blue-50/40 " + (i % 2 === 0 ? "" : "bg-gray-50/40")}>
                    <td className="px-1 py-0.5" style={td0}>
                      <select
                        value={o.status}
                        onChange={(e) => updateStatus(o.id, e.target.value)}
                        className="px-1.5 py-0.5 rounded text-[10px] font-bold border-0 cursor-pointer w-full"
                        style={{ background: sc.bg, color: sc.color }}
                      >
                        {STATUSES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1 font-mono text-[10px] text-gray-600" style={td0}>{o.delivery_number || o.id.slice(0, 8)}</td>
                    <td className="px-2 py-1 text-[12px] text-gray-700" style={td0}>{clinicName(o.clinic_id)}</td>
                    <td className="px-2 py-1 text-[11px] text-gray-500" style={td0}>{new Date(o.created_at).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-2 py-1 text-right text-[12px] font-bold" style={td0}>{fmtYen(o.total_price || 0)}</td>
                    <td className="px-1 py-1 text-center" style={td0}>
                      <button onClick={() => setOpenId(open ? "" : o.id)} className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 hover:bg-gray-50 mr-1">{open ? "−" : "+"}</button>
                      <Link href={`/order-edit/${o.id}`}><button className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 hover:bg-gray-50">編</button></Link>
                    </td>
                  </tr>
                  {open && (
                    <tr key={o.id + "-d"} className="bg-yellow-50">
                      <td colSpan={6} className="px-4 py-2" style={td0}>
                        <p className="text-[10px] font-bold text-gray-500 mb-1">明細</p>
                        {items.length === 0 ? <p className="text-[11px] text-gray-400">明細なし</p> : (
                          <div>
                            {items.map((it) => (
                              <div key={it.id} className="flex justify-between text-[11px] py-0.5 border-b border-gray-100">
                                <span>{it.product_name || "(不明)"}</span>
                                <span className="text-gray-600">{it.quantity} × {fmtYen(it.price || 0)} = <strong>{fmtYen((it.price || 0) * (it.quantity || 0))}</strong></span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-2 text-xs">
          <button onClick={() => setPage(1)} disabled={page === 1} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-30">«</button>
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-30">‹</button>
          <span className="px-2 text-gray-500">{page} / {totalPages} ({filteredOrders.length}件)</span>
          <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-30">›</button>
          <button onClick={() => setPage(totalPages)} disabled={page === totalPages} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-30">»</button>
        </div>
      )}
    </div>
  )
}

const td0: React.CSSProperties = { borderRight: "1px solid #f0f0f0" }
