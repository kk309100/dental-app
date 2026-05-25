"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

const STEPS = ["注文受付", "処理中", "発送済み", "納品済み"]
const CANCEL_STATUSES = new Set(["キャンセル", "取消", "キャンセル申請中"])

function getStepIndex(status: string) {
  // 管理側ステータス → 医院側表示ステップへのマッピング
  // STEPS = ["注文受付", "処理中", "発送済み", "納品済み"]
  if (status === "注文受付") return 0
  if (status === "確認中") return 1          // 処理中
  if (status === "準備中") return 2          // 発送済み（出荷準備完了）
  if (status === "納品済み" || status === "納品済") return 3
  // 不明なステータスは受付済みとして表示（-1 は ProgressBar が壊れる）
  return 0
}

function isCancelled(status: string) {
  return CANCEL_STATUSES.has(status)
}

export default function HistoryPage() {
  const router = useRouter()

  const [clinicId, setClinicId]     = useState("")
  const [clinicName, setClinicName] = useState("")
  const [orders, setOrders]         = useState<any[]>([])
  const [orderItems, setOrderItems] = useState<any[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState("")
  const [statusFilter, setStatusFilter] = useState("すべて")
  const [dateFrom, setDateFrom]     = useState("")
  const [dateTo, setDateTo]         = useState("")
  const [openOrderId, setOpenOrderId] = useState<string | null>(null)
  const [reorderingId, setReorderingId] = useState<string | null>(null)
  const [reorderDone, setReorderDone] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set())
  const [reorderModal, setReorderModal] = useState<{
    order: any
    items: { product_id: string; product_name: string; price: number; quantity: number }[]
  } | null>(null)
  const [reorderOrdererName, setReorderOrdererName] = useState("")

  useEffect(() => { checkLogin() }, [])

  async function checkLogin() {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) { router.push("/login"); return }
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", userData.user.id).single()
    if (!profile) { router.push("/login"); return }
    if (profile.role === "admin") { router.push("/admin"); return }
    setClinicId(profile.clinic_id)
    const { data: clinic } = await supabase.from("clinics").select("*").eq("id", profile.clinic_id).single()
    setClinicName(clinic?.name || "")
    await fetchHistory(profile.clinic_id)
    setLoading(false)
  }

  async function fetchHistory(cid: string) {
    const { data: ordersData } = await supabase
      .from("orders").select("*").eq("clinic_id", cid)
      .order("created_at", { ascending: false })
    // 自医院の注文IDに絞って取得（全件取得すると他医院データが混入し上限も超える）
    const orderIds = (ordersData || []).map((o: any) => o.id)
    const { data: itemsData } = orderIds.length > 0
      ? await supabase.from("order_items").select("*").in("order_id", orderIds).limit(50000)
      : { data: [] }
    setOrders(ordersData || [])
    setOrderItems(itemsData || [])
  }

  function getItems(orderId: string) {
    return orderItems.filter((i) => i.order_id === orderId)
  }

  const norm = (v: any) => String(v || "").toLowerCase().normalize("NFKC").replace(/\s+/g, "")

  const statuses = useMemo(() => {
    const list = orders.map((o) => o.status).filter((s) => s && String(s).trim())
    return ["すべて", ...Array.from(new Set(list))]
  }, [orders])

  const filteredOrders = useMemo(() => {
    const k = norm(search)
    const from = dateFrom ? new Date(dateFrom + "T00:00:00") : null
    const to   = dateTo   ? new Date(dateTo   + "T23:59:59") : null
    return orders.filter((order) => {
      const itemNames = getItems(order.id).map((i) => i.product_name || "").join(" ")
      const target = norm(`${order.delivery_number || ""} ${order.status || ""} ${itemNames} ${order.orderer_name || ""}`)
      const d = new Date(order.created_at)
      return (
        (!k || target.includes(k)) &&
        (statusFilter === "すべて" || order.status === statusFilter) &&
        (!from || d >= from) &&
        (!to   || d <= to)
      )
    })
  }, [orders, orderItems, search, statusFilter, dateFrom, dateTo])

  // ② 月別グループ
  const ordersByMonth = useMemo(() => {
    const groups: { key: string; label: string; orders: any[] }[] = []
    const map: Record<string, any[]> = {}
    for (const order of filteredOrders) {
      const d = new Date(order.created_at)
      const key   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      const label = `${d.getFullYear()}年${d.getMonth() + 1}月`
      if (!map[key]) { map[key] = []; groups.push({ key, label, orders: map[key] }) }
      map[key].push(order)
    }
    return groups
  }, [filteredOrders])

  function toggleMonth(key: string) {
    setCollapsedMonths((prev) => {
      const s = new Set(prev)
      s.has(key) ? s.delete(key) : s.add(key)
      return s
    })
  }

  // ③ キャンセル申請
  async function requestCancel(order: any) {
    if (!window.confirm(`「${order.delivery_number || "この注文"}」をキャンセル申請しますか？\n管理者に通知されます。`)) return
    setCancellingId(order.id)
    await supabase.from("orders").update({ status: "キャンセル申請中" }).eq("id", order.id)
    setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, status: "キャンセル申請中" } : o))
    setCancellingId(null)
  }

  function openReorderModal(order: any) {
    const items = getItems(order.id)
    if (items.length === 0) { alert("再注文できる商品がありません"); return }
    setReorderOrdererName(order.orderer_name || "")  // 前回の担当者名をプリフィル
    setReorderModal({
      order,
      items: items.map((i) => ({
        product_id: i.product_id, product_name: i.product_name,
        price: Number(i.price || 0), quantity: Number(i.quantity || 1),
      })),
    })
  }

  function setReorderQty(productId: string, val: string) {
    const qty = parseInt(val, 10)
    if (isNaN(qty) || qty < 0) return
    setReorderModal((prev) => prev
      ? { ...prev, items: prev.items.map((i) => i.product_id === productId ? { ...i, quantity: qty } : i) }
      : prev)
  }

  async function submitReorder() {
    if (!reorderModal) return
    const items = reorderModal.items.filter((i) => i.quantity > 0)
    if (items.length === 0) { alert("数量が0の商品は注文できません"); return }
    if (!reorderOrdererName.trim()) { alert("担当者名を入力してください。"); return }
    setReorderingId(reorderModal.order.id)
    setReorderModal(null)
    const now = new Date()
    const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, "0"), d = String(now.getDate()).padStart(2, "0")
    const { data: existing } = await supabase.from("orders").select("id")
      .gte("created_at", `${y}-${m}-${d}T00:00:00`).lte("created_at", `${y}-${m}-${d}T23:59:59`)
    const deliveryNumber = `DN-${y}${m}${d}-${String((existing?.length || 0) + 1).padStart(4, "0")}`
    const totalPrice = items.reduce((s, i) => s + i.price * i.quantity, 0)
    const { data: newOrder, error } = await supabase.from("orders")
      .insert([{ clinic_id: clinicId, status: "注文受付", total_price: totalPrice, delivery_number: deliveryNumber, orderer_name: reorderOrdererName.trim() }])
      .select().single()
    if (error) { alert("再注文でエラーが出ました"); setReorderingId(null); return }
    await supabase.from("order_items").insert(
      items.map((i) => ({ order_id: newOrder.id, product_id: i.product_id, product_name: i.product_name, quantity: i.quantity, price: i.price }))
    )
    setReorderingId(null)
    setReorderOrdererName("")
    setReorderDone(true)
    await fetchHistory(clinicId)
  }

  function fmtDate(str: string) {
    const d = new Date(str)
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  }

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh", color: "#999" }}>
      読み込み中…
    </div>
  )

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "12px 16px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <button onClick={() => router.push("/menu")} style={backBtn}>← メニューへ</button>
        <span style={{ fontSize: 12, color: "#888" }}>{clinicName}</span>
      </div>

      <h1 style={{ fontSize: 20, fontWeight: "bold", color: "#111", marginBottom: 16 }}>注文履歴</h1>

      {/* 検索・フィルター */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="納品書番号・商品名・担当者で検索"
            style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" as const }} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", fontSize: 13, background: "#fff", flexShrink: 0 }}>
            {statuses.map((s: any) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#888", flexShrink: 0 }}>日付</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            style={{ flex: 1, padding: "8px 10px", borderRadius: 10, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box" as const }} />
          <span style={{ fontSize: 12, color: "#888", flexShrink: 0 }}>〜</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            style={{ flex: 1, padding: "8px 10px", borderRadius: 10, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box" as const }} />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(""); setDateTo("") }}
              style={{ flexShrink: 0, padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 12, color: "#888", cursor: "pointer" }}>
              クリア
            </button>
          )}
        </div>
      </div>

      <p style={{ fontSize: 12, color: "#999", marginBottom: 12 }}>
        {filteredOrders.length}件 / 全{orders.length}件
      </p>

      {reorderDone && (
        <div style={{ background: "#dcfce7", border: "1px solid #86efac", borderRadius: 10, padding: "12px 16px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 14, fontWeight: "bold", color: "#166534" }}>✓ 再注文しました</span>
          <button onClick={() => setReorderDone(false)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#888" }}>✕</button>
        </div>
      )}

      {filteredOrders.length === 0 ? (
        <div style={{ textAlign: "center", color: "#aaa", padding: "60px 0", fontSize: 14 }}>注文履歴がありません</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {ordersByMonth.map(({ key, label, orders: monthOrders }) => {
            const collapsed   = collapsedMonths.has(key)
            const monthTotal  = monthOrders.reduce((s, o) => s + Number(o.total_price || 0), 0)
            const monthQty    = monthOrders.length

            return (
              <section key={key}>
                {/* ② 月別ヘッダー */}
                <button onClick={() => toggleMonth(key)} style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "9px 14px", borderRadius: 10, border: "none", cursor: "pointer",
                  background: "#f0fdf4", marginBottom: collapsed ? 0 : 10,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: "bold", color: "#166534" }}>{label}</span>
                    <span style={{ fontSize: 12, color: "#6b7280" }}>{monthQty}件</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: "bold", color: "#111" }}>
                      ¥{monthTotal.toLocaleString()}
                    </span>
                    <span style={{ fontSize: 12, color: "#6b7280" }}>{collapsed ? "▼" : "▲"}</span>
                  </div>
                </button>

                {!collapsed && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {monthOrders.map((order) => {
                      const items       = getItems(order.id)
                      const isOpen      = openOrderId === order.id
                      const isReordering = reorderingId === order.id
                      const isCancelling = cancellingId === order.id
                      const totalQty    = items.reduce((s, i) => s + Number(i.quantity || 0), 0)
                      const stepIdx     = getStepIndex(order.status)
                      const cancelled   = isCancelled(order.status)
                      const canEdit     = order.status === "注文受付"
                      const canCancel   = order.status === "注文受付"

                      return (
                        <div key={order.id} style={{
                          background: "#fff", border: `1px solid ${cancelled ? "#fca5a5" : "#e8eaed"}`,
                          borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                        }}>
                          <div style={{ padding: "14px 16px" }}>
                            {/* 上段: 番号 + ステータスバッジ */}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                              <div>
                                <p style={{ margin: 0, fontWeight: "bold", fontSize: 15, color: "#111" }}>
                                  {order.delivery_number || "番号なし"}
                                </p>
                                <p style={{ margin: "3px 0 0", fontSize: 12, color: "#999" }}>
                                  {fmtDate(order.created_at)}
                                  {order.orderer_name && (
                                    <span style={{ marginLeft: 8, color: "#555", fontWeight: "bold" }}>
                                      担当：{order.orderer_name}
                                    </span>
                                  )}
                                </p>
                              </div>
                              {cancelled && (
                                <span style={{
                                  padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: "bold",
                                  background: order.status === "キャンセル申請中" ? "#fef3c7" : "#fee2e2",
                                  color: order.status === "キャンセル申請中" ? "#92400e" : "#991b1b",
                                  whiteSpace: "nowrap",
                                }}>
                                  {order.status}
                                </span>
                              )}
                            </div>

                            {/* ① ステータス進捗バー */}
                            {!cancelled && (
                              <div style={{ marginBottom: 12 }}>
                                <ProgressBar stepIndex={stepIdx} />
                              </div>
                            )}

                            {/* 合計行 */}
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                              <span style={{ fontSize: 12, color: "#888" }}>{totalQty}点</span>
                              <span style={{ fontWeight: "bold", fontSize: 17, color: "#111" }}>
                                税抜 {Number(order.total_price || 0).toLocaleString()}円
                              </span>
                            </div>
                          </div>

                          {/* 明細（開閉） */}
                          {isOpen && (
                            <div style={{ borderTop: "1px solid #f0f0f0", padding: "0 16px" }}>
                              {items.map((item, idx) => (
                                <div key={item.id} style={{
                                  display: "flex", justifyContent: "space-between", alignItems: "center",
                                  padding: "10px 0", borderBottom: idx < items.length - 1 ? "1px solid #f5f5f5" : "none",
                                }}>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <p style={{ margin: 0, fontWeight: "bold", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {item.product_name || "商品名なし"}
                                    </p>
                                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#999" }}>
                                      {item.quantity}個 × {Number(item.price || 0).toLocaleString()}円
                                    </p>
                                  </div>
                                  <span style={{ fontSize: 13, fontWeight: "bold", color: "#333", flexShrink: 0, marginLeft: 12 }}>
                                    {(Number(item.price || 0) * Number(item.quantity || 0)).toLocaleString()}円
                                  </span>
                                </div>
                              ))}
                              <div style={{ padding: "10px 0", display: "flex", justifyContent: "flex-end" }}>
                                <span style={{ fontWeight: "bold", fontSize: 14 }}>
                                  合計（税抜）　{Number(order.total_price || 0).toLocaleString()}円
                                </span>
                              </div>
                            </div>
                          )}

                          {/* アクションフッター */}
                          <div style={{ borderTop: "1px solid #f0f0f0", padding: "10px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button onClick={() => setOpenOrderId(isOpen ? null : order.id)}
                              style={{ flex: 1, minWidth: 70, padding: "9px 0", borderRadius: 8, border: "1px solid #e0e0e0", background: "#fff", fontSize: 13, color: "#555", cursor: "pointer", fontWeight: "bold" }}>
                              {isOpen ? "閉じる ▲" : "明細 ▼"}
                            </button>

                            {canEdit && (
                              <button onClick={() => router.push(`/order-edit/${order.id}`)}
                                style={{ flex: 1, minWidth: 70, padding: "9px 0", borderRadius: 8, border: "1px solid #22a648", background: "#fff", fontSize: 13, color: "#22a648", cursor: "pointer", fontWeight: "bold" }}>
                                修正
                              </button>
                            )}

                            {/* ③ キャンセル申請 */}
                            {canCancel && (
                              <button onClick={() => requestCancel(order)} disabled={isCancelling}
                                style={{ flex: 1, minWidth: 70, padding: "9px 0", borderRadius: 8, border: "1px solid #fca5a5", background: "#fff", fontSize: 13, color: "#ef4444", cursor: isCancelling ? "not-allowed" : "pointer", fontWeight: "bold", opacity: isCancelling ? 0.6 : 1 }}>
                                {isCancelling ? "処理中…" : "キャンセル"}
                              </button>
                            )}

                            {!cancelled && (
                              <button onClick={() => openReorderModal(order)} disabled={isReordering}
                                style={{ flex: 1, minWidth: 70, padding: "9px 0", borderRadius: 8, border: "none", background: "#22a648", color: "#fff", fontSize: 13, cursor: isReordering ? "not-allowed" : "pointer", fontWeight: "bold", opacity: isReordering ? 0.6 : 1 }}>
                                {isReordering ? "処理中…" : "再注文"}
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}

      {/* 再注文 数量確認モーダル */}
      {reorderModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget) setReorderModal(null) }}>
          <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", padding: "20px 20px 36px", width: "100%", maxWidth: 600, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 -4px 24px rgba(0,0,0,0.15)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: "bold" }}>再注文 — 数量を確認</h2>
              <button onClick={() => setReorderModal(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#888" }}>✕</button>
            </div>
            <div style={{ overflowY: "auto", flex: 1, marginBottom: 16 }}>
              {reorderModal.items.map((item) => (
                <div key={item.product_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid #f0f0f0", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: "bold", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.product_name}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#999" }}>税抜 {item.price.toLocaleString()}円 / 個</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <button onClick={() => setReorderQty(item.product_id, String(Math.max(0, item.quantity - 1)))}
                      style={{ width: 34, height: 34, borderRadius: 8, border: "1px solid #ddd", background: "#f5f5f5", fontSize: 18, cursor: "pointer" }}>−</button>
                    <input type="number" min="0" value={item.quantity}
                      onChange={(e) => setReorderQty(item.product_id, e.target.value)}
                      style={{ width: 52, height: 34, textAlign: "center", borderRadius: 8, border: "1px solid #ddd", fontSize: 15, fontWeight: "bold" }} />
                    <button onClick={() => setReorderQty(item.product_id, String(item.quantity + 1))}
                      style={{ width: 34, height: 34, borderRadius: 8, border: "1px solid #ddd", background: "#f5f5f5", fontSize: 18, cursor: "pointer" }}>＋</button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ borderTop: "1px solid #eee", paddingTop: 14 }}>
              {/* 担当者名 */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: "bold", color: "#6b7280", display: "block", marginBottom: 5 }}>
                  担当者名 <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  value={reorderOrdererName}
                  onChange={(e) => setReorderOrdererName(e.target.value)}
                  placeholder="例：山田 太郎"
                  style={{
                    width: "100%", padding: "10px 13px", borderRadius: 8,
                    border: `1.5px solid ${reorderOrdererName.trim() ? "#e5e7eb" : "#fca5a5"}`,
                    fontSize: 14, boxSizing: "border-box" as const, outline: "none",
                  }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                <span style={{ fontWeight: "bold", fontSize: 14 }}>合計（税抜）</span>
                <span style={{ fontWeight: "bold", fontSize: 18 }}>
                  {reorderModal.items.reduce((s, i) => s + i.price * i.quantity, 0).toLocaleString()}円
                </span>
              </div>
              <button onClick={submitReorder}
                style={{ width: "100%", padding: 15, borderRadius: 12, background: "#ea580c", color: "#fff", border: "none", fontSize: 16, fontWeight: "bold", cursor: "pointer", boxShadow: "0 3px 12px rgba(234,88,12,0.4)" }}>
                この内容で再注文する
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

// ① ステータス進捗バー
function ProgressBar({ stepIndex }: { stepIndex: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
      {STEPS.map((step, i) => {
        const done    = i < stepIndex
        const current = i === stepIndex
        const future  = i > stepIndex
        return (
          <div key={step} style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "none" }}>
              <div style={{
                width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                background: done ? "#22a648" : current ? "#22a648" : "#e5e7eb",
                border: current ? "2px solid #22a648" : "none",
                flexShrink: 0,
              }}>
                {done
                  ? <span style={{ color: "#fff", fontSize: 11, fontWeight: "bold" }}>✓</span>
                  : <span style={{ width: 8, height: 8, borderRadius: "50%", background: current ? "#fff" : "#d1d5db", display: "block" }} />
                }
              </div>
              <span style={{
                fontSize: 9, marginTop: 3, whiteSpace: "nowrap",
                fontWeight: current ? "bold" : "normal",
                color: done || current ? "#166534" : "#9ca3af",
              }}>{step}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{
                flex: 1, height: 2, margin: "0 2px", marginBottom: 14,
                background: done ? "#22a648" : "#e5e7eb",
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

const backBtn: React.CSSProperties = {
  padding: "8px 14px", background: "#e8f5ec", color: "#22a648", border: "1px solid #b2dfbd",
  borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: "bold",
}
