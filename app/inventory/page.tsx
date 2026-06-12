"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import { Html5Qrcode } from "html5-qrcode"
import { playBeep } from "@/lib/beep"
import { useRouter } from "next/navigation"

const C = {
  primary: "#22a648",
  blue:    "#2563eb",
  red:     "#ef4444",
  orange:  "#f08c00",
  text:    "#1a1a1a",
  sub:     "#6b7280",
  border:  "#e5e7eb",
  bg:      "#f8f9fa",
  card:    "#ffffff",
}

type Item = {
  id: string
  product_name: string
  maker: string | null
  barcode: string | null
  stock_quantity: number
  min_stock: number | null
  category: string | null
  shelf_no: string | null
  location: string | null
}

type Log = {
  id: string
  product_name: string
  change_type: string
  quantity: number
  stock_before: number
  stock_after: number
  staff_name: string | null
  occurred_at: string
}

type ActionModal = {
  item: Item
  type: "use" | "restock"
  qty: number
}

export default function ClinicInventoryPage() {
  const router = useRouter()

  const [tab, setTab]             = useState<"record" | "history">("record")
  const [items, setItems]         = useState<Item[]>([])
  const [logs, setLogs]           = useState<Log[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState("")
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [scanning, setScanning]   = useState(false)
  const [clinicId, setClinicId]   = useState("")
  const [staffName, setStaffName] = useState("")

  const [locationFilter, setLocationFilter] = useState("すべて")

  const [toast, setToast]         = useState<string | null>(null)
  const [flashId, setFlashId]     = useState<string | null>(null)

  const [actionModal, setActionModal] = useState<ActionModal | null>(null)

  const [editStockId, setEditStockId]     = useState<string | null>(null)
  const [editStockValue, setEditStockValue] = useState("")

  const [historyFilter, setHistoryFilter] = useState<"today" | "week" | "all">("today")
  const [staffFilter, setStaffFilter]     = useState("すべて")

  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { init() }, [])

  async function init() {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) { router.push("/login"); return }
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", userData.user.id).single()
    if (!profile) { router.push("/login"); return }
    if (profile.role === "admin") { router.push("/admin"); return }
    setClinicId(profile.clinic_id)
    setStaffName(profile.login_code || "")
    await fetchAll(profile.clinic_id)
    setLoading(false)
  }

  async function fetchAll(cid?: string) {
    const [{ data: itemsData }, { data: logsData }] = await Promise.all([
      supabase.from("clinic_inventory_items")
        .select("id,product_name,maker,barcode,stock_quantity,min_stock,category,shelf_no,location")
        .order("product_name"),
      supabase.from("inventory_logs")
        .select("*").order("occurred_at", { ascending: false }).limit(500),
    ])
    setItems((itemsData as Item[]) || [])
    setLogs((logsData as Log[]) || [])
  }

  function showToast(msg: string) {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2200)
  }

  async function updateStock(item: Item, delta: number, type?: string) {
    if (processingId) return
    const newQty = Math.max(0, item.stock_quantity + delta)
    setProcessingId(item.id)

    await supabase.from("clinic_inventory_items").update({ stock_quantity: newQty }).eq("id", item.id)
    await supabase.from("inventory_logs").insert([{
      clinic_id: clinicId || null,
      item_id: item.id,
      product_name: item.product_name,
      change_type: type ?? (delta < 0 ? "使用" : "補充"),
      quantity: Math.abs(delta),
      stock_before: item.stock_quantity,
      stock_after: newQty,
      staff_name: staffName || null,
    }])

    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, stock_quantity: newQty } : i))

    setFlashId(item.id)
    setTimeout(() => setFlashId(null), 600)

    const { data: logsData } = await supabase.from("inventory_logs")
      .select("*").order("occurred_at", { ascending: false }).limit(500)
    setLogs((logsData as Log[]) || [])
    setProcessingId(null)
  }

  async function confirmAction() {
    if (!actionModal) return
    const { item, type, qty } = actionModal
    if (qty <= 0) { setActionModal(null); return }
    setActionModal(null)
    const delta = type === "use" ? -qty : qty
    await updateStock(item, delta)
    showToast(type === "use" ? `✓ 使用 -${qty} 記録しました` : `✓ 補充 +${qty} 記録しました`)
  }

  async function quickUpdate(item: Item, delta: number) {
    await updateStock(item, delta)
    showToast(delta < 0 ? `✓ 使用 -1 記録しました` : `✓ 補充 +1 記録しました`)
  }

  function startEditStock(item: Item) {
    setEditStockId(item.id)
    setEditStockValue(String(item.stock_quantity))
  }
  async function confirmEditStock(item: Item) {
    const newQty = parseInt(editStockValue, 10)
    setEditStockId(null)
    if (isNaN(newQty) || newQty === item.stock_quantity) return
    const delta = newQty - item.stock_quantity
    await updateStock(item, delta, "棚卸調整")
    showToast(`✓ 在庫を ${item.stock_quantity} → ${newQty} に修正しました`)
  }

  async function startScan() {
    setScanning(true)
    const scanner = new Html5Qrcode("inv-reader")
    try {
      await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 220 },
        async (code) => {
          await scanner.stop()
          setScanning(false)
          const found = items.find((i) => String(i.barcode || "") === code)
          if (!found) { playBeep("error"); alert("商品が見つかりません"); return }
          playBeep("success")
          setActionModal({ item: found, type: "use", qty: 1 })
          itemRefs.current[found.id]?.scrollIntoView({ behavior: "smooth", block: "center" })
        }, () => {})
    } catch { setScanning(false) }
  }

  const norm = (v: any) => String(v || "").toLowerCase().normalize("NFKC").replace(/\s+/g, "")

  // 場所一覧
  const locations = useMemo(() => {
    const locs = items.map((i) => i.location).filter(Boolean) as string[]
    return ["すべて", ...Array.from(new Set(locs)).sort()]
  }, [items])

  const filtered = useMemo(() => {
    const k = norm(search)
    return items.filter((i) => {
      const matchSearch = !k ||
        norm(i.product_name).includes(k) ||
        norm(i.maker || "").includes(k) ||
        norm(i.barcode || "").includes(k) ||
        norm(i.location || "").includes(k) ||
        norm(i.shelf_no || "").includes(k)
      const matchLoc = locationFilter === "すべて" || i.location === locationFilter
      return matchSearch && matchLoc
    })
  }, [items, search, locationFilter])

  const needsReorder = useMemo(() =>
    filtered.filter((i) => i.min_stock !== null && i.stock_quantity <= i.min_stock), [filtered])

  const normalItems = useMemo(() =>
    filtered.filter((i) => !(i.min_stock !== null && i.stock_quantity <= i.min_stock)), [filtered])

  // 場所別グループ（すべて表示時のみ）
  const locationGroups = useMemo(() => {
    if (locationFilter !== "すべて") return null
    const order: string[] = []
    const map: Record<string, Item[]> = {}
    for (const item of normalItems) {
      const key = item.location || "（場所未設定）"
      if (!map[key]) { map[key] = []; order.push(key) }
      map[key].push(item)
    }
    return order.map((loc) => ({ loc, items: map[loc] }))
  }, [normalItems, locationFilter])

  const staffNames = useMemo(() => {
    const names = logs.map((l) => l.staff_name).filter(Boolean) as string[]
    return ["すべて", ...Array.from(new Set(names))]
  }, [logs])

  const filteredLogs = useMemo(() => {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 6)
    return logs.filter((l) => {
      const d = new Date(l.occurred_at)
      const matchTime = historyFilter === "today" ? d >= todayStart
        : historyFilter === "week" ? d >= weekStart : true
      const matchStaff = staffFilter === "すべて" || l.staff_name === staffFilter
      return matchTime && matchStaff
    })
  }, [logs, historyFilter, staffFilter])

  function fmtTime(str: string) {
    const d = new Date(str)
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  }
  function fmtDateShort(str: string) {
    const d = new Date(str)
    return d.toDateString() === new Date().toDateString()
      ? fmtTime(str) : `${d.getMonth() + 1}/${d.getDate()} ${fmtTime(str)}`
  }

  const itemCardProps = (item: Item) => ({
    item,
    onQuick: quickUpdate,
    onOpenModal: (item: Item, type: "use" | "restock") => setActionModal({ item, type, qty: 1 }),
    onEditStock: startEditStock,
    editStockId,
    editStockValue,
    setEditStockValue,
    onConfirmEdit: confirmEditStock,
    onCancelEdit: () => setEditStockId(null),
    processing: processingId === item.id,
    flash: flashId === item.id,
    setRef: (el: HTMLDivElement | null) => { itemRefs.current[item.id] = el },
  })

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: C.sub }}>
      読み込み中…
    </div>
  )

  return (
    <main style={{ maxWidth: 600, margin: "0 auto", background: C.bg, minHeight: "100vh", paddingBottom: 72 }}>
      <style>{`
        .inv-btn:active { opacity: 0.7; transform: scale(0.97); }
        @keyframes flash { 0%,100%{background:transparent} 40%{background:#bbf7d0} }
        .flash-anim { animation: flash 0.6s ease; }
        .cat-pills::-webkit-scrollbar { display: none; }
      `}</style>

      {toast && (
        <div style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
          background: "#1a1a1a", color: "#fff", padding: "10px 20px", borderRadius: 999,
          fontSize: 13, fontWeight: "bold", zIndex: 999, whiteSpace: "nowrap",
          boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
        }}>{toast}</div>
      )}

      {/* ヘッダー */}
      <div style={{
        background: C.card, padding: "12px 14px 10px",
        borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, zIndex: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={() => router.push("/menu")} style={{
              background: "#e8f5ec", color: C.primary, border: "1px solid #b2dfbd",
              borderRadius: 7, padding: "5px 11px", fontSize: 12, fontWeight: "bold", cursor: "pointer",
            }}>← メニュー</button>
            <h1 style={{ margin: 0, fontSize: 17, fontWeight: "bold", color: C.text }}>
              {tab === "record" ? "在庫記録" : "出し入れ履歴"}
            </h1>
          </div>
          {tab === "record" && needsReorder.length > 0 && (
            <span style={{ background: "#fee2e2", color: "#b91c1c", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: "bold" }}>
              発注必要 {needsReorder.length}件
            </span>
          )}
        </div>

        {tab === "record" && (
          <>
            <button className="inv-btn" onClick={startScan} style={{
              width: "100%", padding: "11px 0", borderRadius: 9, background: C.blue, color: "#fff",
              border: "none", fontWeight: "bold", fontSize: 15, cursor: "pointer", marginBottom: 9,
            }}>📷 スキャンして記録</button>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 商品名・バーコードで検索"
              style={{ width: "100%", padding: "9px 13px", borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 14, boxSizing: "border-box", outline: "none", color: C.text, marginBottom: 8 }} />
            {/* 場所フィルター */}
            {locations.length > 2 && (
              <div className="cat-pills" style={{ display: "flex", overflowX: "auto", gap: 6, paddingBottom: 2 }}>
                {locations.map((loc) => (
                  <button key={loc} onClick={() => setLocationFilter(loc)} style={{
                    whiteSpace: "nowrap", padding: "5px 12px", borderRadius: 999, fontSize: 12,
                    cursor: "pointer", border: "none", fontWeight: locationFilter === loc ? "bold" : "normal",
                    background: locationFilter === loc ? C.primary : "#f3f4f6",
                    color: locationFilter === loc ? "#fff" : C.sub,
                  }}>{loc === "すべて" ? "📍 すべての場所" : `📍 ${loc}`}</button>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "history" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ display: "flex", gap: 6 }}>
              {(["today", "week", "all"] as const).map((f) => (
                <button key={f} onClick={() => setHistoryFilter(f)} style={{
                  padding: "6px 14px", borderRadius: 999, fontSize: 13, cursor: "pointer", border: "none",
                  fontWeight: historyFilter === f ? "bold" : "normal",
                  background: historyFilter === f ? C.blue : "#f3f4f6",
                  color: historyFilter === f ? "#fff" : C.sub,
                }}>{f === "today" ? "今日" : f === "week" ? "今週" : "すべて"}</button>
              ))}
            </div>
            {staffNames.length > 2 && (
              <div className="cat-pills" style={{ display: "flex", overflowX: "auto", gap: 6 }}>
                {staffNames.map((s) => (
                  <button key={s} onClick={() => setStaffFilter(s)} style={{
                    whiteSpace: "nowrap", padding: "5px 12px", borderRadius: 999, fontSize: 12,
                    cursor: "pointer", border: "none", fontWeight: staffFilter === s ? "bold" : "normal",
                    background: staffFilter === s ? C.primary : "#f3f4f6",
                    color: staffFilter === s ? "#fff" : C.sub,
                  }}>{s === "すべて" ? "全スタッフ" : s}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {scanning && <div id="inv-reader" style={{ width: "100%" }} />}

      {/* ── 記録タブ ── */}
      {tab === "record" && (
        <div style={{ padding: "10px 10px 0" }}>
          {/* 発注必要セクション */}
          {needsReorder.length > 0 && (
            <section style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: "bold", color: "#b91c1c" }}>発注必要</span>
                  <span style={{ background: C.red, color: "#fff", borderRadius: 999, padding: "1px 7px", fontSize: 11, fontWeight: "bold" }}>{needsReorder.length}</span>
                </div>
                <button onClick={() => router.push("/order")} style={{
                  padding: "5px 12px", borderRadius: 8, background: C.orange, color: "#fff",
                  border: "none", fontSize: 12, fontWeight: "bold", cursor: "pointer",
                }}>注文画面へ →</button>
              </div>
              {needsReorder.map((item) => <ItemCard key={item.id} {...itemCardProps(item)} />)}
            </section>
          )}

          {/* 場所別グループ表示（すべて選択時） */}
          {locationFilter === "すべて" && locationGroups ? (
            locationGroups.length === 0 ? null : (
              locationGroups.map(({ loc, items: groupItems }) => (
                <section key={loc} style={{ marginBottom: 16 }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 6, marginBottom: 6,
                    padding: "6px 10px", background: "#f0fdf4", borderRadius: 8,
                    border: "1px solid #bbf7d0",
                  }}>
                    <span style={{ fontSize: 13 }}>📍</span>
                    <span style={{ fontSize: 13, fontWeight: "bold", color: C.primary }}>
                      {loc}
                    </span>
                    <span style={{ fontSize: 12, color: C.sub, marginLeft: "auto" }}>
                      {groupItems.length}点
                    </span>
                  </div>
                  {groupItems.map((item) => <ItemCard key={item.id} {...itemCardProps(item)} />)}
                </section>
              ))
            )
          ) : (
            /* 場所指定フィルター時は単純リスト */
            <>
              {normalItems.map((item) => <ItemCard key={item.id} {...itemCardProps(item)} />)}
            </>
          )}

          {filtered.length === 0 && (
            <div style={{ textAlign: "center", color: C.sub, padding: "60px 0", fontSize: 14 }}>商品が見つかりません</div>
          )}
        </div>
      )}

      {/* ── 履歴タブ ── */}
      {tab === "history" && (
        <div style={{ padding: "10px 10px 0" }}>
          {filteredLogs.length === 0 ? (
            <div style={{ textAlign: "center", color: C.sub, padding: "60px 0", fontSize: 14 }}>記録がありません</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {filteredLogs.map((log) => {
                const isUse = log.change_type === "使用"
                const isAdj = log.change_type === "棚卸調整"
                const iconColor = isAdj ? C.orange : isUse ? "#b91c1c" : "#166534"
                const bgColor   = isAdj ? "#fff7e6" : isUse ? "#fee2e2" : "#e8f5ec"
                return (
                  <div key={log.id} style={{
                    background: C.card, borderRadius: 12, padding: "11px 13px",
                    border: `1px solid ${C.border}`, display: "flex", gap: 11, alignItems: "flex-start",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                  }}>
                    <div style={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, marginTop: 1, background: bgColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: iconColor }}>
                      {isAdj ? "⚖" : isUse ? "↓" : "↑"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ marginBottom: 3 }}>
                        <span style={{ fontSize: 12, color: C.sub }}>{fmtDateShort(log.occurred_at)}</span>
                        {log.staff_name && <strong style={{ color: C.text, marginLeft: 8, fontSize: 12 }}>{log.staff_name}</strong>}
                      </div>
                      <p style={{ margin: "0 0 5px", fontWeight: "bold", fontSize: 14, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {log.product_name}
                      </p>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: "bold", padding: "2px 8px", borderRadius: 999, background: bgColor, color: iconColor }}>
                          {log.change_type} {isAdj ? "" : isUse ? "-" : "+"}{log.quantity}
                        </span>
                        <span style={{ fontSize: 12, color: C.sub }}>
                          在庫 {log.stock_before} → <strong style={{ color: isUse ? C.red : C.primary }}>{log.stock_after}</strong>
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* アクションモーダル */}
      {actionModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget) setActionModal(null) }}>
          <div style={{ background: C.card, borderRadius: "20px 20px 0 0", padding: "22px 20px 36px", width: "100%", maxWidth: 520, boxShadow: "0 -4px 24px rgba(0,0,0,0.15)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: "bold", color: C.text }}>{actionModal.item.product_name}</h2>
              <button onClick={() => setActionModal(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.sub }}>✕</button>
            </div>
            {actionModal.item.location && (
              <p style={{ margin: "0 0 12px", fontSize: 12, color: C.sub }}>📍 {actionModal.item.location}</p>
            )}

            <p style={{ fontSize: 13, color: C.sub, marginBottom: 14 }}>
              現在在庫：<strong style={{ fontSize: 20, color: C.text }}>{actionModal.item.stock_quantity}</strong>
              {actionModal.item.min_stock !== null && <span style={{ fontSize: 12, color: "#9ca3af" }}> / 最低 {actionModal.item.min_stock}</span>}
            </p>

            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              <button onClick={() => setActionModal({ ...actionModal, type: "use" })} style={{
                flex: 1, padding: "11px 0", borderRadius: 9, fontWeight: "bold", fontSize: 15, cursor: "pointer",
                border: `2px solid ${C.blue}`,
                background: actionModal.type === "use" ? C.blue : "#fff",
                color: actionModal.type === "use" ? "#fff" : C.blue,
              }}>使用</button>
              <button onClick={() => setActionModal({ ...actionModal, type: "restock" })} style={{
                flex: 1, padding: "11px 0", borderRadius: 9, fontWeight: "bold", fontSize: 15, cursor: "pointer",
                border: `2px solid ${C.primary}`,
                background: actionModal.type === "restock" ? C.primary : "#fff",
                color: actionModal.type === "restock" ? "#fff" : C.primary,
              }}>補充</button>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 20 }}>
              <button onClick={() => setActionModal({ ...actionModal, qty: Math.max(1, actionModal.qty - 1) })}
                style={{ width: 44, height: 44, borderRadius: 12, border: `1.5px solid ${C.border}`, background: "#f9fafb", fontSize: 22, cursor: "pointer", color: C.text }}>−</button>
              <input type="number" min="1" value={actionModal.qty}
                onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 1) setActionModal({ ...actionModal, qty: v }) }}
                style={{ width: 72, height: 44, textAlign: "center", borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 22, fontWeight: "bold", color: C.text, outline: "none" }} />
              <button onClick={() => setActionModal({ ...actionModal, qty: actionModal.qty + 1 })}
                style={{ width: 44, height: 44, borderRadius: 12, border: `1.5px solid ${C.border}`, background: "#f9fafb", fontSize: 22, cursor: "pointer", color: C.text }}>＋</button>
            </div>

            <button onClick={confirmAction} style={{
              width: "100%", padding: 14, borderRadius: 12, border: "none",
              background: actionModal.type === "use" ? C.blue : C.primary,
              color: "#fff", fontWeight: "bold", fontSize: 16, cursor: "pointer",
            }}>
              {actionModal.type === "use" ? `使用 −${actionModal.qty} を記録` : `補充 +${actionModal.qty} を記録`}
            </button>
          </div>
        </div>
      )}

      {/* 下部タブバー */}
      <nav style={{
        position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: "100%", maxWidth: 600,
        background: C.card, borderTop: `1px solid ${C.border}`, display: "flex", zIndex: 30,
      }}>
        {([
          { key: "record",  label: "記録",  icon: "✏️" },
          { key: "history", label: "履歴",  icon: "🕐" },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            flex: 1, padding: "10px 0 8px", border: "none", background: "transparent", cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
            color: tab === t.key ? C.blue : C.sub,
            borderTop: tab === t.key ? `2px solid ${C.blue}` : "2px solid transparent",
          }}>
            <span style={{ fontSize: 18 }}>{t.icon}</span>
            <span style={{ fontSize: 11, fontWeight: tab === t.key ? "bold" : "normal" }}>{t.label}</span>
          </button>
        ))}
      </nav>
    </main>
  )
}

// ── 商品カード ──
function ItemCard({ item, onQuick, onOpenModal, onEditStock, editStockId, editStockValue, setEditStockValue, onConfirmEdit, onCancelEdit, processing, flash, setRef }: {
  item: Item
  onQuick: (item: Item, delta: number) => void
  onOpenModal: (item: Item, type: "use" | "restock") => void
  onEditStock: (item: Item) => void
  editStockId: string | null
  editStockValue: string
  setEditStockValue: (v: string) => void
  onConfirmEdit: (item: Item) => void
  onCancelEdit: () => void
  processing: boolean
  flash: boolean
  setRef: (el: HTMLDivElement | null) => void
}) {
  const needsReorder = item.min_stock !== null && item.stock_quantity <= item.min_stock
  const isEditing = editStockId === item.id
  const meta = [
    item.maker,
    item.shelf_no ? `棚：${item.shelf_no}` : null,
    item.barcode ? `# ${item.barcode}` : null,
  ].filter(Boolean)

  return (
    <div ref={setRef} style={{
      background: "#fff", borderRadius: 11, padding: "10px 12px 9px", marginBottom: 7,
      border: `1.5px solid ${needsReorder ? "#fca5a5" : "#e5e7eb"}`,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 3 }}>
        <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
          {needsReorder && (
            <span style={{ fontSize: 10, fontWeight: "bold", background: "#fee2e2", color: "#b91c1c", padding: "1px 6px", borderRadius: 999, marginRight: 5 }}>発注必要</span>
          )}
          <span style={{ fontWeight: "bold", fontSize: 14, color: "#1a1a1a" }}>{item.product_name}</span>
        </div>

        {isEditing ? (
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <input type="number" value={editStockValue} onChange={(e) => setEditStockValue(e.target.value)}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") onConfirmEdit(item); if (e.key === "Escape") onCancelEdit() }}
              style={{ width: 56, height: 32, textAlign: "center", borderRadius: 8, border: "2px solid #2563eb", fontSize: 18, fontWeight: "bold", outline: "none" }} />
            <button onClick={() => onConfirmEdit(item)} style={{ background: "#22a648", color: "#fff", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 13, cursor: "pointer" }}>✓</button>
            <button onClick={onCancelEdit} style={{ background: "#f3f4f6", color: "#6b7280", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 13, cursor: "pointer" }}>✕</button>
          </div>
        ) : (
          <div className={flash ? "flash-anim" : ""} onClick={() => onEditStock(item)}
            style={{ textAlign: "right", flexShrink: 0, cursor: "pointer", borderRadius: 6, padding: "2px 4px" }}
            title="タップで在庫数を直接編集">
            <span style={{ fontSize: 22, fontWeight: "bold", color: needsReorder ? "#ef4444" : "#1a1a1a", lineHeight: 1 }}>{item.stock_quantity}</span>
            {item.min_stock !== null && <span style={{ fontSize: 11, color: "#9ca3af" }}> / {item.min_stock}</span>}
          </div>
        )}
      </div>

      {meta.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1px 8px", marginBottom: 8 }}>
          {meta.map((v, i) => <span key={i} style={{ fontSize: 11, color: "#6b7280" }}>{v}</span>)}
        </div>
      )}

      <div style={{ display: "flex", gap: 6 }}>
        <button className="inv-btn" onClick={() => onQuick(item, -1)}
          disabled={processing || item.stock_quantity <= 0}
          style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: `1.5px solid #2563eb`, background: "#fff", color: "#2563eb", fontWeight: "bold", fontSize: 13, cursor: processing || item.stock_quantity <= 0 ? "not-allowed" : "pointer", opacity: processing || item.stock_quantity <= 0 ? 0.4 : 1 }}>
          使用 -1
        </button>
        <button className="inv-btn" onClick={() => onQuick(item, +1)}
          disabled={processing}
          style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: `1.5px solid #22a648`, background: "#fff", color: "#22a648", fontWeight: "bold", fontSize: 13, cursor: processing ? "not-allowed" : "pointer", opacity: processing ? 0.4 : 1 }}>
          補充 +1
        </button>
        <button className="inv-btn" onClick={() => onOpenModal(item, "use")}
          disabled={processing}
          style={{ padding: "8px 10px", borderRadius: 8, border: `1.5px solid #e5e7eb`, background: "#fff", color: "#6b7280", fontSize: 13, cursor: processing ? "not-allowed" : "pointer", opacity: processing ? 0.4 : 1 }}>
          ···
        </button>
      </div>
    </div>
  )
}
