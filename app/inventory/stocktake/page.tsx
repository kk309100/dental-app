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
      .eq("in_stocktake", true)
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

  const today = new Date()
  const dateStr = `${today.getFullYear()}年${today.getMonth()+1}月${today.getDate()}日`

  return (
    <main style={{ maxWidth: 600, margin: "0 auto", background: C.bg, minHeight: "100vh", paddingBottom: 100 }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          @page { margin: 10mm; size: A4 portrait; }
          body { font-size: 10pt; }
          main { max-width: 100% !important; background: white !important; padding: 0 !important; }
          .print-table { width: 100%; border-collapse: collapse; margin-top: 6mm; }
          .print-table th { background: #f3f4f6 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; border: 1px solid #999; padding: 4px 6px; font-size: 8.5pt; text-align: center; }
          .print-table td { border: 1px solid #999; padding: 3px 6px; font-size: 8.5pt; }
          .print-loc-row td { background: #e8f5ec !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-weight: bold; }
          .write-box { display: inline-block; border-bottom: 1.5px solid #333; width: 42px; height: 18px; }
        }
        @media screen {
          .print-only { display: none !important; }
          .print-table { display: none; }
        }
      `}</style>
      <div className="no-print" style={{
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
          <button onClick={() => window.print()} style={{
            background: "#fff7ed", color: "#c2410c", border: "1.5px solid #fed7aa",
            borderRadius: 7, padding: "5px 11px", fontSize: 12, fontWeight: "bold", cursor: "pointer",
          }}>🖨 用紙印刷</button>
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

      {/* ── 印刷専用レイアウト（画面では非表示） ── */}
      <div className="print-only" style={{ padding: "0 4mm" }}>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: "bold" }}>棚卸し記入用紙</div>
          <div style={{ fontSize: 10, color: "#555" }}>{dateStr}　　担当者：_______________</div>
        </div>
        <table className="print-table">
          <thead>
            <tr>
              <th style={{ width: "36%", textAlign: "left" }}>商品名</th>
              <th style={{ width: "14%" }}>在庫場所</th>
              <th style={{ width: "12%" }}>入数/箱</th>
              <th style={{ width: "19%", textAlign: "center" }}>在庫数（本/個）</th>
              <th style={{ width: "19%", textAlign: "center" }}>未開封箱数</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ loc, items: groupItems }) => (
              <>
                <tr key={`loc-${loc}`} className="print-loc-row">
                  <td colSpan={5}>📍 {loc}</td>
                </tr>
                {groupItems.map(item => (
                  <tr key={item.id}>
                    <td>{item.product_name}{item.maker ? <span style={{ color: "#888", fontSize: "7.5pt" }}>　{item.maker}</span> : ""}</td>
                    <td style={{ textAlign: "center" }}>{item.shelf_no || ""}</td>
                    <td style={{ textAlign: "center" }}>{item.units_per_package ? `${item.units_per_package}${item.unit || "本"}` : "—"}</td>
                    <td style={{ textAlign: "center" }}><span className="write-box" /></td>
                    <td style={{ textAlign: "center" }}><span className="write-box" /></td>
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 8, color: "#888", marginTop: 6 }}>
          ※ 在庫数：本・個・枚など単品単位で記入　／　未開封箱数：封を開けていない箱の数を記入
        </p>
      </div>

      {savedCount !== null && (
        <div className="no-print" style={{ margin: "12px 10px 0", background: "#f0fdf4", border: "2px solid #86efac", borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>✅</span>
          <div>
            <div style={{ fontWeight: "bold", color: "#166534" }}>{savedCount}件の未開封箱数を保存しました</div>
            <div style={{ fontSize: 12, color: "#16a34a" }}>報告書CSVに反映されます</div>
          </div>
          <button onClick={() => setSavedCount(null)} style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#86efac" }}>✕</button>
        </div>
      )}

      {/* 説明 */}
      <div className="no-print" style={{ margin: "10px 10px 0", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#92400e" }}>
        📦 <strong>未開封箱数</strong>を入力してください。在庫数（日常管理）とは独立して保存されます。
      </div>

      <div className="no-print" style={{ padding: "10px 10px 0" }}>
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

      <div className="no-print" style={{
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
