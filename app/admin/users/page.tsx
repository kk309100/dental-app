"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

type UserRow = {
  id: string
  login_code: string | null
  role: string
  clinic_id: string | null
  clinic_name?: string
  email?: string
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => { fetchUsers() }, [])

  async function fetchUsers() {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, login_code, role, clinic_id, clinics(name)")
      .order("role")

    if (!profiles) { setLoading(false); return }

    const rows: UserRow[] = profiles.map((p: any) => ({
      id: p.id,
      login_code: p.login_code || null,
      role: p.role || "-",
      clinic_id: p.clinic_id,
      clinic_name: p.clinics?.name || "-",
    }))

    setUsers(rows)
    const initEdit: Record<string, string> = {}
    rows.forEach((r) => { initEdit[r.id] = r.login_code || "" })
    setEditing(initEdit)
    setLoading(false)
  }

  async function saveLoginCode(userId: string) {
    const code = editing[userId]?.trim()
    setSaving(userId)
    const { error } = await supabase
      .from("profiles")
      .update({ login_code: code || null })
      .eq("id", userId)
    if (error) {
      alert("保存できませんでした。このIDはすでに使われているかもしれません。")
    } else {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, login_code: code || null } : u))
    }
    setSaving(null)
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <h1 style={{ fontSize: 20, fontWeight: "bold", marginBottom: 8, color: "#111" }}>👤 ユーザー管理</h1>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24 }}>
        各ユーザーのログインIDを設定します。ログインIDは半角英数字推奨です（重複不可）。
      </p>

      {loading ? (
        <p style={{ color: "#999" }}>読み込み中…</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {users.map((u) => (
            <div key={u.id} style={{
              background: "#fff", borderRadius: 12, padding: "14px 16px",
              border: "1px solid #e5e7eb", boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            }}>
              {/* ユーザー情報 */}
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <span style={{
                    fontSize: 11, fontWeight: "bold", padding: "2px 8px", borderRadius: 999,
                    background: u.role === "admin" ? "#fef3c7" : "#e8f5ec",
                    color: u.role === "admin" ? "#92400e" : "#166534",
                  }}>
                    {u.role === "admin" ? "管理者" : "医院"}
                  </span>
                  {u.clinic_name !== "-" && (
                    <span style={{ fontSize: 12, color: "#374151", fontWeight: "bold" }}>{u.clinic_name}</span>
                  )}
                </div>
                <p style={{ margin: 0, fontSize: 11, color: "#9ca3af", fontFamily: "monospace" }}>
                  {u.id.slice(0, 16)}…
                </p>
              </div>

              {/* ログインID入力 */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <div>
                  <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 3 }}>ログインID</label>
                  <input
                    value={editing[u.id] ?? ""}
                    onChange={(e) => setEditing((prev) => ({ ...prev, [u.id]: e.target.value }))}
                    placeholder="未設定"
                    style={{
                      padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e5e7eb",
                      fontSize: 14, width: 160, outline: "none", color: "#1a1a1a",
                    }}
                  />
                </div>
                <button
                  onClick={() => saveLoginCode(u.id)}
                  disabled={saving === u.id}
                  style={{
                    marginTop: 18, padding: "8px 16px", borderRadius: 8, border: "none",
                    background: saving === u.id ? "#d1d5db" : "#22a648",
                    color: "#fff", fontWeight: "bold", fontSize: 13,
                    cursor: saving === u.id ? "not-allowed" : "pointer",
                  }}>
                  {saving === u.id ? "保存中" : "保存"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
