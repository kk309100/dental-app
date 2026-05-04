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

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("すべて")
  const [clinicFilter, setClinicFilter] = useState("すべて")
  const [openId, setOpenId] = useState("")

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

  // KPI
  const counts = useMemo(() => ({
    total: orders.length,
    pending: orders.filter((o) => ["注文受付", "確認中", "準備中"].includes(o.status)).length,
    delivered: orders.filter((o) => o.status === "納品済み").length,
    canceled: orders.filter((o) => o.status === "キャンセル").length,
  }), [orders])

  async function updateStatus(orderId: string, status: string) {
    await supabase.from("orders").update({ status }).eq("id", orderId)
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status } : o)))
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  return (
    <div className="space-y-5">
      {/* タイトル */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">注文管理</h1>
        <p className="text-xs text-gray-400 mt-0.5">{filteredOrders.length} / 全{orders.length}件</p>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="全注文" val={`${counts.total}件`} />
        <Kpi label="処理中" val={`${counts.pending}件`} color={counts.pending > 0 ? "#d97706" : "#10b981"} sub="受付/確認/準備" />
        <Kpi label="納品済" val={`${counts.delivered}件`} color="#15803d" />
        <Kpi label="キャンセル" val={`${counts.canceled}件`} color="#9ca3af" />
      </div>

      {/* フィルタ */}
      <div className="flex gap-2 flex-wrap items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="納品書番号・医院・商品で検索（半角/全角OK）"
          className="flex-1 min-w-[200px] px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
          <option value="すべて">すべての状態</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={clinicFilter} onChange={(e) => setClinicFilter(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
          <option value="すべて">すべての医院</option>
          {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* 一覧テーブル */}
      <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #e8eaed" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 800 }}>
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider border-b border-gray-100">
                <th className="px-3 py-2 text-left">状態</th>
                <th className="px-3 py-2 text-left">納品書番号</th>
                <th className="px-3 py-2 text-left">医院</th>
                <th className="px-3 py-2 text-left hidden md:table-cell">日付</th>
                <th className="px-3 py-2 text-right">金額</th>
                <th className="px-3 py-2 text-center w-32">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">該当注文なし</td></tr>
              ) : filteredOrders.slice(0, 200).map((o, i) => {
                const open = openId === o.id
                const items = getItems(o.id)
                const sc = STATUS_COLORS[o.status] || { bg: "#f3f4f6", color: "#6b7280" }
                return (
                  <>
                    <tr key={o.id} className={"border-t border-gray-50 hover:bg-blue-50/20 " + (i % 2 === 0 ? "" : "bg-gray-50/30")}>
                      <td className="px-3 py-2">
                        <select
                          value={o.status}
                          onChange={(e) => updateStatus(o.id, e.target.value)}
                          className="px-2 py-1 rounded text-xs font-bold border-0 cursor-pointer"
                          style={{ background: sc.bg, color: sc.color }}
                        >
                          {STATUSES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{o.delivery_number || o.id.slice(0, 8)}</td>
                      <td className="px-3 py-2 text-sm text-gray-700">{clinicName(o.clinic_id)}</td>
                      <td className="px-3 py-2 text-xs text-gray-500 hidden md:table-cell">{new Date(o.created_at).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="px-3 py-2 text-right font-bold">{fmtYen(o.total_price || 0)}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => setOpenId(open ? "" : o.id)} className="px-2 py-1 rounded text-xs bg-white border border-gray-200 hover:bg-gray-50">
                            {open ? "閉じる" : "明細"}
                          </button>
                          <Link href={`/order-edit/${o.id}`}><button className="px-2 py-1 rounded text-xs bg-white border border-gray-200 hover:bg-gray-50">編集</button></Link>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr key={o.id + "-detail"} className="bg-gray-50">
                        <td colSpan={6} className="px-6 py-3">
                          <p className="text-xs font-bold text-gray-500 mb-2">明細</p>
                          {items.length === 0 ? <p className="text-xs text-gray-400">明細なし</p> : (
                            <div className="space-y-1">
                              {items.map((it) => (
                                <div key={it.id} className="flex justify-between text-xs py-1 border-b border-gray-100">
                                  <span>{it.product_name || "(不明)"}</span>
                                  <span className="text-gray-500">{it.quantity} × {fmtYen(it.price || 0)} = <strong>{fmtYen((it.price || 0) * (it.quantity || 0))}</strong></span>
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
        {filteredOrders.length > 200 && (
          <p className="px-4 py-3 text-xs text-gray-500 text-center bg-gray-50 border-t border-gray-100">
            表示 200/{filteredOrders.length}件 ・ 検索で絞り込んでください
          </p>
        )}
      </div>
    </div>
  )
}

function Kpi({ label, val, sub, color = "#111" }: { label: string; val: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl p-3 sm:p-4" style={{ border: "1px solid #e8eaed" }}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-bold" style={{ color }}>{val}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}
