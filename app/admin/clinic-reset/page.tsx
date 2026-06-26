"use client"

// 医院データリセットユーティリティ
// テスト・試用終了後にデータを初期化するための管理者専用ページ

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

type Clinic = { id: string; name: string }

type CountResult = {
  inventory_items: number
  inventory_logs: number
  orders: number
  order_items: number
}

export default function ClinicResetPage() {
  const [clinics, setClinics]       = useState<Clinic[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [counts, setCounts]         = useState<CountResult | null>(null)
  const [counting, setCounting]     = useState(false)
  const [resetting, setResetting]   = useState(false)
  const [done, setDone]             = useState<string | null>(null)
  const [confirm, setConfirm]       = useState("")

  useEffect(() => {
    supabase.from("clinics").select("id,name").order("name").limit(1000)
      .then(({ data }) => setClinics((data as Clinic[]) || []))
  }, [])

  async function countData(clinicId: string) {
    setCounting(true)
    setCounts(null)
    setDone(null)
    setConfirm("")

    const [invItems, invLogs, ordersRes] = await Promise.all([
      supabase.from("clinic_inventory_items").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId),
      supabase.from("inventory_logs").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId),
      supabase.from("orders").select("id").eq("clinic_id", clinicId).limit(100000),
    ])

    const orderIds = (ordersRes.data || []).map((o: { id: string }) => o.id)
    let orderItemCount = 0
    if (orderIds.length > 0) {
      const { count } = await supabase.from("order_items")
        .select("id", { count: "exact", head: true })
        .in("order_id", orderIds)
      orderItemCount = count || 0
    }

    setCounts({
      inventory_items: invItems.count || 0,
      inventory_logs:  invLogs.count  || 0,
      orders:          orderIds.length,
      order_items:     orderItemCount,
    })
    setCounting(false)
  }

  async function doReset() {
    if (!selectedId || !counts) return
    const clinic = clinics.find(c => c.id === selectedId)
    if (confirm !== clinic?.name) { alert("医院名が一致しません"); return }

    setResetting(true)
    try {
      // 1. inventory_logs
      await supabase.from("inventory_logs").delete().eq("clinic_id", selectedId)

      // 2. clinic_inventory_items
      await supabase.from("clinic_inventory_items").delete().eq("clinic_id", selectedId)

      // 3. order_items → orders
      const { data: orders } = await supabase.from("orders").select("id").eq("clinic_id", selectedId).limit(100000)
      const orderIds = (orders || []).map((o: { id: string }) => o.id)
      if (orderIds.length > 0) {
        // order_items を500件ずつ削除
        for (let i = 0; i < orderIds.length; i += 500) {
          await supabase.from("order_items").delete().in("order_id", orderIds.slice(i, i + 500))
        }
        await supabase.from("orders").delete().eq("clinic_id", selectedId)
      }

      setDone(clinic?.name || "")
      setCounts(null)
      setConfirm("")
    } catch (e: any) {
      alert("エラーが発生しました: " + e.message)
    }
    setResetting(false)
  }

  const selectedClinic = clinics.find(c => c.id === selectedId)

  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginBottom: 4 }}>
        🗑 医院データリセット
      </h1>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 28 }}>
        試用終了・データ初期化のためのユーティリティです。削除したデータは復元できません。
      </p>

      {/* Step 1: 医院選択 */}
      <div style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 14, padding: 20, marginBottom: 16 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 10 }}>
          Step 1：リセットする医院を選択
        </p>
        <select value={selectedId}
          onChange={e => { setSelectedId(e.target.value); setCounts(null); setDone(null); setConfirm("") }}
          style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: "1.5px solid #e5e7eb", fontSize: 15, color: "#111827" }}>
          <option value="">医院を選択…</option>
          {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {selectedId && (
          <button onClick={() => countData(selectedId)} disabled={counting}
            style={{
              marginTop: 12, width: "100%", padding: "11px 0", borderRadius: 10, border: "none",
              background: counting ? "#d1d5db" : "#2563eb", color: "#fff",
              fontSize: 14, fontWeight: 700, cursor: counting ? "default" : "pointer",
            }}>
            {counting ? "データ件数を確認中…" : "データ件数を確認する"}
          </button>
        )}
      </div>

      {/* Step 2: 確認 */}
      {counts && selectedClinic && (
        <div style={{ background: "#fff", border: "2px solid #fca5a5", borderRadius: 14, padding: 20, marginBottom: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#b91c1c", marginBottom: 14 }}>
            Step 2：削除されるデータを確認
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
            {[
              { label: "在庫品目",     count: counts.inventory_items, unit: "品目" },
              { label: "在庫操作ログ", count: counts.inventory_logs,  unit: "件" },
              { label: "注文",         count: counts.orders,          unit: "件" },
              { label: "注文明細",     count: counts.order_items,     unit: "件" },
            ].map(({ label, count, unit }) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: 8, background: count > 0 ? "#fee2e2" : "#f9fafb" }}>
                <span style={{ fontSize: 14, color: "#374151" }}>{label}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: count > 0 ? "#dc2626" : "#9ca3af" }}>
                  {count.toLocaleString()} {unit}
                </span>
              </div>
            ))}
          </div>

          {counts.inventory_items + counts.inventory_logs + counts.orders === 0 ? (
            <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 14 }}>削除するデータはありません</p>
          ) : (
            <>
              <p style={{ fontSize: 13, color: "#374151", marginBottom: 8 }}>
                確認のため、医院名「<strong>{selectedClinic.name}</strong>」を入力してください：
              </p>
              <input value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder={selectedClinic.name}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: "1.5px solid #fca5a5", fontSize: 15, boxSizing: "border-box", marginBottom: 12 }} />
              <button onClick={doReset}
                disabled={resetting || confirm !== selectedClinic.name}
                style={{
                  width: "100%", padding: "13px 0", borderRadius: 10, border: "none",
                  background: resetting || confirm !== selectedClinic.name ? "#d1d5db" : "#dc2626",
                  color: "#fff", fontSize: 15, fontWeight: 700,
                  cursor: resetting || confirm !== selectedClinic.name ? "default" : "pointer",
                }}>
                {resetting ? "削除中…" : "すべて削除する（取り消し不可）"}
              </button>
            </>
          )}
        </div>
      )}

      {/* 完了 */}
      {done && (
        <div style={{ background: "#f0fdf4", border: "2px solid #86efac", borderRadius: 14, padding: 20, textAlign: "center" }}>
          <p style={{ fontSize: 16, fontWeight: 700, color: "#166534", margin: 0 }}>
            ✅ {done} のデータをすべて削除しました
          </p>
        </div>
      )}
    </div>
  )
}
