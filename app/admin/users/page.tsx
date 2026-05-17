"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

type UserRow = {
  id: string
  login_code: string | null
  role: string
  clinic_id: string | null
  clinic_name: string
}

export default function UsersPage() {
  const [users, setUsers]       = useState<UserRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [passwords, setPasswords] = useState<Record<string, string>>({})
  const [saving, setSaving]     = useState<string | null>(null)
  const [done, setDone]         = useState<string | null>(null)

  useEffect(() => { fetchUsers() }, [])

  async function fetchUsers() {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, login_code, role, clinic_id, clinics(name)")
      .order("role")

    if (!profiles) { setLoading(false); return }

    setUsers(profiles.map((p: any) => ({
      id: p.id,
      login_code: p.login_code ?? null,
      role: p.role ?? "-",
      clinic_id: p.clinic_id,
      clinic_name: p.clinics?.name ?? "-",
    })))
    setLoading(false)
  }

  async function setPassword(userId: string) {
    const newPassword = passwords[userId]?.trim()
    if (!newPassword) { alert("パスワードを入力してください。"); return }
    if (newPassword.length < 6) { alert("パスワードは6文字以上にしてください。"); return }

    setSaving(userId)
    setDone(null)

    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { alert("セッションが切れています。再ログインしてください。"); setSaving(null); return }

    const res = await fetch("/api/admin/set-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId, newPassword }),
    })

    const json = await res.json()
    if (!res.ok) {
      alert(`エラー: ${json.error}`)
      setSaving(null)
      return
    }

    // login_code をローカル更新
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, login_code: newPassword } : u))
    setPasswords((prev) => ({ ...prev, [userId]: "" }))
    setDone(userId)
    setSaving(null)
    setTimeout(() => setDone(null), 3000)
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <h1 style={{ fontSize: 20, fontWeight: "bold", marginBottom: 6, color: "#111" }}>👤 ユーザー管理</h1>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24 }}>
        パスワードを設定すると、医院スタッフはそのパスワード1つだけでログインできるようになります。
      </p>

      {loading ? (
        <p style={{ color: "#999" }}>読み込み中…</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {users.map((u) => (
            <div key={u.id} style={{
              background: "#fff", borderRadius: 14, padding: "16px 18px",
              border: "1px solid #e5e7eb", boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
            }}>
              {/* ユーザー情報 */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{
                  fontSize: 11, fontWeight: "bold", padding: "3px 10px", borderRadius: 999,
                  background: u.role === "admin" ? "#fef3c7" : "#e8f5ec",
                  color: u.role === "admin" ? "#92400e" : "#166534",
                }}>
                  {u.role === "admin" ? "管理者" : "医院"}
                </span>
                <span style={{ fontSize: 14, fontWeight: "bold", color: "#111" }}>
                  {u.clinic_name !== "-" ? u.clinic_name : "（医院未設定）"}
                </span>
                {u.login_code && (
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>
                    現在のPW：<code style={{ background: "#f3f4f6", padding: "1px 6px", borderRadius: 4 }}>{u.login_code}</code>
                  </span>
                )}
              </div>

              {/* パスワード設定 */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="text"
                  value={passwords[u.id] ?? ""}
                  onChange={(e) => setPasswords((prev) => ({ ...prev, [u.id]: e.target.value }))}
                  placeholder={u.login_code ? "新しいパスワード" : "パスワードを設定（6文字以上）"}
                  style={{
                    flex: 1, padding: "9px 12px", borderRadius: 8,
                    border: "1.5px solid #e5e7eb", fontSize: 14, outline: "none", color: "#1a1a1a",
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") setPassword(u.id) }}
                />
                <button
                  onClick={() => setPassword(u.id)}
                  disabled={saving === u.id}
                  style={{
                    padding: "9px 18px", borderRadius: 8, border: "none",
                    background: done === u.id ? "#059669" : saving === u.id ? "#d1d5db" : "#22a648",
                    color: "#fff", fontWeight: "bold", fontSize: 13, cursor: saving === u.id ? "not-allowed" : "pointer",
                    whiteSpace: "nowrap", transition: "background 0.2s",
                  }}>
                  {done === u.id ? "✓ 設定済" : saving === u.id ? "設定中…" : "設定する"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 28, padding: "14px 16px", background: "#fff7e6", border: "1px solid #fde68a", borderRadius: 10 }}>
        <p style={{ margin: 0, fontSize: 13, color: "#92400e", lineHeight: 1.6 }}>
          <strong>注意：</strong>設定したパスワードは画面上に表示されます。スタッフへの共有は口頭またはメモで行ってください。管理者アカウントのパスワードはここから変更しないことを推奨します。
        </p>
      </div>
    </div>
  )
}
