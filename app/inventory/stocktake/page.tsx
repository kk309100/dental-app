"use client"

import { useEffect, useRef, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { Html5Qrcode } from "html5-qrcode"
import { playBeep } from "@/lib/beep"

const C = {
  primary: "#22a648",
  blue:    "#2563eb",
  orange:  "#f08c00",
  red:     "#ef4444",
  border:  "#e5e7eb",
  bg:      "#f3f4f6",
  text:    "#111827",
  sub:     "#6b7280",
}

type Item = {
  id: string
  product_name: string
  maker: string | null
  barcode: string | null
  stock_quantity: number
  units_per_package: number | null
  unit: string | null
  location: string | null
  shelf_no: string | null
  sealed_boxes: number | null
}

export default function StocktakePage() {
  const router = useRouter()
  const [items, setItems]           = useState<Item[]>([])
  const [sealedCounts, setSealedCounts] = useState<Record<string, string>>({})
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [clinicId, setClinicId]     = useState("")
  const [staffName, setStaffName]   = useState("")
  const [scanning, setScanning]     = useState(false)
  const [savedCount, setSavedCount] = useState<number | null>(null)
  const [locFilter, setLocFilter]   = useState("すべて")
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => { init() }, [])

  async function init() {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) { router.push("/login"); return }
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", userData.user.id).single()
    if (!profile) { router.push("/login"); return }
    if (profile.role === "admin") { router.push("/admin"); return }
    setClinicId(profile.clinic_id)
    setStaffName(profile.login_code || "")

    const { data } = await supabase.from("clinic_inventory_items")
      .select("id,product_name,maker,barcode,stock_quantity,units_per_package,unit,location,shelf_no,sealed_boxes")
      .eq("clinic_id", profile.clinic_id)
      .order("location")
    const fetched = (data as Item[]) || []
    setItems(fetched)
    // 前回の未開封箱数を初期値にセット
    const init: Record<string, string> = {}
    fetched.forEach(i => {
      init[i.id] = i.sealed_boxes != null ? String(i.sealed_boxes) : ""
    })
    setSealedCounts(init)
    setLoading(false)
  }

  const locations = useMemo(() => {
    const locs = items.map(i => i.location).filter(Boolean) as string[]
    return ["すべて", ...Array.from(new Set(locs)).sort()]
  }, [items])

  const filtered = useMemo(() =>
    locFilter === "すべて" ? items : items.filter(i => i.location === locFilter),
    [items, locFilter])

  const groups = useMemo(() => {
    const map: Record<string, Item[]> = {}
    const order: string[] = []
    for (const item of filtered) {
      const key = item.location || "（場所未設定）"
      if (!map[key]) { map[key] = []; order.push(key) }
      map[key].push(item)
    }
    return order.map(loc => ({ loc, items: map[loc] }))
  }, [filtered])

  const changedItems = useMemo(() =>
    items.filter(i => {
      const v = sealedCounts[i.id]
      if (v === undefined || v === "") return false
      const n = parseInt(v, 10)
      return !isNaN(n) && n !== (i.sealed_boxes ?? -1)
    }), [items, sealedCounts])

  function getSealedCount(id: string) { return sealedCounts[id] ?? "" }

  function setSealedCount(id: string, val: string) {
    setSealedCounts(prev => ({ ...prev, [id]: val }))
  }

  function isChanged(item: Item) {
    const v = sealedCounts[item.id]
    if (v === undefined || v === "") return false
    const n = parseInt(v, 10)
    return !isNaN(n) && n !== (item.sealed_boxes ?? -1)
  }

  function handleKeyDown(e: React.KeyboardEvent, currentId: string) {
    if (e.key !== "Enter") return
    const ids = filtered.map(i => i.id)
    const idx = ids.indexOf(currentId)
    const nextId = ids[idx + 1]
    if (nextId) inputRefs.current[nextId]?.focus()
  }

  async function startScan() {
    setScanning(true)
    const scanner = new Html5Qrcode("st-reader")
    try {
      await scanner.start(
        { facingMode: "environment" }, { fps: 10, qrbox: 220 },
        async (code) => {
          await scanner.stop()
          setScanning(false)
          const found = items.find(i => String(i.barcode || "") === code)
          if (!found) { playBeep("error"); alert("商品が見つかりません"); return }
          playBeep("success")
          if (found.location) setLocFilter(found.location)
          setTimeout(() => {
            inputRefs.current[found.id]?.focus()
            inputRefs.current[found.id]?.scrollIntoView({ behavior: "smooth", block: "center" })
          }, 300)
        }, () => {}
      )
    } catch { setScanning(false) }
  }

  async function saveAll() {
    if (changedItems.length === 0) { alert("変更がありません"); return }
    if (!confirm(`${changedItems.length}件の未開封箱数を保存しますか？`)) return
    setSaving(true)

    for (const item of changedItems) {
      const newVal = parseInt(sealedCounts[item.id], 10)
      await supabase.from("clinic_inventory_items")
        .update({ sealed_boxes: newVal }).eq("id", item.id)
    }

    setSavedCount(changedItems.length)
    setItems(prev => prev.map(i =>
      sealedCounts[i.id] !== undefined && sealedCounts[i.id] !== ""
        ? { ...i, sealed_boxes: parseInt(sealedCounts[i.id], 10) }
        : i
    ))
    setSaving(false)
  }

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: C.sub }}>
      読み込み中…
    </div>
  )

  return (
    <main style={{ maxWidth: 600, margin: "0 auto", background: C.bg, minHeight: "100vh", paddingBottom: 100 }}>
      <div style={{
        background: "#fff", padding: "10px 14px 8px",
        borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, zIndex: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <button onClick={() => router.push("/inventory")} style={{
            background: "#e8f5ec", color: C.primary, border: "1px solid #b2dfbd",
            borderRadius: 7, padding: "5px 11px", fontSize: 12, fontWeight: "bold", cursor: "pointer",
          }}>← 在庫</button>
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: "bold", color: C.text, flex: 1 }}>
            📋 棚卸しモード
          </h1>
          <button onClick={() => router.push("/inventory/stocktake/report")} style={{
            background: "#eff6ff", color: C.blue, border: "1.5px solid #bfdbfe",
            borderRadius: 7, padding: "5px 11px", fontSize: 12, fontWeight: "bold", cursor: "pointer",
          }}>📄 報告書</button>
          {changedItems.length > 0 && (
            <span style={{ background: C.orange, color: "#fff", borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: "bold" }}>
              {changedItems.length}件変更
            </span>
          )}
        </div>

        <button onClick={startScan} style={{
          width: "100%", padding: "9px 0", borderRadius: 8, background: C.blue, color: "#fff",
          border: "none", fontWeight: "bold", fontSize: 14, cursor: "pointer", marginBottom: 8,
        }}>📷 バーコードで商品を探す</button>

        {locations.length > 2 && (
          <div style={{ display: "flex", overflowX: "auto", gap: 6, paddingBottom: 2 }}>
            {locations.map(loc => (
              <button key={loc} onClick={() => setLocFilter(loc)} style={{
                whiteSpace: "nowrap", padding: "5px 12px", borderRadius: 999, fontSize: 12,
                cursor: "pointer", border: "none", fontWeight: locFilter === loc ? "bold" : "normal",
                background: locFilter === loc ? C.primary : "#f3f4f6",
                color: locFilter === loc ? "#fff" : C.sub, flexShrink: 0,
              }}>📍 {loc === "すべて" ? "すべての場所" : loc}</button>
            ))}
          </div>
        )}
      </div>

      {scanning && <div id="st-reader" style={{ width: "100%" }} />}

      {savedCount !== null && (
        <div style={{ margin: "12px 10px 0", background: "#f0fdf4", border: "2px solid #86efac", borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>✅</span>
          <div>
            <div style={{ fontWeight: "bold", color: "#166534" }}>{savedCount}件の未開封箱数を保存しました</div>
            <div style={{ fontSize: 12, color: "#16a34a" }}>報告書CSVに反映されます</div>
          </div>
          <button onClick={() => setSavedCount(null)} style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#86efac" }}>✕</button>
        </div>
      )}

      {/* 説明 */}
      <div style={{ margin: "10px 10px 0", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#92400e" }}>
        📦 <strong>未開封箱数</strong>を入力してください。在庫数（日常管理）とは独立して保存されます。
      </div>

      <div style={{ padding: "10px 10px 0" }}>
        {groups.map(({ loc, items: groupItems }) => (
          <section key={loc} style={{ marginBottom: 20 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "7px 12px", background: "#e8f5ec", borderRadius: 9,
              border: "1px solid #bbf7d0", marginBottom: 6,
            }}>
              <span style={{ fontSize: 14 }}>📍</span>
              <span style={{ fontSize: 14, fontWeight: "bold", color: C.primary }}>{loc}</span>
              <span style={{ fontSize: 12, color: C.sub, marginLeft: "auto" }}>
                {groupItems.filter(i => isChanged(i)).length > 0 && (
                  <span style={{ color: C.orange, fontWeight: "bold" }}>
                    {groupItems.filter(i => isChanged(i)).length}件変更・
                  </span>
                )}
                {groupItems.length}品目
              </span>
            </div>

            {groupItems.map(item => {
              const changed = isChanged(item)
              const val = getSealedCount(item.id)

              return (
                <div key={item.id} style={{
                  background: changed ? "#fffbeb" : "#fff",
                  border: `1.5px solid ${changed ? "#fde047" : C.border}`,
                  borderRadius: 10, padding: "10px 12px", marginBottom: 6,
                  display: "flex", alignItems: "center", gap: 10,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: "bold", fontSize: 14, color: C.text, marginBottom: 2 }}>
                      {item.product_name}
                    </div>
                    <div style={{ fontSize: 11, color: C.sub }}>
                      {[
                        item.maker,
                        item.shelf_no ? `棚 ${item.shelf_no}` : null,
                        item.units_per_package ? `${item.units_per_package}${item.unit || "本"}/箱` : null,
                      ].filter(Boolean).join("  ")}
                    </div>
                  </div>

                  {/* 在庫数（参考・変更不可） */}
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 2 }}>在庫数（参考）</div>
                    <div style={{ fontSize: 14, color: "#9ca3af", fontWeight: "bold" }}>
                      {item.stock_quantity}{item.unit || ""}
                    </div>
                  </div>

                  <div style={{ color: C.sub, fontSize: 14, flexShrink: 0 }}>→</div>

                  {/* 未開封箱数入力 */}
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: changed ? C.orange : C.sub, fontWeight: changed ? "bold" : "normal", marginBottom: 2 }}>
                      未開封箱数
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        ref={el => { inputRefs.current[item.id] = el }}
                        type="number" min="0"
                        value={val}
                        placeholder="—"
                        onChange={e => setSealedCount(item.id, e.target.value)}
                        onKeyDown={e => handleKeyDown(e, item.id)}
                        onFocus={e => e.target.select()}
                        style={{
                          width: 56, height: 36, textAlign: "center",
                          borderRadius: 8, fontSize: 18, fontWeight: "bold",
                          border: `2px solid ${changed ? C.orange : C.border}`,
                          background: changed ? "#fff" : "#f9fafb",
                          color: changed ? C.orange : C.text,
                          outline: "none",
                        }} />
                      <span style={{ fontSize: 12, color: C.sub }}>箱</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </section>
        ))}

        {filtered.length === 0 && (
          <div style={{ textAlign: "center", color: C.sub, padding: "60px 0" }}>商品がありません</div>
        )}
      </div>

      <div style={{
        position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: "100%", maxWidth: 600,
        background: "#fff", borderTop: `1px solid ${C.border}`, padding: "12px 16px", zIndex: 30,
      }}>
        <button onClick={saveAll} disabled={saving || changedItems.length === 0}
          style={{
            width: "100%", padding: "14px 0", borderRadius: 12, border: "none",
            background: saving || changedItems.length === 0 ? "#d1d5db" : C.primary,
            color: "#fff", fontWeight: "bold", fontSize: 16,
            cursor: saving || changedItems.length === 0 ? "default" : "pointer",
          }}>
          {saving ? "保存中…" : changedItems.length === 0 ? "変更なし" : `✅ ${changedItems.length}件の未開封箱数を保存する`}
        </button>
        <p style={{ textAlign: "center", fontSize: 11, color: C.sub, margin: "5px 0 0" }}>
          在庫数（日常管理）には影響しません
        </p>
      </div>
    </main>
  )
}
