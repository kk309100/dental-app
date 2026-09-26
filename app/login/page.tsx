"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

export default function LoginPage() {
  const router = useRouter()
  const [password, setPassword]     = useState("")
  const [loading, setLoading]       = useState(false)
  const [adminMode, setAdminMode]   = useState(false)
  const [adminEmail, setAdminEmail] = useState("")

  async function handleLogin() {
    if (!password) return
    setLoading(true)

    if (adminMode) {
      // 管理者：メール + パスワード
      if (!adminEmail.trim()) { alert("メールアドレスを入力してください。"); setLoading(false); return }
      const { data, error } = await supabase.auth.signInWithPassword({ email: adminEmail.trim(), password })
      if (error) { alert("メールアドレスまたはパスワードが正しくありません。"); setLoading(false); return }
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).single()
      router.push(profile?.role === "admin" ? "/admin" : "/menu")
      return
    }

    // 医院：パスワードのみ（login_code でメールを逆引き）
    const { data: email, error: rpcError } = await supabase.rpc("get_email_by_login_code", {
      p_code: password.trim(),
    })

    if (rpcError || !email) {
      alert("パスワードが正しくありません。")
      setLoading(false)
      return
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password: password.trim() })
    if (error) { alert("パスワードが正しくありません。"); setLoading(false); return }

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).single()
    router.push(profile?.role === "admin" ? "/admin" : "/menu")
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f8f9fa", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 360 }}>
        {/* ロゴ */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>🦷</div>
          <h1 style={{ fontSize: 22, fontWeight: "bold", color: "#1a1a1a", margin: 0 }}>歯科医院システム</h1>
        </div>

        {/* フォーム */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "28px 24px", boxShadow: "0 2px 16px rgba(0,0,0,0.08)" }}>
          {adminMode && (
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>メールアドレス</label>
              <input
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="admin@example.com"
                type="email"
                autoComplete="email"
                style={inputStyle}
              />
            </div>
          )}

          <div style={{ marginBottom: 22 }}>
            <label style={labelStyle}>パスワード</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="パスワードを入力"
              autoComplete="current-password"
              onKeyDown={(e) => { if (e.key === "Enter") handleLogin() }}
              style={inputStyle}
            />
          </div>

          <button onClick={handleLogin} disabled={loading || !password} style={{
            width: "100%", padding: 14, borderRadius: 10, border: "none",
            background: loading || !password ? "#9ca3af" : "#22a648",
            color: "#fff", fontWeight: "bold", fontSize: 15,
            cursor: loading || !password ? "not-allowed" : "pointer",
          }}>
            {loading ? "ログイン中..." : "ログイン"}
          </button>
        </div>

        {/* 管理者切り替え */}
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <button
            onClick={() => { setAdminMode(!adminMode); setPassword(""); setAdminEmail("") }}
            style={{ background: "none", border: "none", color: "#9ca3af", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
            {adminMode ? "← 医院ログインに戻る" : "管理者ログイン"}
          </button>
        </div>
      </div>
    </main>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: "bold", color: "#6b7280", display: "block", marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "11px 13px", borderRadius: 8,
  border: "1.5px solid #e5e7eb", fontSize: 15,
  boxSizing: "border-box", outline: "none", color: "#1a1a1a",
}
