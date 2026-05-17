"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import { Html5Qrcode } from "html5-qrcode"
import { useRouter } from "next/navigation"

const C = {
  primary: "#22a648",
  blue:    "#2563eb",
  red:     "#ef4444",
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

export default function ClinicInventoryPage() {
  const router = useRouter()
  const [tab, setTab]               = useState<"record" | "history">("record")
  const [items, setItems]           = useState<Item[]>([])
  const [logs, setLogs]             = useState<Log[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState("")
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [scanning, setScanning]     = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [clinicId, setClinicId]     = useState("")
  const [staffName, setStaffName]   = useState("")
  const [historyFilter, setHistoryFilter] = useState<"today" | "week" | "all">("today")
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({})

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
        .select("id,product_name,maker,barcode,stock_quantity,min_stock,category,shelf_no")
        .order("product_name"),
      supabase.from("inventory_logs")
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(300),
    ])
    setItems((itemsData as Item[]) || [])
    setLogs((logsData as Log[]) || [])
  }

  async function updateStock(item: Item, delta: number) {
    if (processingId) return
    const newQty = Math.max(0, item.stock_quantity + delta)
    setProcessingId(item.id)

    await supabase.from("clinic_inventory_items")
      .update({ stock_quantity: newQty })
      .eq("id", item.id)

    await supabase.from("inventory_logs").insert([{
      clinic_id: clinicId || null,
      item_id: item.id,
      product_name: item.product_name,
      change_type: delta < 0 ? "使用" : "補充",
      quantity: Math.abs(delta),
      stock_before: item.stock_quantity,
      stock_after: newQty,
      staff_name: staffName || null,
    }])

    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, stock_quantity: newQty } : i))

    const { data: logsData } = await supabase.from("inventory_logs")
      .select("*").order("occurred_at", { ascending: false }).limit(300)
    setLogs((logsData as Log[]) || [])
    setProcessingId(null)
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
          if (!found) { alert("商品が見つかりません"); return }
          setHighlightId(found.id)
          setTimeout(() => setHighlightId(null), 3000)
          itemRefs.current[found.id]?.scrollIntoView({ behavior: "smooth", block: "center" })
        }, () => {})
    } catch { setScanning(false) }
  }

  const norm = (v: any) => String(v || "").toLowerCase().normalize("NFKC").replace(/\s+/g, "")

  const filtered = useMemo(() => {
    if (!search) return items
    const k = norm(search)
    return items.filter((i) =>
      norm(i.product_name).includes(k) ||
      norm(i.maker || "").includes(k) ||
      norm(i.barcode || "").includes(k) ||
      norm(i.category || "").includes(k) ||
      norm(i.shelf_no || "").includes(k)
    )
  }, [items, search])

  const needsReorder = useMemo(() =>
    filtered.filter((i) => i.min_stock !== null && i.stock_quantity <= i.min_stock),
    [filtered]
  )

  const normalItems = useMemo(() =>
    filtered.filter((i) => !(i.min_stock !== null && i.stock_quantity <= i.min_stock)),
    [filtered]
  )

  const filteredLogs = useMemo(() => {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekStart = new Date(todayStart)
    weekStart.setDate(weekStart.getDate() - 6)
    return logs.filter((l) => {
      const d = new Date(l.occurred_at)
      if (historyFilter === "today") return d >= todayStart
      if (historyFilter === "week") return d >= weekStart
      return true
    })
  }, [logs, historyFilter])

  function fmtTime(str: string) {
    const d = new Date(str)
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  }
  function fmtDateShort(str: string) {
    const d = new Date(str)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    return isToday ? fmtTime(str) : `${d.getMonth() + 1}/${d.getDate()} ${fmtTime(str)}`
  }

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: C.sub }}>
      読み込み中…
    </div>
  )

  return (
    <main style={{ maxWidth: 600, margin: "0 auto", background: C.bg, minHeight: "100vh", paddingBottom: 72 }}>
      <style>{`.inv-btn:active { opacity: 0.7; transform: scale(0.97); }`}</style>

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
            <span style={{
              background: "#fee2e2", color: "#b91c1c",
              padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: "bold",
            }}>
              発注必要 {needsReorder.length}件
            </span>
          )}
        </div>

        {tab === "record" && (
          <>
            <button className="inv-btn" onClick={startScan} style={{
              width: "100%", padding: "11px 0", borderRadius: 9, background: C.blue, color: "#fff",
              border: "none", fontWeight: "bold", fontSize: 15, cursor: "pointer", marginBottom: 9,
            }}>
              📷 スキャンして記録
            </button>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 商品名・バーコードで検索"
              style={{
                width: "100%", padding: "9px 13px", borderRadius: 8,
                border: `1.5px solid ${C.border}`, fontSize: 14,
                boxSizing: "border-box", outline: "none", color: C.text,
              }} />
          </>
        )}

        {tab === "history" && (
          <div style={{ display: "flex", gap: 6 }}>
            {(["today", "week", "all"] as const).map((f) => (
              <button key={f} onClick={() => setHistoryFilter(f)} style={{
                padding: "6px 14px", borderRadius: 999, fontSize: 13, cursor: "pointer",
                border: "none", fontWeight: historyFilter === f ? "bold" : "normal",
                background: historyFilter === f ? C.blue : "#f3f4f6",
                color: historyFilter === f ? "#fff" : C.sub,
              }}>
                {f === "today" ? "今日" : f === "week" ? "今週" : "すべて"}
              </button>
            ))}
          </div>
        )}
      </div>

      {scanning && <div id="inv-reader" style={{ width: "100%" }} />}

      {/* ── 記録タブ ── */}
      {tab === "record" && (
        <div style={{ padding: "10px 10px 0" }}>
          {needsReorder.length > 0 && (
            <section style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: "bold", color: "#b91c1c" }}>発注必要</span>
                <span style={{ background: C.red, color: "#fff", borderRadius: 999, padding: "1px 7px", fontSize: 11, fontWeight: "bold" }}>
                  {needsReorder.length}
                </span>
              </div>
              {needsReorder.map((item) => (
                <ItemCard key={item.id} item={item} onUpdate={updateStock}
                  highlight={highlightId === item.id} processing={processingId === item.id}
                  setRef={(el) => { itemRefs.current[item.id] = el }} />
              ))}
            </section>
          )}

          {needsReorder.length > 0 && normalItems.length > 0 && (
            <p style={{ fontSize: 12, color: C.sub, fontWeight: "bold", marginBottom: 6, paddingLeft: 2 }}>全商品</p>
          )}
          {normalItems.map((item) => (
            <ItemCard key={item.id} item={item} onUpdate={updateStock}
              highlight={highlightId === item.id} processing={processingId === item.id}
              setRef={(el) => { itemRefs.current[item.id] = el }} />
          ))}
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
                return (
                  <div key={log.id} style={{
                    background: C.card, borderRadius: 12, padding: "11px 13px",
                    border: `1px solid ${C.border}`, display: "flex", gap: 11, alignItems: "flex-start",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                  }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                      background: isUse ? "#fee2e2" : "#e8f5ec",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 15, color: isUse ? "#b91c1c" : "#166534",
                    }}>
                      {isUse ? "↓" : "↑"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ marginBottom: 3 }}>
                        <span style={{ fontSize: 12, color: C.sub }}>{fmtDateShort(log.occurred_at)}</span>
                        {log.staff_name && (
                          <strong style={{ color: C.text, marginLeft: 8, fontSize: 12 }}>{log.staff_name}</strong>
                        )}
                      </div>
                      <p style={{ margin: "0 0 5px", fontWeight: "bold", fontSize: 14, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {log.product_name}
                      </p>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{
                          fontSize: 11, fontWeight: "bold", padding: "2px 8px", borderRadius: 999,
                          background: isUse ? "#fee2e2" : "#e8f5ec",
                          color: isUse ? "#b91c1c" : "#166534",
                        }}>
                          {log.change_type} {isUse ? "-" : "+"}{log.quantity}
                        </span>
                        <span style={{ fontSize: 12, color: C.sub }}>
                          在庫 {log.stock_before} →{" "}
                          <strong style={{ color: isUse ? C.red : C.primary }}>{log.stock_after}</strong>
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

function ItemCard({ item, onUpdate, highlight, processing, setRef }: {
  item: Item
  onUpdate: (item: Item, delta: number) => void
  highlight: boolean
  processing: boolean
  setRef: (el: HTMLDivElement | null) => void
}) {
  const needsReorder = item.min_stock !== null && item.stock_quantity <= item.min_stock
  const meta = [
    item.maker,
    item.category,
    item.shelf_no ? `📍 ${item.shelf_no}` : null,
    item.barcode  ? `# ${item.barcode}`   : null,
  ].filter(Boolean)

  return (
    <div ref={setRef} style={{
      background: C.card, borderRadius: 11, padding: "10px 12px 9px", marginBottom: 7,
      border: `1.5px solid ${highlight ? C.blue : needsReorder ? "#fca5a5" : C.border}`,
      boxShadow: highlight ? "0 0 0 3px rgba(37,99,235,0.12)" : "0 1px 3px rgba(0,0,0,0.04)",
      transition: "border-color 0.3s, box-shadow 0.3s",
    }}>
      {/* 商品名 + 在庫数 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 3 }}>
        <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
          {needsReorder && (
            <span style={{ fontSize: 10, fontWeight: "bold", background: "#fee2e2", color: "#b91c1c", padding: "1px 6px", borderRadius: 999, marginRight: 5 }}>
              発注必要
            </span>
          )}
          <span style={{ fontWeight: "bold", fontSize: 14, color: C.text }}>{item.product_name}</span>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <span style={{ fontSize: 22, fontWeight: "bold", color: needsReorder ? C.red : C.text, lineHeight: 1 }}>
            {item.stock_quantity}
          </span>
          {item.min_stock !== null && (
            <span style={{ fontSize: 11, color: "#9ca3af" }}> / {item.min_stock}</span>
          )}
        </div>
      </div>

      {/* メタ情報 */}
      {meta.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1px 8px", marginBottom: 8 }}>
          {meta.map((v, i) => <span key={i} style={{ fontSize: 11, color: C.sub }}>{v}</span>)}
        </div>
      )}

      {/* 使用 / 補充 */}
      <div style={{ display: "flex", gap: 7 }}>
        <button className="inv-btn" onClick={() => onUpdate(item, -1)}
          disabled={processing || item.stock_quantity <= 0}
          style={{
            flex: 1, padding: "8px 0", borderRadius: 8,
            border: `1.5px solid ${C.blue}`, background: "#fff", color: C.blue,
            fontWeight: "bold", fontSize: 14,
            cursor: processing || item.stock_quantity <= 0 ? "not-allowed" : "pointer",
            opacity: processing || item.stock_quantity <= 0 ? 0.45 : 1,
          }}>
          使用 -1
        </button>
        <button className="inv-btn" onClick={() => onUpdate(item, +1)}
          disabled={processing}
          style={{
            flex: 1, padding: "8px 0", borderRadius: 8,
            border: `1.5px solid ${C.primary}`, background: "#fff", color: C.primary,
            fontWeight: "bold", fontSize: 14,
            cursor: processing ? "not-allowed" : "pointer",
            opacity: processing ? 0.45 : 1,
          }}>
          補充 +1
        </button>
      </div>
    </div>
  )
}
