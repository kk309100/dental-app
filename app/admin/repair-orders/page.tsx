"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Link from "next/link"

type RepairOrder = {
  id: string
  receipt_number: string | null
  clinic_id: string | null
  contact_person: string | null
  equipment_name: string
  model_number: string | null
  fault_description: string | null
  desired_delivery_date: string | null
  repair_destination: string | null
  status: string
  notes: string | null
  created_at: string
}
type Clinic = { id: string; name: string }

const STATUSES = ["受付中", "対応中", "修理完了", "返却済み", "キャンセル"] as const
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  "受付中":   { bg: "#fef3c7", color: "#92400e" },
  "対応中":   { bg: "#dbeafe", color: "#1e40af" },
  "修理完了": { bg: "#dcfce7", color: "#15803d" },
  "返却済み": { bg: "#f3f4f6", color: "#6b7280" },
  "キャンセル":{ bg: "#f3f4f6", color: "#6b7280" },
}

export default function RepairOrdersPage() {
  const router = useRouter()
  const [rows, setRows]       = useState<RepairOrder[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState("")
  const [statusFilter, setStatusFilter] = useState("all")

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [r, c] = await Promise.all([
      supabase.from("repair_orders").select("*").order("created_at", { ascending: false }).limit(10000),
      supabase.from("clinics").select("id,name").order("name").limit(10000),
    ])
    setRows((r.data as RepairOrder[]) || [])
    setClinics((c.data as Clinic[]) || [])
    setLoading(false)
  }

  async function updateStatus(id: string, status: string) {
    await supabase.from("repair_orders").update({ status }).eq("id", id)
    setRows(prev => prev.map(r => r.id === id ? { ...r, status } : r))
  }

  const clinicById = useMemo(() => new Map(clinics.map(c => [c.id, c])), [clinics])

  const filtered = useMemo(() => {
    const k = search.toLowerCase()
    return rows.filter(r => {
      const clinic = r.clinic_id ? clinicById.get(r.clinic_id)?.name || "" : ""
      const match = !k || [r.receipt_number, r.equipment_name, r.model_number, clinic, r.contact_person]
        .some(v => (v || "").toLowerCase().includes(k))
      const st = statusFilter === "all" || statusFilter === "active"
        ? (statusFilter === "active" ? !["返却済み", "キャンセル"].includes(r.status) : true)
        : r.status === statusFilter
      return match && st
    })
  }, [rows, search, statusFilter, clinicById])

  return (
    <div>
      {/* ヘッダー */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: "#111" }}>🔧 修理依頼書</h1>
          <p style={{ fontSize: 12, color: "#9ca3af", margin: "4px 0 0" }}>機器の修理依頼を管理します</p>
        </div>
        <Link href="/admin/repair-orders/new">
          <button style={{
            padding: "10px 20px", background: "#2563eb", color: "#fff",
            border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            ＋ 新規作成
          </button>
        </Link>
      </div>

      {/* フィルター */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="受付番号・医院名・機器名で検索"
          style={{
            padding: "8px 14px", border: "1.5px solid #e5e7eb", borderRadius: 8,
            fontSize: 13, outline: "none", minWidth: 220, flex: 1,
          }}
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: "8px 12px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13, background: "#fff", cursor: "pointer" }}
        >
          <option value="all">すべて</option>
          <option value="active">進行中のみ</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading ? (
        <p style={{ color: "#9ca3af", textAlign: "center", padding: 40 }}>読み込み中…</p>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "#9ca3af" }}>
          <p style={{ fontSize: 40, margin: "0 0 12px" }}>🔧</p>
          <p style={{ fontSize: 14 }}>修理依頼がありません</p>
          <Link href="/admin/repair-orders/new">
            <button style={{ marginTop: 12, padding: "10px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>
              最初の修理依頼を作成
            </button>
          </Link>
        </div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                <th style={th}>受付番号</th>
                <th style={th}>依頼日</th>
                <th style={th}>医院名</th>
                <th style={th}>担当者</th>
                <th style={th}>機器名</th>
                <th style={th}>修理先</th>
                <th style={th}>希望納期</th>
                <th style={{ ...th, textAlign: "center" }}>ステータス</th>
                <th style={{ ...th, textAlign: "center" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const clinic = r.clinic_id ? clinicById.get(r.clinic_id)?.name || "—" : "—"
                const ss = STATUS_STYLE[r.status] || { bg: "#f3f4f6", color: "#6b7280" }
                return (
                  <tr key={r.id}
                    onClick={() => router.push(`/admin/repair-orders/${r.id}`)}
                    style={{ borderBottom: "1px solid #f3f4f6", cursor: "pointer" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}
                  >
                    <td style={td} className="font-mono">{r.receipt_number || r.id.slice(0, 8)}</td>
                    <td style={td}>{r.created_at.slice(0, 10)}</td>
                    <td style={td}>{clinic}</td>
                    <td style={td}>{r.contact_person || "—"}</td>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {r.equipment_name}
                      {r.model_number && <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 5 }}>{r.model_number}</span>}
                    </td>
                    <td style={td}>{r.repair_destination || "—"}</td>
                    <td style={td}>{r.desired_delivery_date || "—"}</td>
                    <td style={{ ...td, textAlign: "center" }} onClick={e => e.stopPropagation()}>
                      <select
                        value={r.status}
                        onChange={e => updateStatus(r.id, e.target.value)}
                        style={{ padding: "3px 6px", borderRadius: 6, border: "none", fontSize: 11, fontWeight: 700, background: ss.bg, color: ss.color, cursor: "pointer" }}
                      >
                        {STATUSES.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td style={{ ...td, textAlign: "center" }} onClick={e => e.stopPropagation()}>
                      <Link href={`/admin/repair-orders/${r.id}`}>
                        <button style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, border: "1px solid #e5e7eb", background: "#f9fafb", cursor: "pointer", marginRight: 4 }}>
                          詳細
                        </button>
                      </Link>
                      <button
                        onClick={async () => {
                          if (!confirm("削除しますか？")) return
                          await supabase.from("repair_orders").delete().eq("id", r.id)
                          fetchData()
                        }}
                        style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, border: "1px solid #fca5a5", background: "#fff7f7", color: "#ef4444", cursor: "pointer" }}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ padding: "8px 16px", borderTop: "1px solid #f3f4f6", fontSize: 11, color: "#9ca3af" }}>
            {filtered.length}件表示
          </div>
        </div>
      )}
    </div>
  )
}

const th: React.CSSProperties = { padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#6b7280", fontSize: 12, whiteSpace: "nowrap" }
const td: React.CSSProperties = { padding: "10px 12px", color: "#374151" }
