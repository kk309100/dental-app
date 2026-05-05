"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Link from "next/link"
import { fmtYen } from "@/lib/invoice"

export default function AdminOrdersPageWrapper() {
  return (
    <Suspense fallback={<p className="text-gray-400 text-center py-12">読み込み中…</p>}>
      <AdminOrdersPage />
    </Suspense>
  )
}

type Order = { id: string; clinic_id: string; status: string; created_at: string; total_price: number; delivery_number: string | null; invoice_id: string | null }
type OrderItem = { id: string; order_id: string; product_id: string | null; product_name: string | null; quantity: number; price: number }
type Clinic = { id: string; name: string; corporate_name?: string | null }
type Product = { id: string; name: string; stock: number | null }

const STATUSES = ["注文受付", "確認中", "準備中", "納品済み", "キャンセル"] as const
const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  "注文受付": { bg: "#fef3c7", color: "#92400e" },
  "確認中": { bg: "#dbeafe", color: "#1e40af" },
  "準備中": { bg: "#e0e7ff", color: "#3730a3" },
  "納品済み": { bg: "#dcfce7", color: "#15803d" },
  "キャンセル": { bg: "#f3f4f6", color: "#6b7280" },
}

type ViewMode = "flat" | "byClinic"

function AdminOrdersPage() {
  const sp = useSearchParams()
  const initialStatus = sp.get("status") === "delivered" ? "delivered" : sp.get("status") === "all" ? "all" : "undelivered"
  const [orders, setOrders] = useState<Order[]>([])
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<ViewMode>("byClinic")
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"undelivered" | "delivered" | "all" | string>(initialStatus)
  const [clinicFilter, setClinicFilter] = useState("all")
  const [openOrderIds, setOpenOrderIds] = useState<Set<string>>(new Set())
  const [openClinicIds, setOpenClinicIds] = useState<Set<string>>(new Set())
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set())

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [o, i, c, p] = await Promise.all([
      supabase.from("orders").select("*").order("created_at", { ascending: false }),
      supabase.from("order_items").select("*"),
      supabase.from("clinics").select("id,name,corporate_name"),
      supabase.from("products").select("id,name,stock"),
    ])
    setOrders((o.data as Order[]) || [])
    setOrderItems((i.data as OrderItem[]) || [])
    setClinics((c.data as Clinic[]) || [])
    setProducts((p.data as Product[]) || [])
    setLoading(false)
  }

  const clinicById = useMemo(() => new Map(clinics.map((c) => [c.id, c])), [clinics])
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const itemsByOrder = useMemo(() => {
    const m = new Map<string, OrderItem[]>()
    orderItems.forEach((it) => {
      if (!m.has(it.order_id)) m.set(it.order_id, [])
      m.get(it.order_id)!.push(it)
    })
    return m
  }, [orderItems])
  const norm = (v: string) => String(v || "").toLowerCase().normalize("NFKC")

  // 各注文の在庫充足判定
  function stockState(orderId: string): { ok: number; short: number; total: number; shortItems: OrderItem[] } {
    const items = itemsByOrder.get(orderId) || []
    let ok = 0, short = 0
    const shortItems: OrderItem[] = []
    items.forEach(it => {
      const p = it.product_id ? productById.get(it.product_id) : null
      const stock = Number(p?.stock || 0)
      if (stock >= Number(it.quantity || 0)) ok++
      else { short++; shortItems.push(it) }
    })
    return { ok, short, total: items.length, shortItems }
  }

  const filtered = useMemo(() => {
    const k = norm(search)
    return orders.filter((o) => {
      const items = itemsByOrder.get(o.id) || []
      const clinic = clinicById.get(o.clinic_id)
      const target = norm(`${o.delivery_number || ""} ${o.status} ${clinic?.name || ""} ${items.map((i) => i.product_name || "").join(" ")}`)
      const matchSearch = !k || target.includes(k)

      if (statusFilter === "undelivered" && (o.status === "納品済み" || o.status === "キャンセル")) return false
      if (statusFilter === "delivered" && o.status !== "納品済み") return false
      if (statusFilter !== "undelivered" && statusFilter !== "delivered" && statusFilter !== "all" && o.status !== statusFilter) return false

      if (clinicFilter !== "all" && o.clinic_id !== clinicFilter) return false
      return matchSearch
    })
  }, [orders, itemsByOrder, clinicById, search, statusFilter, clinicFilter])

  // 医院別グループ
  const byClinic = useMemo(() => {
    const m = new Map<string, Order[]>()
    filtered.forEach((o) => {
      if (!m.has(o.clinic_id)) m.set(o.clinic_id, [])
      m.get(o.clinic_id)!.push(o)
    })
    // クリニック名でソート
    return Array.from(m.entries()).sort((a, b) => {
      const an = clinicById.get(a[0])?.name || ""
      const bn = clinicById.get(b[0])?.name || ""
      return an.localeCompare(bn, "ja")
    })
  }, [filtered, clinicById])

  // 統計
  const counts = useMemo(() => ({
    undelivered: orders.filter((o) => !["納品済み", "キャンセル"].includes(o.status)).length,
    delivered: orders.filter((o) => o.status === "納品済み").length,
    total: orders.length,
  }), [orders])

  function buildStatusPatch(status: string) {
    const now = new Date().toISOString()
    const patch: Record<string, unknown> = { status }
    if (status === "確認中") patch.confirmed_at = now
    if (status === "準備中") patch.prepared_at = now
    if (status === "納品済み") patch.delivered_at = now
    if (status === "キャンセル") patch.cancelled_at = now
    return patch
  }

  async function tryUpdate(ids: string[], patch: Record<string, unknown>) {
    // フル patch でトライ → 失敗（新スキーマ未適用）したら status だけで再試行
    let { error } = await supabase.from("orders").update(patch).in("id", ids)
    if (error) {
      const fallback: Record<string, unknown> = { status: patch.status }
      const r = await supabase.from("orders").update(fallback).in("id", ids)
      error = r.error
    }
    return error
  }

  async function updateStatus(orderId: string, status: string) {
    const patch = buildStatusPatch(status)
    const err = await tryUpdate([orderId], patch)
    if (err) { alert("更新失敗: " + err.message); return }
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status, ...patch } : o)))
  }

  async function bulkUpdate(status: string) {
    if (selectedOrderIds.size === 0) return
    let deliveryDate: string | null = null
    // 納品済みは個別の納品日を選べるようにする
    if (status === "納品済み") {
      const today = new Date().toISOString().slice(0, 10)
      const input = prompt(`${selectedOrderIds.size}件を「納品済み」にします。\n納品日（YYYY-MM-DD）を入力してください。`, today)
      if (input === null) return
      deliveryDate = input.trim() || today
    } else {
      if (!confirm(`${selectedOrderIds.size}件を「${status}」にしますか？`)) return
    }
    const patch = buildStatusPatch(status)
    if (deliveryDate && status === "納品済み") patch.delivered_at = new Date(deliveryDate + "T12:00:00").toISOString()
    const err = await tryUpdate(Array.from(selectedOrderIds), patch)
    if (err) { alert("一括更新失敗: " + err.message); return }
    setSelectedOrderIds(new Set())
    fetchData()
  }

  function toggleSelect(id: string) {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleClinicOrders(clinicId: string, ids: string[]) {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev)
      const allSelected = ids.every((id) => next.has(id))
      if (allSelected) ids.forEach((id) => next.delete(id))
      else ids.forEach((id) => next.add(id))
      return next
    })
  }

  function toggleOrderOpen(id: string) {
    setOpenOrderIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleClinicOpen(clinicId: string) {
    setOpenClinicIds((prev) => {
      const next = new Set(prev)
      if (next.has(clinicId)) next.delete(clinicId); else next.add(clinicId)
      return next
    })
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  return (
    <div className="space-y-2">
      {/* 注文 / 見積 サブタブ */}
      <div className="flex items-center gap-1 border-b border-gray-200 mb-2">
        <div className="px-4 py-2 text-sm font-bold text-gray-900 border-b-2 border-emerald-500 -mb-px">
          🛒 注文
        </div>
        <Link href="/admin/quotes" className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-t">
          📋 見積
        </Link>
      </div>

      <div className="flex items-center flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900">
          注文管理
          <span className="ml-2 text-xs font-normal text-gray-400">該当 {filtered.length}/全{orders.length} ・ 未納品 {counts.undelivered} ・ 納品済 {counts.delivered}</span>
        </h1>
        <Link href="/admin/orders/new" className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded hover:bg-emerald-700">
          ＋ 新規注文
        </Link>
        <Link href="/admin/shipping" className="px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded hover:bg-blue-700">
          🚚 出荷準備
        </Link>
        {/* ビュー切替 */}
        <div className="flex bg-gray-100 rounded-lg p-0.5 text-xs">
          <button onClick={() => setView("byClinic")} className={"px-3 py-1.5 rounded font-bold " + (view === "byClinic" ? "bg-white shadow text-gray-900" : "text-gray-500")}>
            🏥 医院別
          </button>
          <button onClick={() => setView("flat")} className={"px-3 py-1.5 rounded font-bold " + (view === "flat" ? "bg-white shadow text-gray-900" : "text-gray-500")}>
            📋 一覧
          </button>
        </div>
      </div>

      {/* フィルタ */}
      <div className="flex gap-1.5 items-center bg-gray-50 p-2 rounded-lg flex-wrap" style={{ border: "1px solid #e8eaed" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="納品書No・医院・商品で検索"
          className="flex-1 min-w-[180px] px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="undelivered">未納品のみ ({counts.undelivered})</option>
          <option value="delivered">納品済のみ ({counts.delivered})</option>
          <option value="all">すべて ({counts.total})</option>
          <optgroup label="細かいステータス">
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </optgroup>
        </select>
        <select value={clinicFilter} onChange={(e) => setClinicFilter(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white max-w-[200px]">
          <option value="all">全医院</option>
          {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* バルクアクション: 業務フロー順（見積→納品 + 不足発注） */}
      {selectedOrderIds.size > 0 && (() => {
        const ids = Array.from(selectedOrderIds)
        // 選択された注文すべての在庫不足品をカウント
        const selectedShort = ids.reduce((sum, oid) => sum + stockState(oid).short, 0)
        const selectedItems = ids.reduce((sum, oid) => sum + (itemsByOrder.get(oid)?.length || 0), 0)
        const selectedOk = selectedItems - selectedShort
        return (
          <div className="bg-blue-50 rounded-lg p-2 flex items-center gap-2 text-xs flex-wrap" style={{ border: "1px solid #c7d2fe" }}>
            <span className="font-bold text-blue-900">{selectedOrderIds.size}件選択中</span>
            <span className="text-[10px] text-gray-600">
              在庫: <span className="text-emerald-700 font-bold">🟢{selectedOk}</span> / <span className={selectedShort > 0 ? "text-red-600 font-bold" : "text-gray-400"}>🔴{selectedShort}不足</span>
            </span>
            <button
              onClick={() => {
                if (ids.length === 1) {
                  window.location.href = `/admin/quotes/create?from_order=${ids[0]}`
                } else {
                  if (!confirm(`${ids.length}件を1つの見積書にまとめて作成します。よろしいですか？`)) return
                  window.location.href = `/admin/quotes/create?from_orders=${ids.join(",")}`
                }
              }}
              className="px-3 py-1 bg-indigo-100 text-indigo-800 rounded font-bold"
            >📋 見積書作成</button>
            {selectedShort > 0 && (
              <button
                onClick={() => {
                  window.location.href = `/admin/purchase-orders/suggest?from_orders=${ids.join(",")}`
                }}
                className="px-3 py-1 bg-amber-500 text-white rounded font-bold"
                title="在庫不足の商品を仕入先へ発注"
              >🛒 不足分を発注 ({selectedShort})</button>
            )}
            <button
              onClick={() => {
                window.location.href = `/admin/shipping?orders=${ids.join(",")}`
              }}
              className="px-3 py-1 bg-emerald-600 text-white rounded font-bold"
              title="出荷準備ページで納品書を発行"
            >📄 納品書作成</button>
            <button onClick={() => bulkUpdate("キャンセル")} className="px-3 py-1 bg-gray-400 text-white rounded">キャンセル</button>
            <button onClick={() => setSelectedOrderIds(new Set())} className="ml-auto text-gray-500 underline">選択解除</button>
          </div>
        )
      })()}

      {/* 医院別ビュー */}
      {view === "byClinic" && (
        <div className="space-y-2">
          {byClinic.length === 0 ? (
            <p className="text-center text-gray-400 py-8">該当注文なし</p>
          ) : byClinic.map(([clinicId, clinicOrders]) => {
            const clinic = clinicById.get(clinicId)
            const open = openClinicIds.has(clinicId)
            const total = clinicOrders.reduce((s, o) => s + (o.total_price || 0), 0)
            const undelivered = clinicOrders.filter((o) => !["納品済み", "キャンセル"].includes(o.status)).length
            // 在庫サマリ（未納品の注文のみ集計）
            const undeliveredOrders = clinicOrders.filter((o) => !["納品済み", "キャンセル"].includes(o.status))
            const stockSummary = undeliveredOrders.reduce((s, o) => {
              const ss = stockState(o.id)
              return { ok: s.ok + ss.ok, short: s.short + ss.short }
            }, { ok: 0, short: 0 })
            const allSelected = clinicOrders.every((o) => selectedOrderIds.has(o.id))
            const someSelected = clinicOrders.some((o) => selectedOrderIds.has(o.id))
            return (
              <div key={clinicId} className="bg-white rounded-lg overflow-hidden" style={{ border: "1px solid #e8eaed" }}>
                {/* 医院ヘッダー */}
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 cursor-pointer" onClick={() => toggleClinicOpen(clinicId)}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleClinicOrders(clinicId, clinicOrders.map((o) => o.id))}
                  />
                  <span className="text-base">{open ? "▼" : "▶"}</span>
                  <span className="font-bold text-gray-900">{clinic?.name || "医院不明"}</span>
                  <span className="text-xs text-gray-500">{clinicOrders.length}件</span>
                  {undelivered > 0 && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">未納品 {undelivered}</span>}
                  {undelivered > 0 && (stockSummary.ok > 0 || stockSummary.short > 0) && (
                    <span className="text-[10px] flex items-center gap-1">
                      <span className="text-emerald-700 font-bold">🟢{stockSummary.ok}</span>
                      {stockSummary.short > 0 && (
                        <span className="text-red-600 font-bold">🔴{stockSummary.short}不足</span>
                      )}
                    </span>
                  )}
                  {/* 医院単位で「不足分を発注」ボタン */}
                  {stockSummary.short > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        const ids = undeliveredOrders.map(o => o.id).join(",")
                        window.location.href = `/admin/purchase-orders/suggest?from_orders=${ids}`
                      }}
                      className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500 text-white hover:bg-amber-600"
                      title="この医院の不足分を発注"
                    >🛒 発注</button>
                  )}
                  <div className="flex-1" />
                  <span className="text-sm font-bold text-gray-900">{fmtYen(total)}</span>
                </div>

                {/* 注文リスト */}
                {open && (
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr className="text-[10px] text-gray-500 uppercase">
                        <th className="px-2 py-1 text-center w-8"></th>
                        <th className="px-2 py-1 text-left w-24">状態</th>
                        <th className="px-2 py-1 text-center w-24">在庫</th>
                        <th className="px-2 py-1 text-left w-32">納品書No</th>
                        <th className="px-2 py-1 text-left w-24">日時</th>
                        <th className="px-2 py-1 text-right w-24">金額</th>
                        <th className="px-2 py-1 text-center w-44">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clinicOrders.map((o, i) => {
                        const sc = STATUS_COLORS[o.status] || STATUS_COLORS["キャンセル"]
                        const items = itemsByOrder.get(o.id) || []
                        const isOpen = openOrderIds.has(o.id)
                        const ss = stockState(o.id)
                        const allOk = ss.short === 0 && ss.total > 0
                        const allShort = ss.short === ss.total && ss.total > 0
                        return (
                          <>
                            <tr key={o.id} className={"border-b border-gray-100 " + (selectedOrderIds.has(o.id) ? "bg-blue-100" : i % 2 === 0 ? "" : "bg-gray-50/30")}>
                              <td className="px-2 py-1 text-center">
                                <input type="checkbox" checked={selectedOrderIds.has(o.id)} onChange={() => toggleSelect(o.id)} />
                              </td>
                              <td className="px-2 py-1">
                                <select value={o.status} onChange={(e) => updateStatus(o.id, e.target.value)} className="px-1.5 py-0.5 rounded text-[10px] font-bold border-0 cursor-pointer w-full" style={{ background: sc.bg, color: sc.color }}>
                                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                                </select>
                              </td>
                              <td className="px-2 py-1 text-center">
                                {ss.total === 0 ? <span className="text-[10px] text-gray-300">—</span> :
                                 allOk ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">🟢 出荷可</span> :
                                 allShort ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">🔴 全不足</span> :
                                 <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">🟡 {ss.short}品不足</span>}
                              </td>
                              <td className="px-2 py-1 font-mono text-[10px] text-gray-600">{o.delivery_number || o.id.slice(0, 8)}</td>
                              <td className="px-2 py-1 text-[10px] text-gray-500">{new Date(o.created_at).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                              <td className="px-2 py-1 text-right text-[12px] font-bold">{fmtYen(o.total_price || 0)}</td>
                              <td className="px-2 py-1 text-center whitespace-nowrap">
                                <button onClick={() => toggleOrderOpen(o.id)} className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 hover:bg-gray-50 mr-1" title="明細を開閉">{isOpen ? "−" : "+"}</button>
                                <Link href={`/order-edit/${o.id}`}><button className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 hover:bg-gray-50 mr-1" title="編集">編</button></Link>
                                <Link href={`/admin/orders/new?copy=${o.id}`}><button className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 hover:bg-blue-50 text-blue-700 mr-1" title="この注文を複製">📋</button></Link>
                                <Link href={`/admin/quotes/create?from_order=${o.id}`}><button className="text-[10px] px-1.5 py-0.5 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 mr-1" title="この注文から見積書を発行">→見積</button></Link>
                                {ss.short > 0 && (
                                  <Link href={`/admin/purchase-orders/suggest?from_order=${o.id}`}>
                                    <button className="text-[10px] px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100" title="不足分を発注書候補に">→発注</button>
                                  </Link>
                                )}
                              </td>
                            </tr>
                            {isOpen && (
                              <tr key={o.id + "-d"} className="bg-yellow-50">
                                <td colSpan={7} className="px-4 py-2">
                                  {items.length === 0 ? <p className="text-[11px] text-gray-400">明細なし</p> : (
                                    <div>
                                      {items.map((it) => {
                                        const p = it.product_id ? productById.get(it.product_id) : null
                                        const stock = Number(p?.stock || 0)
                                        const enough = stock >= Number(it.quantity || 0)
                                        return (
                                        <div key={it.id} className="flex items-center justify-between text-[11px] py-0.5 border-b border-gray-100">
                                          <span className="flex items-center gap-2">
                                            <span className={"text-[9px] font-bold px-1 py-0.5 rounded " + (enough ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
                                              {enough ? "在庫OK" : `在庫${stock}`}
                                            </span>
                                            {it.product_name || "(不明)"}
                                          </span>
                                          <span className="text-gray-600">{it.quantity} × {fmtYen(it.price || 0)} = <strong>{fmtYen((it.price || 0) * (it.quantity || 0))}</strong></span>
                                        </div>
                                        )
                                      })}
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
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* フラットビュー */}
      {view === "flat" && (
        <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0", maxHeight: "calc(100vh - 280px)" }}>
          <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
            <thead className="sticky top-0 bg-gray-100">
              <tr className="text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
                <th className="px-2 py-1.5 text-center w-8"></th>
                <th className="px-2 py-1.5 text-left w-24">状態</th>
                <th className="px-2 py-1.5 text-center w-24">在庫</th>
                <th className="px-2 py-1.5 text-left w-28">納品書No</th>
                <th className="px-2 py-1.5 text-left">医院</th>
                <th className="px-2 py-1.5 text-left w-28">日付</th>
                <th className="px-2 py-1.5 text-right w-24">金額</th>
                <th className="px-2 py-1.5 text-center w-44">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">該当注文なし</td></tr>
              ) : filtered.map((o, i) => {
                const sc = STATUS_COLORS[o.status] || STATUS_COLORS["キャンセル"]
                const items = itemsByOrder.get(o.id) || []
                const open = openOrderIds.has(o.id)
                const ss = stockState(o.id)
                const allOk = ss.short === 0 && ss.total > 0
                const allShort = ss.short === ss.total && ss.total > 0
                return (
                  <>
                    <tr key={o.id} className={"border-b border-gray-100 " + (selectedOrderIds.has(o.id) ? "bg-blue-100" : i % 2 === 0 ? "" : "bg-gray-50/30")}>
                      <td className="px-2 py-1 text-center">
                        <input type="checkbox" checked={selectedOrderIds.has(o.id)} onChange={() => toggleSelect(o.id)} />
                      </td>
                      <td className="px-1 py-0.5">
                        <select value={o.status} onChange={(e) => updateStatus(o.id, e.target.value)} className="px-1.5 py-0.5 rounded text-[10px] font-bold border-0 cursor-pointer w-full" style={{ background: sc.bg, color: sc.color }}>
                          {STATUSES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1 text-center">
                        {ss.total === 0 ? <span className="text-[10px] text-gray-300">—</span> :
                         allOk ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">🟢 出荷可</span> :
                         allShort ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">🔴 全不足</span> :
                         <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">🟡 {ss.short}品不足</span>}
                      </td>
                      <td className="px-2 py-1 font-mono text-[10px] text-gray-600">{o.delivery_number || o.id.slice(0, 8)}</td>
                      <td className="px-2 py-1">{clinicById.get(o.clinic_id)?.name || "—"}</td>
                      <td className="px-2 py-1 text-[10px] text-gray-500">{new Date(o.created_at).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="px-2 py-1 text-right text-[12px] font-bold">{fmtYen(o.total_price || 0)}</td>
                      <td className="px-2 py-1 text-center whitespace-nowrap">
                        <button onClick={() => toggleOrderOpen(o.id)} className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 hover:bg-gray-50 mr-1">{open ? "−" : "+"}</button>
                        <Link href={`/order-edit/${o.id}`}><button className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 hover:bg-gray-50 mr-1">編</button></Link>
                        <Link href={`/admin/orders/new?copy=${o.id}`}><button className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 hover:bg-blue-50 text-blue-700 mr-1" title="この注文を複製">📋</button></Link>
                        <Link href={`/admin/quotes/create?from_order=${o.id}`}><button className="text-[10px] px-1.5 py-0.5 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 mr-1" title="見積書を発行">→見積</button></Link>
                        {ss.short > 0 && (
                          <Link href={`/admin/purchase-orders/suggest?from_order=${o.id}`}>
                            <button className="text-[10px] px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100" title="不足分を発注書候補に">→発注</button>
                          </Link>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr key={o.id + "-d"} className="bg-yellow-50">
                        <td colSpan={8} className="px-4 py-2">
                          {items.length === 0 ? <p className="text-[11px] text-gray-400">明細なし</p> : (
                            <div>
                              {items.map((it) => {
                                const p = it.product_id ? productById.get(it.product_id) : null
                                const stock = Number(p?.stock || 0)
                                const enough = stock >= Number(it.quantity || 0)
                                return (
                                <div key={it.id} className="flex items-center justify-between text-[11px] py-0.5 border-b border-gray-100">
                                  <span className="flex items-center gap-2">
                                    <span className={"text-[9px] font-bold px-1 py-0.5 rounded " + (enough ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
                                      {enough ? "在庫OK" : `在庫${stock}`}
                                    </span>
                                    {it.product_name || "(不明)"}
                                  </span>
                                  <span className="text-gray-600">{it.quantity} × {fmtYen(it.price || 0)} = <strong>{fmtYen((it.price || 0) * (it.quantity || 0))}</strong></span>
                                </div>
                                )
                              })}
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
      )}
    </div>
  )
}
