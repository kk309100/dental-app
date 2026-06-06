"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Link from "next/link"
import { fmtYen } from "@/lib/invoice"
import { GroupViewTabs, useGroupView, type GroupableRow } from "@/app/components/GroupViewTabs"
import { poolFromOrders } from "@/lib/po-pool"

export default function AdminOrdersPageWrapper() {
  return (
    <Suspense fallback={<p className="text-gray-400 text-center py-12">読み込み中…</p>}>
      <AdminOrdersPage />
    </Suspense>
  )
}

type Order = { id: string; clinic_id: string; status: string; created_at: string; total_price: number; delivery_number: string | null; invoice_id: string | null; source?: string | null; note?: string | null }
type OrderItem = { id: string; order_id: string; product_id: string | null; product_name: string | null; quantity: number; price: number }
type Clinic = { id: string; name: string; corporate_name?: string | null }
type Product = { id: string; name: string; stock: number | null; cost: number | null; price: number | null }
type POItem = { purchase_order_id: string; product_id: string | null; quantity: number; received_quantity: number | null }
type POHead = { id: string; status: string }

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
  // デフォルトは「すべて」表示（過去含む）。URLパラメータで filter 切替可能
  const initialStatus = sp.get("status") === "delivered" ? "delivered" : sp.get("status") === "undelivered" ? "undelivered" : "all"
  const [orders, setOrders] = useState<Order[]>([])
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [poHeads, setPoHeads] = useState<POHead[]>([])
  const [poItems, setPoItems] = useState<POItem[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<ViewMode>("byClinic")
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"undelivered" | "delivered" | "all" | string>(initialStatus)
  const [clinicFilter, setClinicFilter] = useState("all")
  const [openOrderIds, setOpenOrderIds] = useState<Set<string>>(new Set())
  const [openClinicIds, setOpenClinicIds] = useState<Set<string>>(new Set())
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set())
  const [groupView, setGroupView] = useGroupView()

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [o, i, c, p, ph, pi] = await Promise.all([
      supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(50000),
      supabase.from("order_items").select("*").limit(50000),  // デフォルト1000件 limit を回避
      supabase.from("clinics").select("id,name,corporate_name").limit(50000),
      supabase.from("products").select("id,name,stock,cost,price").limit(50000),
      // 業務状態判定用: 「未入荷の発注」を検出するため
      supabase.from("purchase_orders").select("id,status").limit(50000),
      supabase.from("purchase_order_items").select("purchase_order_id,product_id,quantity,received_quantity").limit(50000),
    ])
    const orders = (o.data as Order[]) || []
    setOrders(orders)
    setOrderItems((i.data as OrderItem[]) || [])
    setClinics((c.data as Clinic[]) || [])
    setProducts((p.data as Product[]) || [])
    setPoHeads((ph.data as POHead[]) || [])
    setPoItems((pi.data as POItem[]) || [])
    // 未納品の注文は商品明細をデフォルトで展開
    setOpenOrderIds(new Set(orders.filter(o => !["納品済み", "納品済", "キャンセル", "取消"].includes(o.status)).map(o => o.id)))
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

  // 「発注済み」「部分入荷」状態の PO で、まだ入荷待ちの商品ID集合
  // → 在庫不足注文がこの商品を含むなら「入荷待ち」、含まないなら「要発注」
  const orderedAwaitingReceipt = useMemo(() => {
    const activePOIds = new Set(poHeads.filter(p => p.status === "発注済" || p.status === "部分入荷").map(p => p.id))
    const ids = new Set<string>()
    poItems.forEach(it => {
      if (!it.product_id) return
      if (!activePOIds.has(it.purchase_order_id)) return
      const remaining = Number(it.quantity || 0) - Number(it.received_quantity || 0)
      if (remaining > 0) ids.add(it.product_id)
    })
    return ids
  }, [poHeads, poItems])

  // 業務状態（一目で「次にやること」が分かるバッジ用）
  // delivered  : 納品済み（完了）
  // cancelled  : キャンセル
  // ready      : 全在庫足りてる → 出荷準備すれば即納品可
  // waiting    : 不足分すべてが発注済み・入荷待ち
  // partial    : 不足分の一部だけ発注済み（残りは未発注）
  // need_po    : 不足分すべて未発注 → 発注書作る必要
  type BizState = "delivered" | "cancelled" | "ready" | "waiting" | "partial" | "need_po"
  function businessState(orderId: string): BizState {
    const order = orders.find(o => o.id === orderId)
    if (!order) return "ready"
    if (["納品済み", "納品済"].includes(order.status)) return "delivered"
    if (["キャンセル", "取消"].includes(order.status)) return "cancelled"

    const items = itemsByOrder.get(orderId) || []
    if (items.length === 0) return "ready"

    let shortCount = 0, awaitingCount = 0
    for (const it of items) {
      const stock = it.product_id ? Number(productById.get(it.product_id)?.stock || 0) : 0
      if (stock < Number(it.quantity || 0)) {
        shortCount++
        if (it.product_id && orderedAwaitingReceipt.has(it.product_id)) awaitingCount++
      }
    }
    if (shortCount === 0) return "ready"
    if (awaitingCount === shortCount) return "waiting"
    if (awaitingCount > 0) return "partial"
    return "need_po"
  }

  // バッジ表示用
  const BIZ_BADGES: Record<BizState, { icon: string; label: string; bg: string; color: string; border: string }> = {
    delivered: { icon: "✅", label: "納品済",     bg: "#dcfce7", color: "#15803d", border: "#86efac" },
    cancelled: { icon: "✕",  label: "取消",       bg: "#f3f4f6", color: "#6b7280", border: "#d1d5db" },
    ready:     { icon: "🚚", label: "出荷待ち",   bg: "#dbeafe", color: "#1e40af", border: "#93c5fd" },
    waiting:   { icon: "⏳", label: "入荷待ち",   bg: "#fef3c7", color: "#92400e", border: "#fde68a" },
    partial:   { icon: "🟠", label: "一部要発注", bg: "#fed7aa", color: "#9a3412", border: "#fdba74" },
    need_po:   { icon: "📦", label: "要発注",     bg: "#fee2e2", color: "#b91c1c", border: "#fca5a5" },
  }
  function BizBadge({ state }: { state: BizState }) {
    const s = BIZ_BADGES[state]
    return (
      <span className="text-[11px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-1 whitespace-nowrap"
        style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
        <span>{s.icon}</span><span>{s.label}</span>
      </span>
    )
  }

  // 注文経路バッジ（コンパクト版: アイコン+短い文字）
  function ClinicEditBadge() {
    return (
      <span className="text-[11px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 whitespace-nowrap ml-1"
        style={{ background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" }}
        title="医院側が注文内容を修正しました">
        ✏️ 修正あり
      </span>
    )
  }

  function SourceBadge({ source }: { source: string | null | undefined }) {
    const isAdmin = source === "admin"
    return isAdmin ? (
      <span className="text-[11px] px-1 py-0.5 rounded inline-flex items-center whitespace-nowrap"
        style={{ background: "#fef3c7", color: "#92400e" }}
        title="LINE/電話/口頭で受けた注文を事務入力">
        📞 事務
      </span>
    ) : (
      <span className="text-[11px] px-1 py-0.5 rounded inline-flex items-center whitespace-nowrap"
        style={{ background: "#dbeafe", color: "#1e40af" }}
        title="医院側のシステムから直接注文">
        🏥 Web
      </span>
    )
  }

  // 業務状態 + 不足品数を1つのバッジで表示（在庫列を消すため）
  function BizBadgeWithCount({ state, shortCount }: { state: BizState; shortCount: number }) {
    const s = BIZ_BADGES[state]
    const showCount = (state === "need_po" || state === "partial" || state === "waiting") && shortCount > 0
    return (
      <span className="text-[11px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 whitespace-nowrap"
        style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
        <span>{s.icon}</span>
        <span>{s.label}</span>
        {showCount && <span className="ml-0.5 opacity-70">{shortCount}品</span>}
      </span>
    )
  }

  // 注文削除（明細・関連レコードも消す）
  async function deleteOrder(orderId: string, deliveryNumber: string | null) {
    const order = orders.find(o => o.id === orderId)
    const isDelivered = order && ["納品済み", "納品済"].includes(order.status)
    const msg = isDelivered
      ? `⚠️ 「納品済み」の注文 ${deliveryNumber || orderId.slice(0, 8)} を削除します。\n\n業務記録（納品実績）が失われます。\n納品書・請求書とのリンクも切れる可能性があります。\n\n本当によろしいですか？`
      : `注文 ${deliveryNumber || orderId.slice(0, 8)} を削除します。\n明細も一緒に削除されます。\nよろしいですか？`
    if (!confirm(msg)) return
    await supabase.from("order_items").delete().eq("order_id", orderId)
    const { error } = await supabase.from("orders").delete().eq("id", orderId)
    if (error) { alert("削除失敗: " + error.message); return }
    fetchData()
  }

  // 仕入先未設定商品のフォールバック選択用 state
  const [fallbackPickerOrderIds, setFallbackPickerOrderIds] = useState<string[] | null>(null)
  const [fallbackProducts, setFallbackProducts] = useState<{ product_id: string; product_name: string; quantity: number }[]>([])
  const [allSuppliers, setAllSuppliers] = useState<{ id: string; name: string }[]>([])
  const [supplierSearch, setSupplierSearch] = useState("")

  // 注文の不足分を「発注プール」に追加（仕入先別の下書き発注書）
  async function addToPool(orderIds: string[], fallbackSupplierId?: string) {
    if (orderIds.length === 0) return
    const r = await poolFromOrders(orderIds, fallbackSupplierId)
    if (!r.ok && r.errors.length > 0) {
      alert("一部失敗:\n" + r.errors.join("\n"))
    }

    // ケース1: 仕入先未設定商品があり、まだ fallback も指定されてない
    if (r.skippedNoSupplier > 0 && !fallbackSupplierId) {
      // 仕入先一覧をロードして選択ダイアログを出す
      const { data: sups } = await supabase.from("suppliers").select("id,name").order("name").limit(50000)
      setAllSuppliers((sups as { id: string; name: string }[]) || [])
      setFallbackProducts(r.productsNeedingSupplier)
      setFallbackPickerOrderIds(orderIds)
      // 既にプール追加されたものについても、後でまとめて結果表示するため一旦ここで return
      // ※ 既に追加された分は既に DB に書き込み済み
      if (r.pos.length > 0) {
        const lines = r.pos.map(p => `  ${p.supplier_name}: ${p.added_items}品`).join("\n")
        alert(`一部の商品はプールに追加しました:\n${lines}\n\n残り ${r.skippedNoSupplier}品 の仕入先を選択してください。`)
      }
      return
    }

    if (r.pos.length === 0) {
      if (r.skippedNoShortage > 0) {
        alert(`すべての商品の在庫が足りています。\n発注の必要はありません。`)
      } else {
        alert("発注対象がありません。")
      }
      return
    }

    // プール追加成功
    const lines = r.pos.map(p => `  ${p.supplier_name}: ${p.added_items}品`).join("\n")
    if (confirm(`✅ 発注プールに追加しました:\n${lines}\n\n発注プール画面に移動しますか？`)) {
      window.location.href = "/admin/purchase-orders/pool"
    }
  }

  // 一括削除（納品済み含む。警告強化）
  async function bulkDelete() {
    const ids = Array.from(selectedOrderIds)
    const targetOrders = orders.filter(o => ids.includes(o.id))
    const deliveredCount = targetOrders.filter(o => ["納品済み", "納品済"].includes(o.status)).length

    const msg = deliveredCount > 0
      ? `⚠️ ${targetOrders.length}件 を削除します。\nうち ${deliveredCount}件 は「納品済み」（業務記録）です。\n\n削除すると納品実績・請求書とのリンクが失われる可能性があります。\n\n本当によろしいですか？`
      : `${targetOrders.length}件 を削除します。\n明細も一緒に削除されます。\nよろしいですか？`
    if (!confirm(msg)) return

    await supabase.from("order_items").delete().in("order_id", ids)
    const { error } = await supabase.from("orders").delete().in("id", ids)
    if (error) { alert("一括削除失敗: " + error.message); return }
    setSelectedOrderIds(new Set())
    fetchData()
  }

  const filtered = useMemo(() => {
    const k = norm(search)
    return orders.filter((o) => {
      const items = itemsByOrder.get(o.id) || []
      const clinic = clinicById.get(o.clinic_id)
      const target = norm(`${o.delivery_number || ""} ${o.status} ${clinic?.name || ""} ${items.map((i) => i.product_name || "").join(" ")}`)
      const matchSearch = !k || target.includes(k)

      if (statusFilter === "undelivered" && ["納品済み", "納品済", "キャンセル", "取消"].includes(o.status)) return false
      if (statusFilter === "delivered" && !["納品済み", "納品済"].includes(o.status)) return false
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
    undelivered: orders.filter((o) => !["納品済み", "納品済", "キャンセル", "取消"].includes(o.status)).length,
    delivered: orders.filter((o) => ["納品済み", "納品済"].includes(o.status)).length,
    total: orders.length,
  }), [orders])

  // GroupViewTabs 用の行データ（filtered を集計用に変換）
  const groupRows: GroupableRow[] = useMemo(() => filtered.map(o => ({
    id: o.id,
    date: o.created_at || "",
    party: clinicById.get(o.clinic_id)?.name || "(医院不明)",
    amount: Number(o.total_price || 0),
    items: (itemsByOrder.get(o.id) || []).map(it => ({
      name: it.product_name || "(不明)",
      quantity: Number(it.quantity || 0),
      price: Number(it.price || 0),
    })),
  })), [filtered, clinicById, itemsByOrder])

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

      {/* 🆕 医院Webからの新規注文アラート（最上部・目立つ表示） */}
      {(() => {
        const newOrders = orders
          .filter(o => o.source !== "admin" && o.status === "注文受付")
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
        if (newOrders.length === 0) return null
        const fmtTimeAgo = (dt: string) => {
          const diffMin = Math.floor((Date.now() - new Date(dt).getTime()) / 60000)
          if (diffMin < 1) return "今"
          if (diffMin < 60) return `${diffMin}分前`
          const diffHour = Math.floor(diffMin / 60)
          if (diffHour < 24) return `${diffHour}時間前`
          return `${Math.floor(diffHour / 24)}日前`
        }
        return (
          <div className="rounded-lg p-3 animate-pulse-soft" style={{ background: "linear-gradient(135deg,#fee2e2,#fecaca)", border: "2px solid #ef4444" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-red-900">🆕 医院Webから新規注文 {newOrders.length}件 (要対応)</span>
              <span className="text-[11px] text-red-700">最新順</span>
            </div>
            <div className="bg-white rounded p-2 max-h-60 overflow-auto">
              {newOrders.slice(0, 10).map(o => {
                const cl = clinicById.get(o.clinic_id)
                return (
                  <div key={o.id} className="flex items-center justify-between py-1 border-b border-gray-100 last:border-0 text-xs">
                    <span className="font-bold text-gray-900">{cl?.name || "(医院不明)"}</span>
                    <span className="text-[11px] text-gray-500 mx-2">{fmtTimeAgo(o.created_at)}</span>
                    <span className="text-gray-600 mx-2 font-mono text-[11px]">{o.delivery_number || o.id.slice(0, 8)}</span>
                    <span className="font-bold text-gray-900 tabular-nums mr-2">{fmtYen(o.total_price || 0)}</span>
                    <button
                      onClick={() => updateStatus(o.id, "確認中")}
                      className="text-[11px] px-2 py-0.5 bg-emerald-600 text-white rounded hover:bg-emerald-700"
                      title="この注文を「確認中」に進めて、新規アラートから外す">
                      確認
                    </button>
                  </div>
                )
              })}
              {newOrders.length > 10 && (
                <p className="text-[11px] text-gray-500 text-center mt-1">他 {newOrders.length - 10}件 ...</p>
              )}
            </div>
          </div>
        )
      })()}

      <div className="flex items-center flex-wrap gap-2">
        <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827" }}>
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
            <span className="text-[11px] text-gray-600">
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
                onClick={() => addToPool(ids)}
                className="px-3 py-1 bg-amber-500 text-white rounded font-bold"
                title="不足商品を仕入先別の発注プールに追加（後で一括発注確定）"
              >🛒 プールに追加 ({selectedShort}品)</button>
            )}
            <button
              onClick={() => {
                window.location.href = `/admin/shipping?orders=${ids.join(",")}`
              }}
              className="px-3 py-1 bg-emerald-600 text-white rounded font-bold"
              title="出荷準備ページで納品書を発行"
            >📄 納品書作成</button>
            <button onClick={() => bulkUpdate("キャンセル")} className="px-3 py-1 bg-gray-400 text-white rounded">キャンセル</button>
            {(() => {
              // 選択中で削除可能な件数（納品済みは除外）
              return ids.length > 0 ? (
                <button onClick={bulkDelete}
                  className="px-3 py-1 bg-red-600 text-white rounded font-bold"
                  title="選択した注文を削除（納品済み含む。警告あり）">
                  🗑 一括削除 ({ids.length})
                </button>
              ) : null
            })()}
            <button onClick={() => setSelectedOrderIds(new Set())} className="ml-auto text-gray-500 underline">選択解除</button>
          </div>
        )
      })()}

      <GroupViewTabs value={groupView} onChange={setGroupView} rows={groupRows} partyLabel="医院">
      {/* 医院別ビュー */}
      {view === "byClinic" && (
        <div className="space-y-2">
          {byClinic.length === 0 ? (
            <p className="text-center text-gray-400 py-8">該当注文なし</p>
          ) : byClinic.map(([clinicId, clinicOrders]) => {
            const clinic = clinicById.get(clinicId)
            const open = openClinicIds.has(clinicId)
            const total = clinicOrders.reduce((s, o) => s + (o.total_price || 0), 0)
            const undelivered = clinicOrders.filter((o) => !["納品済み", "納品済", "キャンセル", "取消"].includes(o.status)).length
            // 在庫サマリ（未納品の注文のみ集計）
            const undeliveredOrders = clinicOrders.filter((o) => !["納品済み", "納品済", "キャンセル", "取消"].includes(o.status))
            const stockSummary = undeliveredOrders.reduce((s, o) => {
              const ss = stockState(o.id)
              return { ok: s.ok + ss.ok, short: s.short + ss.short }
            }, { ok: 0, short: 0 })
            // 業務状態の集計（医院グループのサマリーバッジ用）
            const bizCounts = clinicOrders.reduce((acc, o) => {
              const s = businessState(o.id)
              acc[s] = (acc[s] || 0) + 1
              return acc
            }, {} as Record<string, number>)
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
                  {/* 業務状態サマリー */}
                  {(() => {
                    const total = clinicOrders.length
                    const delivered = bizCounts.delivered || 0
                    const cancelled = bizCounts.cancelled || 0
                    const finished = delivered + cancelled
                    const allDelivered = delivered === total && total > 0
                    const allFinished = finished === total && total > 0
                    // 全件納品済み（取消なし） → 「✅ 全件納品済」
                    if (allDelivered) {
                      return (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded inline-flex items-center gap-1"
                          style={{ background: "#dcfce7", color: "#15803d", border: "1px solid #86efac" }}>
                          ✅ 全件納品済
                        </span>
                      )
                    }
                    // 全件完了（一部取消含む） → 納品N+取消M
                    if (allFinished) {
                      return (
                        <span className="flex items-center gap-1 flex-wrap">
                          {delivered > 0 && (
                            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded"
                              style={{ background: "#dcfce7", color: "#15803d", border: "1px solid #86efac" }}>
                              ✅ 納品済 {delivered}
                            </span>
                          )}
                          {cancelled > 0 && (
                            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded"
                              style={{ background: "#f3f4f6", color: "#6b7280", border: "1px solid #d1d5db" }}>
                              ✕ 取消 {cancelled}
                            </span>
                          )}
                        </span>
                      )
                    }
                    // 進行中あり: 進行中バッジ + 完了済件数（小さく）
                    return (
                      <span className="flex items-center gap-1 ml-2 flex-wrap">
                        {(["need_po", "partial", "waiting", "ready"] as const).map(s => (
                          bizCounts[s] ? (
                            <span key={s} className="text-[11px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-0.5"
                              style={{ background: BIZ_BADGES[s].bg, color: BIZ_BADGES[s].color, border: `1px solid ${BIZ_BADGES[s].border}` }}>
                              {BIZ_BADGES[s].icon}{BIZ_BADGES[s].label} {bizCounts[s]}
                            </span>
                          ) : null
                        ))}
                        {finished > 0 && (
                          <span className="text-[11px] text-gray-500" title={`納品済 ${delivered} / 取消 ${cancelled}`}>
                            （納品済 {delivered}/{total}{cancelled > 0 ? ` ・取消 ${cancelled}` : ""}）
                          </span>
                        )}
                      </span>
                    )
                  })()}
                  {/* 医院単位で「不足分を発注」ボタン */}
                  {stockSummary.short > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        addToPool(undeliveredOrders.map(o => o.id))
                      }}
                      className="text-[11px] font-bold px-2 py-0.5 rounded bg-amber-500 text-white hover:bg-amber-600"
                      title="この医院の不足分を発注プールに追加"
                    >🛒 プール追加</button>
                  )}
                  <div className="flex-1" />
                  <span className="text-sm font-bold text-gray-900">{fmtYen(total)}</span>
                </div>

                {/* 注文リスト */}
                {open && (
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr className="text-[11px] text-gray-500 uppercase">
                        <th className="px-2 py-1 text-center w-8"></th>
                        <th className="px-2 py-1 text-left w-24">状態</th>
                        <th className="px-2 py-1 text-center w-32">業務状態</th>
                        <th className="px-2 py-1 text-center w-16">経路</th>
                        <th className="px-2 py-1 text-left w-32">納品書No</th>
                        <th className="px-2 py-1 text-left w-24">日時</th>
                        <th className="px-2 py-1 text-right w-24">金額</th>
                        <th className="px-2 py-1 text-center w-40">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clinicOrders.map((o, i) => {
                        const sc = STATUS_COLORS[o.status] || STATUS_COLORS["キャンセル"]
                        const items = itemsByOrder.get(o.id) || []
                        const isOpen = openOrderIds.has(o.id)
                        const ss = stockState(o.id)
                        const biz = businessState(o.id)
                        return (
                          <>
                            <tr key={o.id} className={"border-b border-gray-100 " + (selectedOrderIds.has(o.id) ? "bg-blue-100" : i % 2 === 0 ? "" : "bg-gray-50/30")}>
                              <td className="px-2 py-1 text-center">
                                <input type="checkbox" checked={selectedOrderIds.has(o.id)} onChange={() => toggleSelect(o.id)} />
                              </td>
                              <td className="px-2 py-1">
                                <select value={o.status} onChange={(e) => updateStatus(o.id, e.target.value)} className="px-1.5 py-0.5 rounded text-[11px] font-bold border-0 cursor-pointer w-full" style={{ background: sc.bg, color: sc.color }}>
                                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                                </select>
                              </td>
                              <td className="px-2 py-1 text-center">
                                <BizBadgeWithCount state={biz} shortCount={ss.short} />
                              </td>
                              <td className="px-2 py-1 text-center">
                                <SourceBadge source={o.source} />
                                {o.note?.includes("【医院修正】") && <ClinicEditBadge />}
                              </td>
                              <td className="px-2 py-1 font-mono text-[11px] text-gray-600">{o.delivery_number || o.id.slice(0, 8)}</td>
                              <td className="px-2 py-1 text-[11px] text-gray-500">{new Date(o.created_at).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                              <td className="px-2 py-1 text-right text-[12px] font-bold">{fmtYen(o.total_price || 0)}</td>
                              <td className="px-2 py-1 text-center whitespace-nowrap">
                                <button onClick={() => toggleOrderOpen(o.id)} className="text-[11px] px-1.5 py-0.5 rounded border border-gray-200 hover:bg-gray-50 mr-1" title="明細を開閉">{isOpen ? "−" : "+"}</button>
                                <Link href={`/order-edit/${o.id}`}><button className="text-[11px] px-1.5 py-0.5 rounded border border-gray-200 hover:bg-gray-50 mr-1" title="編集">編</button></Link>
                                {/* 出荷可能なら「納品」ボタン目立つ表示 */}
                                {biz === "ready" && (
                                  <Link href={`/admin/shipping?orders=${o.id}`}>
                                    <button className="text-[11px] px-2 py-0.5 rounded bg-emerald-600 text-white font-bold hover:bg-emerald-700 mr-1" title="出荷準備画面で納品書発行">→納品</button>
                                  </Link>
                                )}
                                <Link href={`/admin/orders/new?copy=${o.id}`}><button className="text-[11px] px-1.5 py-0.5 rounded border border-gray-200 hover:bg-blue-50 text-blue-700 mr-1" title="この注文を複製">📋</button></Link>
                                <Link href={`/admin/quotes/create?from_order=${o.id}`}><button className="text-[11px] px-1.5 py-0.5 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 mr-1" title="見積書発行">見積</button></Link>
                                {ss.short > 0 && (
                                  <button
                                    onClick={() => addToPool([o.id])}
                                    className="text-[11px] px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 mr-1"
                                    title="不足分を発注プールに追加">プール</button>
                                )}
                                <button onClick={() => deleteOrder(o.id, o.delivery_number)} className="text-[11px] px-1.5 py-0.5 rounded border border-red-200 bg-red-50 text-red-700 hover:bg-red-100" title="この注文を削除（納品済みは強い警告あり）">🗑</button>
                              </td>
                            </tr>
                            {isOpen && (
                              <tr key={o.id + "-d"} className="bg-yellow-50">
                                <td colSpan={8} className="px-4 py-2">
                                  {items.length === 0 ? <p className="text-[11px] text-gray-400">明細なし</p> : (
                                    <table className="w-full text-[11px]">
                                      <thead className="text-[12px] text-gray-500">
                                        <tr>
                                          <th className="text-left px-1 py-0.5 w-16">在庫</th>
                                          <th className="text-left px-1 py-0.5">商品名</th>
                                          <th className="text-right px-1 py-0.5 w-12">数量</th>
                                          <th className="text-right px-1 py-0.5 w-20">仕入</th>
                                          <th className="text-right px-1 py-0.5 w-20">定価</th>
                                          <th className="text-right px-1 py-0.5 w-24">販売価格</th>
                                          <th className="text-right px-1 py-0.5 w-20">粗利</th>
                                          <th className="text-right px-1 py-0.5 w-14">粗利%</th>
                                          <th className="text-right px-1 py-0.5 w-24">小計</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {items.map((it) => {
                                          const p = it.product_id ? productById.get(it.product_id) : null
                                          const stock = Number(p?.stock || 0)
                                          const enough = stock >= Number(it.quantity || 0)
                                          const cost = Number(p?.cost || 0)
                                          const listPrice = Number(p?.price || 0)
                                          const sellPrice = Number(it.price || 0)
                                          const qty = Number(it.quantity || 0)
                                          const lineSubtotal = sellPrice * qty
                                          const lineCost = cost * qty
                                          const gross = sellPrice - cost
                                          const grossRate = sellPrice > 0 ? Math.round(gross / sellPrice * 1000) / 10 : 0
                                          return (
                                            <tr key={it.id} className="border-b border-gray-100">
                                              <td className="px-1 py-0.5">
                                                <span className={"text-[11px] font-bold px-1 py-0.5 rounded " + (enough ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
                                                  {enough ? "OK" : `0`}
                                                </span>
                                              </td>
                                              <td className="px-1 py-0.5">{it.product_name || "(不明)"}</td>
                                              <td className="px-1 py-0.5 text-right tabular-nums">{qty}</td>
                                              <td className="px-1 py-0.5 text-right tabular-nums text-gray-500">{fmtYen(cost)}</td>
                                              <td className="px-1 py-0.5 text-right tabular-nums text-gray-500">{fmtYen(listPrice)}</td>
                                              <td className="px-1 py-0.5 text-right tabular-nums font-bold">{fmtYen(sellPrice)}</td>
                                              <td className={"px-1 py-0.5 text-right tabular-nums " + (gross >= 0 ? "text-gray-700" : "text-red-600 font-bold")}>{fmtYen(gross)}</td>
                                              <td className={"px-1 py-0.5 text-right tabular-nums " + (grossRate < 20 && cost > 0 ? "text-red-600 font-bold" : "text-gray-500")}>{cost > 0 ? `${grossRate}%` : "—"}</td>
                                              <td className="px-1 py-0.5 text-right tabular-nums font-bold">{fmtYen(lineSubtotal)}</td>
                                            </tr>
                                          )
                                        })}
                                      </tbody>
                                    </table>
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
                <th className="px-2 py-1.5 text-center w-32">業務状態</th>
                <th className="px-2 py-1.5 text-center w-16">経路</th>
                <th className="px-2 py-1.5 text-left w-28">納品書No</th>
                <th className="px-2 py-1.5 text-left">医院</th>
                <th className="px-2 py-1.5 text-left w-28">日付</th>
                <th className="px-2 py-1.5 text-right w-24">金額</th>
                <th className="px-2 py-1.5 text-left w-36">備考</th>
                <th className="px-2 py-1.5 text-center w-40">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">該当注文なし</td></tr>
              ) : filtered.map((o, i) => {
                const sc = STATUS_COLORS[o.status] || STATUS_COLORS["キャンセル"]
                const items = itemsByOrder.get(o.id) || []
                const open = openOrderIds.has(o.id)
                const ss = stockState(o.id)
                const biz = businessState(o.id)
                return (
                  <>
                    <tr key={o.id} className={"border-b border-gray-100 " + (selectedOrderIds.has(o.id) ? "bg-blue-100" : i % 2 === 0 ? "" : "bg-gray-50/30")}>
                      <td className="px-2 py-1 text-center">
                        <input type="checkbox" checked={selectedOrderIds.has(o.id)} onChange={() => toggleSelect(o.id)} />
                      </td>
                      <td className="px-1 py-0.5">
                        <select value={o.status} onChange={(e) => updateStatus(o.id, e.target.value)} className="px-1.5 py-0.5 rounded text-[11px] font-bold border-0 cursor-pointer w-full" style={{ background: sc.bg, color: sc.color }}>
                          {STATUSES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1 text-center">
                        <BizBadgeWithCount state={biz} shortCount={ss.short} />
                      </td>
                      <td className="px-2 py-1 text-center">
                        <SourceBadge source={o.source} />
                        {o.note?.includes("【医院修正】") && <ClinicEditBadge />}
                      </td>
                      <td className="px-2 py-1 font-mono text-[11px] text-gray-600">{o.delivery_number || o.id.slice(0, 8)}</td>
                      <td className="px-2 py-1">{clinicById.get(o.clinic_id)?.name || "—"}</td>
                      <td className="px-2 py-1 text-[11px] text-gray-500">{new Date(o.created_at).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="px-2 py-1 text-right text-[12px] font-bold">{fmtYen(o.total_price || 0)}</td>
                      <td className="px-2 py-1 text-[11px] text-gray-500 max-w-[140px]">
                        {o.note ? <span className="bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded text-[11px]" title={o.note}>{o.note.length > 20 ? o.note.slice(0, 20) + "…" : o.note}</span> : ""}
                      </td>
                      <td className="px-2 py-1 text-center whitespace-nowrap">
                        <button onClick={() => toggleOrderOpen(o.id)} className="text-[11px] px-1.5 py-0.5 rounded border border-gray-200 hover:bg-gray-50 mr-1">{open ? "−" : "+"}</button>
                        <Link href={`/order-edit/${o.id}`}><button className="text-[11px] px-1.5 py-0.5 rounded border border-gray-200 hover:bg-gray-50 mr-1">編</button></Link>
                        {biz === "ready" && (
                          <Link href={`/admin/shipping?orders=${o.id}`}>
                            <button className="text-[11px] px-2 py-0.5 rounded bg-emerald-600 text-white font-bold hover:bg-emerald-700 mr-1" title="出荷準備画面で納品書発行">→納品</button>
                          </Link>
                        )}
                        <Link href={`/admin/orders/new?copy=${o.id}`}><button className="text-[11px] px-1.5 py-0.5 rounded border border-gray-200 hover:bg-blue-50 text-blue-700 mr-1" title="この注文を複製">📋</button></Link>
                        <Link href={`/admin/quotes/create?from_order=${o.id}`}><button className="text-[11px] px-1.5 py-0.5 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 mr-1" title="見積書発行">見積</button></Link>
                        {ss.short > 0 && (
                          <button
                            onClick={() => addToPool([o.id])}
                            className="text-[11px] px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 mr-1"
                            title="不足分を発注プールに追加">プール</button>
                        )}
                        {!["納品済み", "納品済"].includes(o.status) && (
                          <button onClick={() => deleteOrder(o.id, o.delivery_number)} className="text-[11px] px-1.5 py-0.5 rounded border border-red-200 bg-red-50 text-red-700 hover:bg-red-100" title="この注文を削除">🗑</button>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr key={o.id + "-d"} className="bg-yellow-50">
                        <td colSpan={9} className="px-4 py-2">
                          {items.length === 0 ? <p className="text-[11px] text-gray-400">明細なし</p> : (
                            <table className="w-full text-[11px]">
                              <thead className="text-[12px] text-gray-500">
                                <tr>
                                  <th className="text-left px-1 py-0.5 w-16">在庫</th>
                                  <th className="text-left px-1 py-0.5">商品名</th>
                                  <th className="text-right px-1 py-0.5 w-12">数量</th>
                                  <th className="text-right px-1 py-0.5 w-20">仕入</th>
                                  <th className="text-right px-1 py-0.5 w-20">定価</th>
                                  <th className="text-right px-1 py-0.5 w-24">販売価格</th>
                                  <th className="text-right px-1 py-0.5 w-20">粗利</th>
                                  <th className="text-right px-1 py-0.5 w-14">粗利%</th>
                                  <th className="text-right px-1 py-0.5 w-24">小計</th>
                                </tr>
                              </thead>
                              <tbody>
                              {items.map((it) => {
                                const p = it.product_id ? productById.get(it.product_id) : null
                                const stock = Number(p?.stock || 0)
                                const enough = stock >= Number(it.quantity || 0)
                                const cost = Number(p?.cost || 0)
                                const listPrice = Number(p?.price || 0)
                                const sellPrice = Number(it.price || 0)
                                const qty = Number(it.quantity || 0)
                                const lineSubtotal = sellPrice * qty
                                const gross = sellPrice - cost
                                const grossRate = sellPrice > 0 ? Math.round(gross / sellPrice * 1000) / 10 : 0
                                return (
                                  <tr key={it.id} className="border-b border-gray-100">
                                    <td className="px-1 py-0.5">
                                      <span className={"text-[11px] font-bold px-1 py-0.5 rounded " + (enough ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
                                        {enough ? "OK" : `0`}
                                      </span>
                                    </td>
                                    <td className="px-1 py-0.5">{it.product_name || "(不明)"}</td>
                                    <td className="px-1 py-0.5 text-right tabular-nums">{qty}</td>
                                    <td className="px-1 py-0.5 text-right tabular-nums text-gray-500">{fmtYen(cost)}</td>
                                    <td className="px-1 py-0.5 text-right tabular-nums text-gray-500">{fmtYen(listPrice)}</td>
                                    <td className="px-1 py-0.5 text-right tabular-nums font-bold">{fmtYen(sellPrice)}</td>
                                    <td className={"px-1 py-0.5 text-right tabular-nums " + (gross >= 0 ? "text-gray-700" : "text-red-600 font-bold")}>{fmtYen(gross)}</td>
                                    <td className={"px-1 py-0.5 text-right tabular-nums " + (grossRate < 20 && cost > 0 ? "text-red-600 font-bold" : "text-gray-500")}>{cost > 0 ? `${grossRate}%` : "—"}</td>
                                    <td className="px-1 py-0.5 text-right tabular-nums font-bold">{fmtYen(lineSubtotal)}</td>
                                  </tr>
                                )
                              })}
                              </tbody>
                            </table>
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
      </GroupViewTabs>

      {/* 仕入先未設定商品のフォールバック選択モーダル */}
      {fallbackPickerOrderIds && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => { setFallbackPickerOrderIds(null); setFallbackProducts([]); setSupplierSearch("") }}>
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900">⚠️ 仕入先が未設定の商品</h3>
              <p className="text-xs text-gray-600 mt-1">
                以下 {fallbackProducts.length}品 の仕入先がマスタに登録されていません。<br />
                どの仕入先の発注プールに追加しますか？
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <div className="bg-gray-50 rounded p-2 mb-3 text-xs max-h-32 overflow-auto">
                {fallbackProducts.map(p => (
                  <div key={p.product_id} className="py-0.5 flex justify-between border-b border-gray-100 last:border-0">
                    <span>{p.product_name}</span>
                    <span className="text-gray-500">×{p.quantity}</span>
                  </div>
                ))}
              </div>

              {/* 検索 */}
              <div className="mb-2">
                <input
                  autoFocus
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  placeholder="仕入先名・メーカー名で検索（カナ/半角全角OK）"
                  className="w-full px-3 py-2 border border-gray-200 rounded text-sm"
                />
              </div>

              {(() => {
                // 検索キー正規化
                const searchKeyOf = (s: string) => {
                  const nfkc = String(s || "").normalize("NFKC").toLowerCase()
                  return nfkc.replace(/[ぁ-ん]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))
                }
                const k = searchKeyOf(supplierSearch)
                // メイン仕入先（部分一致でピン留め）
                const PINNED = ["リンク", "バイオデント", "フォレストワン", "TP", "CI"]
                const isPinned = (name: string) => PINNED.some(p => name.includes(p))
                const filtered = !k ? allSuppliers : allSuppliers.filter(s => searchKeyOf(s.name).includes(k))
                const pinned = filtered.filter(s => isPinned(s.name))
                const others = filtered.filter(s => !isPinned(s.name))
                const onClick = async (sId: string) => {
                  const ids = fallbackPickerOrderIds
                  setFallbackPickerOrderIds(null)
                  setFallbackProducts([])
                  setSupplierSearch("")
                  await addToPool(ids!, sId)
                }
                const SupBtn = ({ s, highlight }: { s: { id: string; name: string }; highlight?: boolean }) => (
                  <button onClick={() => onClick(s.id)}
                    className={"text-left px-3 py-2 border rounded text-sm transition-colors " +
                      (highlight ? "border-emerald-300 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-400 font-bold"
                        : "border-gray-200 hover:bg-blue-50 hover:border-blue-300")}>
                    {highlight && "⭐ "}{s.name}
                  </button>
                )
                return (
                  <>
                    {pinned.length > 0 && (
                      <div className="mb-3">
                        <p className="text-[11px] text-emerald-700 font-bold mb-1">⭐ メイン仕入先</p>
                        <div className="grid grid-cols-2 gap-2">
                          {pinned.map(s => <SupBtn key={s.id} s={s} highlight />)}
                        </div>
                      </div>
                    )}
                    {others.length > 0 && (
                      <div>
                        {pinned.length > 0 && <p className="text-[11px] text-gray-500 mb-1">その他 {others.length}社</p>}
                        <div className="grid grid-cols-2 gap-2 max-h-72 overflow-auto">
                          {others.map(s => <SupBtn key={s.id} s={s} />)}
                        </div>
                      </div>
                    )}
                    {filtered.length === 0 && (
                      <p className="text-center text-gray-400 text-sm py-4">該当する仕入先なし</p>
                    )}
                  </>
                )
              })()}
            </div>
            <div className="p-3 border-t border-gray-100 flex items-center justify-between">
              <Link href="/admin/products" className="text-xs text-gray-500 underline">商品マスタで仕入先を設定する →</Link>
              <button onClick={() => { setFallbackPickerOrderIds(null); setFallbackProducts([]); setSupplierSearch("") }}
                className="text-xs text-gray-500 underline">スキップ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
