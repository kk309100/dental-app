"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { GroupViewTabs, useGroupView, type GroupableRow } from "@/app/components/GroupViewTabs"

type Order = { id: string; clinic_id: string; status: string; created_at: string; total_price: number; delivery_number: string | null; sales_rep?: string | null; note?: string | null }
type OrderItem = { id: string; order_id: string; product_id: string | null; product_name: string | null; quantity: number; price: number }
type Product = { id: string; name: string; stock: number | null; location: string | null; cost: number | null; price: number | null }
type Clinic = { id: string; name: string; corporate_name?: string | null; sales_rep?: string | null }

// 出荷準備対象 = 納品済み・キャンセル以外すべて（status 値の表記ゆれを吸収）
// PostgREST の .not("status","in",...) は日本語値で構文エラーになるため
// 全件取得 → クライアント側で EXCLUDE_STATUSES を除外する方式に変更
const EXCLUDE_STATUSES = ["納品済み", "納品済", "キャンセル", "取消"]

export default function ShippingPageWrapper() {
  return (
    <Suspense fallback={<p className="text-gray-400 text-center py-12">読み込み中…</p>}>
      <ShippingPage />
    </Suspense>
  )
}

function ShippingPage() {
  const router = useRouter()
  const sp = useSearchParams()
  // 仕入入荷ページから渡された「事前選択する注文ID」(カンマ区切り)
  const presetOrderIds = useMemo(() => {
    const param = sp.get("orders") || ""
    return param.split(",").map(s => s.trim()).filter(Boolean)
  }, [sp])

  const [orders, setOrders] = useState<Order[]>([])
  const [items, setItems] = useState<OrderItem[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openClinics, setOpenClinics] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState("")
  const [stockFilter, setStockFilter] = useState<"all" | "ready" | "short">("all")
  const [busy, setBusy] = useState(false)
  const [groupView, setGroupView] = useGroupView()
  const [highlightFromReceiving, setHighlightFromReceiving] = useState(false)

  useEffect(() => { fetchData() }, [])

  // データ読込後、URL クエリで指定された注文IDを事前選択 + その医院グループを開く
  useEffect(() => {
    if (loading || presetOrderIds.length === 0 || orders.length === 0) return
    const validIds = presetOrderIds.filter(id => orders.some(o => o.id === id))
    if (validIds.length === 0) return
    setSelected(new Set(validIds))
    // 該当注文の医院グループを自動展開
    const clinicIdsToOpen = new Set(orders.filter(o => validIds.includes(o.id)).map(o => o.clinic_id))
    setOpenClinics(prev => { const n = new Set(prev); clinicIdsToOpen.forEach(c => n.add(c)); return n })
    setHighlightFromReceiving(true)
  }, [loading, orders, presetOrderIds])

  async function fetchData() {
    setLoading(true)
    const [o, i, p, c] = await Promise.all([
      // 全件取得 → クライアント側で EXCLUDE_STATUSES を除外（PostgREST .not in は日本語値で壊れる + 表記ゆれ吸収）
      supabase.from("orders").select("id,clinic_id,status,created_at,total_price,delivery_number,sales_rep,note").order("created_at").limit(50000),
      supabase.from("order_items").select("id,order_id,product_id,product_name,quantity,price").limit(50000),
      supabase.from("products").select("id,name,stock,location,cost,price").limit(50000),
      supabase.from("clinics").select("id,name,corporate_name,sales_rep").limit(50000),
    ])
    const allOrders = (o.data as Order[]) || []
    const activeOrders = allOrders.filter(x => !EXCLUDE_STATUSES.includes(x.status))
    setOrders(activeOrders)
    const orderIds = new Set(activeOrders.map(x => x.id))
    setItems(((i.data as OrderItem[]) || []).filter(x => orderIds.has(x.order_id)))
    setProducts((p.data as Product[]) || [])
    setClinics((c.data as Clinic[]) || [])
    setLoading(false)
  }

  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const clinicById = useMemo(() => new Map(clinics.map(c => [c.id, c])), [clinics])
  const itemsByOrder = useMemo(() => {
    const m = new Map<string, OrderItem[]>()
    items.forEach(it => {
      if (!m.has(it.order_id)) m.set(it.order_id, [])
      m.get(it.order_id)!.push(it)
    })
    return m
  }, [items])

  // 注文単位で「出荷可能か」判定
  function orderReadiness(order: Order) {
    const its = itemsByOrder.get(order.id) || []
    let allOk = true
    let anyOk = false
    for (const it of its) {
      if (!it.product_id) { allOk = false; continue }
      const stock = Number(productById.get(it.product_id)?.stock || 0)
      if (stock >= Number(it.quantity)) anyOk = true
      else allOk = false
    }
    return allOk ? "ready" : (anyOk ? "partial" : "short")
  }

  // 医院ごとにグルーピング
  const byClinic = useMemo(() => {
    const m = new Map<string, Order[]>()
    orders.forEach(o => {
      if (!m.has(o.clinic_id)) m.set(o.clinic_id, [])
      m.get(o.clinic_id)!.push(o)
    })
    return Array.from(m.entries())
      .map(([cid, ords]) => ({
        clinic: clinicById.get(cid) || { id: cid, name: "(医院不明)" } as Clinic,
        orders: ords,
      }))
      .filter(g => {
        if (!search) return true
        const k = search.toLowerCase().normalize("NFKC")
        return g.clinic.name.normalize("NFKC").toLowerCase().includes(k)
      })
      .filter(g => {
        if (stockFilter === "all") return true
        const states = g.orders.map(orderReadiness)
        if (stockFilter === "ready") return states.some(s => s === "ready")
        if (stockFilter === "short") return states.some(s => s !== "ready")
        return true
      })
      .sort((a, b) => a.clinic.name.localeCompare(b.clinic.name, "ja"))
  }, [orders, clinicById, itemsByOrder, productById, search, stockFilter])

  function toggleSelect(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  function toggleClinicSelect(orderIds: string[]) {
    setSelected(prev => {
      const n = new Set(prev)
      const allIn = orderIds.every(id => n.has(id))
      if (allIn) orderIds.forEach(id => n.delete(id))
      else orderIds.forEach(id => n.add(id))
      return n
    })
  }

  function toggleClinicOpen(cid: string) {
    setOpenClinics(prev => {
      const n = new Set(prev)
      if (n.has(cid)) n.delete(cid); else n.add(cid)
      return n
    })
  }

  // 出荷確定: 選択した注文を「納品済」に変更 + 在庫減算 + 納品書スリップ作成
  async function confirmShipment() {
    if (selected.size === 0) return
    const orderList = orders.filter(o => selected.has(o.id))
    if (orderList.length === 0) return

    // 医院ごとにスリップ作成
    const byCl = new Map<string, Order[]>()
    orderList.forEach(o => {
      if (!byCl.has(o.clinic_id)) byCl.set(o.clinic_id, [])
      byCl.get(o.clinic_id)!.push(o)
    })

    if (!confirm(`${orderList.length}件の注文（${byCl.size}医院）を出荷確定します。\n・納品書を医院ごとに作成\n・在庫を自動減算\n・ステータスを納品済みに変更\n\n続行しますか？`)) return

    setBusy(true)
    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)
    const createdSlipIds: string[] = []

    for (const [clinicId, ords] of byCl.entries()) {
      const totalAmount = ords.reduce((s, o) => s + Number(o.total_price || 0), 0)
      // スリップ番号採番
      const { data: existing } = await supabase.from("delivery_slips").select("id").gte("delivered_on", todayStr).lte("delivered_on", todayStr)
      const seq = (existing?.length || 0) + createdSlipIds.length + 1
      const slipNo = `DS-${todayStr.replace(/-/g, "")}-${String(seq).padStart(4, "0")}`

      // 1) スリップ作成（テーブル無い時はスキップ）
      let slipId: string | null = null
      try {
        const { data: slip, error: e1 } = await supabase.from("delivery_slips").insert({
          slip_number: slipNo,
          clinic_id: clinicId,
          delivered_on: todayStr,
          total_amount: totalAmount,
          status: "出荷済",
          shipped_at: today.toISOString(),
        }).select().single()
        if (!e1 && slip) { slipId = slip.id; createdSlipIds.push(slip.id) }
      } catch { /* テーブル未作成 */ }

      // 2) 注文を納品済みに + slip_id を紐付け
      const updPayload: Record<string, unknown> = {
        status: "納品済み",
        delivered_at: today.toISOString(),
      }
      if (slipId) updPayload.delivery_slip_id = slipId
      let updErr = (await supabase.from("orders").update(updPayload).in("id", ords.map(o => o.id))).error
      if (updErr) {
        // 新スキーマ列なしフォールバック
        await supabase.from("orders").update({ status: "納品済み" }).in("id", ords.map(o => o.id))
      }

      // 3) 在庫減算 + stock_movements
      const orderIds = ords.map(o => o.id)
      const itsToShip = items.filter(it => orderIds.includes(it.order_id))
      for (const it of itsToShip) {
        if (!it.product_id) continue
        const before = Number(productById.get(it.product_id)?.stock || 0)
        const after = before - Number(it.quantity)
        await supabase.from("products").update({ stock: after }).eq("id", it.product_id)
        try {
          await supabase.from("stock_movements").insert({
            product_id: it.product_id,
            movement_type: "出庫",
            quantity: -Number(it.quantity),
            before_stock: before,
            after_stock: after,
            ref_type: "order_item",
            ref_id: it.id,
            reason: slipNo,
          })
        } catch { /* テーブル無くてもスキップ */ }
      }
    }

    setBusy(false)
    setSelected(new Set())
    alert(`✅ 出荷確定完了: ${orderList.length}件の注文を「納品済み」にしました（納品書 ${createdSlipIds.length}枚作成）`)
    fetchData()
  }

  // ピッキングリスト印刷（棚番号順）
  function printPickingList() {
    if (selected.size === 0) { alert("出荷する注文を選択してください"); return }
    window.print()
  }

  // ⚠️ フックは early return の前に必ず呼ぶ（React Rules of Hooks）
  const selectedOrders = useMemo(() => orders.filter(o => selected.has(o.id)), [orders, selected])
  const selectedItems = useMemo(() => items.filter(it => selected.has(it.order_id)), [items, selected])

  // GroupViewTabs 用の行データ（フィルタ後の orders を使う）
  const filteredOrdersForGroup = useMemo(() => byClinic.flatMap(g => g.orders), [byClinic])
  const groupRows: GroupableRow[] = useMemo(() => filteredOrdersForGroup.map(o => ({
    id: o.id,
    date: (o.created_at || "").slice(0, 10),
    party: clinicById.get(o.clinic_id)?.name || "(医院不明)",
    amount: Number(o.total_price || 0),
    items: (itemsByOrder.get(o.id) || []).map(it => ({
      name: it.product_name || "(不明)",
      quantity: Number(it.quantity || 0),
      price: Number(it.price || 0),
    })),
  })), [filteredOrdersForGroup, clinicById, itemsByOrder])
  // ピッキングリスト用: 棚番号順に集約
  const pickList = useMemo(() => {
    const m = new Map<string, { product_id: string; name: string; location: string; qty: number; clinics: Set<string> }>()
    selectedItems.forEach(it => {
      const p = it.product_id ? productById.get(it.product_id) : null
      const key = it.product_id || it.product_name || "?"
      const e = m.get(key) || { product_id: it.product_id || "", name: it.product_name || p?.name || "(不明)", location: p?.location || "", qty: 0, clinics: new Set() }
      e.qty += Number(it.quantity || 0)
      const o = orders.find(x => x.id === it.order_id)
      if (o) {
        const cl = clinicById.get(o.clinic_id)
        if (cl) e.clinics.add(cl.name)
      }
      m.set(key, e)
    })
    return Array.from(m.values()).sort((a, b) => (a.location || "zzz").localeCompare(b.location || "zzz"))
  }, [selectedItems, productById, orders, clinicById])

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center flex-wrap gap-2 no-print">
        <h1 className="text-lg font-bold text-gray-900">
          🚚 医院納品（出荷準備→納品書発行）
          <span className="ml-2 text-xs font-normal text-gray-400">医院への出荷準備・在庫減算・納品書発行</span>
        </h1>
        <Link href="/admin/deliveries"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-blue-700 bg-blue-100 hover:bg-blue-200 transition-colors"
          title="過去の納品書一覧">
          📋 納品書一覧
        </Link>
        <Link href="/admin/orders" className="text-xs text-gray-500 underline">← 注文一覧</Link>
      </div>

      {/* 仕入入荷から遷移してきた時の通知バナー */}
      {highlightFromReceiving && presetOrderIds.length > 0 && (
        <div className="bg-emerald-50 rounded-lg p-3 flex items-center gap-3 no-print" style={{ border: "2px solid #10b981" }}>
          <span className="text-2xl">📦→🚚</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-emerald-900">
              仕入入荷で出荷可能になった注文 {selected.size}件 を選択しました
            </p>
            <p className="text-[11px] text-emerald-700 mt-0.5">
              下に該当医院グループが自動展開されています。「✓ 出荷確定」ボタンで一括処理できます。
            </p>
          </div>
          <button
            onClick={() => { setHighlightFromReceiving(false); setSelected(new Set()); router.replace("/admin/shipping") }}
            className="text-xs text-gray-500 underline">通常表示に戻す</button>
        </div>
      )}

      <div className="flex gap-1.5 items-center bg-gray-50 p-2 rounded-lg flex-wrap no-print" style={{ border: "1px solid #e8eaed" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="医院名で検索"
          className="flex-1 min-w-[180px] px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <select value={stockFilter} onChange={e => setStockFilter(e.target.value as typeof stockFilter)}
          className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="all">在庫状態すべて</option>
          <option value="ready">🟢 出荷可能のみ</option>
          <option value="short">🟡 在庫不足含む</option>
        </select>
      </div>

      {selected.size > 0 && (
        <div className="bg-blue-50 rounded-lg p-3 flex items-center gap-3 flex-wrap no-print sticky top-14 z-20" style={{ border: "1px solid #c7d2fe" }}>
          <span className="text-sm font-bold text-blue-900">{selected.size}件 / {selectedItems.length}行 選択中</span>
          <button onClick={printPickingList}
            className="text-xs px-3 py-1.5 bg-white border border-blue-200 text-blue-700 rounded hover:bg-blue-50">🖨 ピッキングリスト印刷</button>
          <button onClick={confirmShipment} disabled={busy}
            className="text-xs px-4 py-1.5 bg-emerald-600 text-white font-bold rounded hover:bg-emerald-700 disabled:bg-gray-400">
            {busy ? "処理中…" : "✓ 出荷確定（納品書発行＋在庫減算＋納品済）"}
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-gray-500 underline">選択解除</button>
        </div>
      )}

      <div className="no-print">
      <GroupViewTabs value={groupView} onChange={setGroupView} rows={groupRows} partyLabel="医院">
      {/* 通常表示: 医院別グループ */}
      <div className="space-y-2">
        {byClinic.length === 0 ? (
          <p className="text-center py-12 text-gray-400">出荷予定の注文はありません 🎉</p>
        ) : byClinic.map(g => {
          const ordIds = g.orders.map(o => o.id)
          const allSel = ordIds.every(id => selected.has(id))
          const someSel = ordIds.some(id => selected.has(id))
          const isOpen = openClinics.has(g.clinic.id)
          const totalAmount = g.orders.reduce((s, o) => s + Number(o.total_price || 0), 0)
          const states = g.orders.map(orderReadiness)
          const readyCount = states.filter(s => s === "ready").length
          const shortCount = states.filter(s => s === "short").length
          return (
            <div key={g.clinic.id} className="bg-white rounded-lg overflow-hidden" style={{ border: "1px solid #e8eaed" }}>
              <div className="flex items-center px-3 py-2 bg-gray-50 border-b border-gray-100 cursor-pointer hover:bg-gray-100"
                onClick={() => toggleClinicOpen(g.clinic.id)}>
                <input type="checkbox" checked={allSel} ref={el => { if (el) el.indeterminate = !allSel && someSel }}
                  onClick={e => e.stopPropagation()} onChange={() => toggleClinicSelect(ordIds)}
                  className="mr-3" />
                <span className="text-sm font-bold text-gray-900">{isOpen ? "▼" : "▶"} {g.clinic.name}</span>
                <span className="ml-2 text-xs text-gray-500">{g.orders.length}注文</span>
                {readyCount > 0 && <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">🟢 出荷可 {readyCount}</span>}
                {shortCount > 0 && <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800">🟡 不足 {shortCount}</span>}
                <span className="ml-auto text-sm font-bold text-gray-900 tabular-nums">{fmtYen(totalAmount)}</span>
              </div>
              {isOpen && (
                <div className="divide-y divide-gray-100">
                  {g.orders.map(o => {
                    const its = itemsByOrder.get(o.id) || []
                    const ready = orderReadiness(o)
                    return (
                      <div key={o.id} className="px-3 py-2">
                        <div className="flex items-center gap-2 mb-1">
                          <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggleSelect(o.id)} />
                          <span className="text-xs text-gray-500 font-mono">{o.delivery_number || o.id.slice(0, 8)}</span>
                          <span className="text-[10px] text-gray-400">{new Date(o.created_at).toLocaleDateString("ja-JP")}</span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded"
                            style={{ background: o.status === "注文受付" ? "#fef3c7" : o.status === "確認中" ? "#dbeafe" : "#e0e7ff", color: o.status === "注文受付" ? "#92400e" : o.status === "確認中" ? "#1e40af" : "#3730a3" }}>
                            {o.status}
                          </span>
                          {o.sales_rep && <span className="text-[10px] text-gray-500">担当: {o.sales_rep}</span>}
                          {o.note && <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 rounded">📝 {o.note}</span>}
                          <span className={"text-[10px] font-bold px-2 py-0.5 rounded ml-auto " + (ready === "ready" ? "bg-emerald-100 text-emerald-700" : ready === "partial" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700")}>
                            {ready === "ready" ? "🟢 出荷OK" : ready === "partial" ? "🟡 一部不足" : "🔴 在庫不足"}
                          </span>
                          <span className="text-xs font-bold tabular-nums">{fmtYen(o.total_price)}</span>
                        </div>
                        <div className="ml-6">
                          {/* ヘッダ */}
                          <div className="flex items-center text-[10px] py-0.5 text-gray-500 border-b border-gray-200">
                            <span className="w-12">棚</span>
                            <span className="flex-1">商品名</span>
                            <span className="w-12 text-right">数量</span>
                            <span className="w-20 text-right">仕入</span>
                            <span className="w-20 text-right">定価</span>
                            <span className="w-24 text-right">販売価格</span>
                            <span className="w-16 text-right">粗利</span>
                            <span className="w-12 text-right">粗利%</span>
                            <span className="w-24 text-right">小計</span>
                            <span className="w-12 text-right">在庫</span>
                          </div>
                          {its.map(it => {
                            const product = it.product_id ? productById.get(it.product_id) : null
                            const stock = Number(product?.stock || 0)
                            const enough = stock >= Number(it.quantity)
                            const loc = product?.location || null
                            const cost = Number((product as any)?.cost || 0)
                            const listPrice = Number((product as any)?.price || 0)
                            const sellPrice = Number(it.price || 0)
                            const qty = Number(it.quantity)
                            const lineSubtotal = sellPrice * qty
                            const gross = sellPrice - cost
                            const grossRate = sellPrice > 0 ? Math.round(gross / sellPrice * 1000) / 10 : 0
                            const noPrice = sellPrice === 0
                            // 共通: 注文の total_price を DB から再計算
                            const recalcTotal = async () => {
                              const { data: latest } = await supabase
                                .from("order_items").select("price,quantity")
                                .eq("order_id", o.id).limit(1000)
                              const sum = (latest || []).reduce((s, x) => s + Number(x.price || 0) * Number(x.quantity || 0), 0)
                              await supabase.from("orders").update({ total_price: sum }).eq("id", o.id)
                            }
                            // 共通: 販売価格を更新 + 再計算
                            const updateSellPrice = async (newPrice: number) => {
                              if (newPrice < 0 || newPrice === sellPrice) return
                              await supabase.from("order_items").update({ price: newPrice }).eq("id", it.id)
                              await recalcTotal()
                              fetchData()
                            }
                            return (
                              <div key={it.id} className={"flex items-center text-[11px] py-0.5 gap-0.5 " + (noPrice ? "bg-amber-50" : "")}>
                                <span className="font-mono text-gray-500 w-12 text-[10px]">{loc ? `[${loc}]` : ""}</span>
                                <span className="flex-1 truncate">{it.product_name || "(商品名なし)"}</span>
                                {/* 数量 */}
                                <input type="number" defaultValue={qty}
                                  onBlur={async (e) => {
                                    const v = Number(e.target.value)
                                    if (v > 0 && v !== qty) {
                                      await supabase.from("order_items").update({ quantity: v }).eq("id", it.id)
                                      await recalcTotal()
                                      fetchData()
                                    }
                                  }}
                                  className="w-12 text-right tabular-nums px-1 py-0.5 border border-gray-200 rounded text-[11px] bg-white" />
                                {/* 仕入（products.cost マスタ更新）*/}
                                <input type="number" defaultValue={cost}
                                  disabled={!it.product_id}
                                  onBlur={async (e) => {
                                    const v = Number(e.target.value)
                                    if (v >= 0 && v !== cost && it.product_id) {
                                      await supabase.from("products").update({ cost: v }).eq("id", it.product_id)
                                      fetchData()
                                    }
                                  }}
                                  className="w-20 text-right tabular-nums px-1 py-0.5 border border-gray-200 rounded text-[10px] text-gray-600 bg-gray-50 disabled:opacity-50"
                                  title="仕入価格（商品マスタを更新）" />
                                {/* 定価（products.price マスタ更新） */}
                                <input type="number" defaultValue={listPrice}
                                  disabled={!it.product_id}
                                  onBlur={async (e) => {
                                    const v = Number(e.target.value)
                                    if (v >= 0 && v !== listPrice && it.product_id) {
                                      await supabase.from("products").update({ price: v }).eq("id", it.product_id)
                                      fetchData()
                                    }
                                  }}
                                  className="w-20 text-right tabular-nums px-1 py-0.5 border border-gray-200 rounded text-[10px] text-gray-600 bg-gray-50 disabled:opacity-50"
                                  title="定価（商品マスタを更新）" />
                                {/* 販売価格 */}
                                <input type="number" defaultValue={sellPrice}
                                  onBlur={(e) => updateSellPrice(Number(e.target.value))}
                                  className={"w-24 text-right tabular-nums px-1 py-0.5 border rounded text-[11px] font-bold " + (noPrice ? "border-amber-400 bg-amber-50" : "border-blue-300 bg-blue-50")}
                                  title="販売価格（明細だけに反映）" />
                                {/* 粗利（編集すると 販売価格 = 仕入 + 粗利 で逆算）*/}
                                <input type="number" defaultValue={gross}
                                  onBlur={(e) => {
                                    const v = Number(e.target.value)
                                    const newPrice = cost + v
                                    if (newPrice >= 0) updateSellPrice(newPrice)
                                  }}
                                  className={"w-16 text-right tabular-nums px-1 py-0.5 border border-gray-200 rounded text-[10px] " + (gross >= 0 ? "text-gray-700" : "text-red-600 font-bold bg-red-50")}
                                  title="粗利（編集すると販売価格が逆算: 仕入+粗利）" />
                                {/* 粗利% */}
                                <input type="number" step="0.1" defaultValue={grossRate}
                                  onBlur={(e) => {
                                    const v = Number(e.target.value)
                                    if (v >= 100 || cost <= 0) return
                                    const newPrice = Math.round(cost / (1 - v / 100))
                                    updateSellPrice(newPrice)
                                  }}
                                  className={"w-14 text-right tabular-nums px-1 py-0.5 border border-gray-200 rounded text-[10px] " + (grossRate < 20 && cost > 0 ? "text-red-600 font-bold bg-red-50" : "text-gray-500")}
                                  title="粗利%（編集すると販売価格が逆算: 仕入÷(1-粗利%)）" />
                                {/* 小計（編集すると 販売価格 = 小計÷数量 で逆算）*/}
                                <input type="number" defaultValue={lineSubtotal}
                                  onBlur={(e) => {
                                    const v = Number(e.target.value)
                                    if (qty > 0) {
                                      const newPrice = Math.round(v / qty)
                                      if (newPrice >= 0) updateSellPrice(newPrice)
                                    }
                                  }}
                                  className="w-24 text-right tabular-nums px-1 py-0.5 border border-blue-300 rounded text-[11px] font-bold bg-blue-50"
                                  title="小計（編集すると販売価格が逆算: 小計÷数量）" />
                                <span className={"w-12 text-right text-[10px] tabular-nums " + (enough ? "text-gray-500" : "text-red-600 font-bold")}>
                                  {stock}
                                </span>
                              </div>
                            )
                          })}
                          {its.some(it => !it.price || Number(it.price) === 0) && (
                            <p className="ml-2 text-[10px] text-amber-700 font-bold mt-1">⚠ 単価0円の商品があります。納品書発行前に必ず単価を入力してください（黄色の入力欄）</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
      </GroupViewTabs>
      </div>

      {/* 印刷時: ピッキングリスト */}
      <div className="hidden print:block">
        <h1 style={{ textAlign: "center", fontSize: 24, letterSpacing: "0.3em", marginBottom: 16 }}>ピッキングリスト</h1>
        <p style={{ fontSize: 11, color: "#666", marginBottom: 8 }}>
          発行日時: {new Date().toLocaleString("ja-JP")} ／ 対象 {selectedOrders.length}件
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th style={{ padding: 6, border: "1px solid #ddd", textAlign: "center", width: 40 }}>✓</th>
              <th style={{ padding: 6, border: "1px solid #ddd", width: 60 }}>棚</th>
              <th style={{ padding: 6, border: "1px solid #ddd" }}>商品名</th>
              <th style={{ padding: 6, border: "1px solid #ddd", textAlign: "right", width: 60 }}>数量</th>
              <th style={{ padding: 6, border: "1px solid #ddd" }}>納品先</th>
            </tr>
          </thead>
          <tbody>
            {pickList.map(p => (
              <tr key={p.product_id || p.name}>
                <td style={{ padding: 6, border: "1px solid #ddd", textAlign: "center" }}>□</td>
                <td style={{ padding: 6, border: "1px solid #ddd", fontFamily: "monospace" }}>{p.location || "—"}</td>
                <td style={{ padding: 6, border: "1px solid #ddd" }}>{p.name}</td>
                <td style={{ padding: 6, border: "1px solid #ddd", textAlign: "right", fontWeight: "bold" }}>{p.qty}</td>
                <td style={{ padding: 6, border: "1px solid #ddd", fontSize: 10 }}>{Array.from(p.clinics).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4; margin: 10mm; }
        }
      `}</style>
    </div>
  )
}
