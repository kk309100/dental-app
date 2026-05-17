"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

export default function LoginPage() {
  const router = useRouter()
  const [loginCode, setLoginCode] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    if (!loginCode.trim() || !password) {
      alert("ログインIDとパスワードを入力してください。")
      return
    }
    setLoading(true)

    // ログインIDからメールアドレスを取得
    const { data: email, error: rpcError } = await supabase.rpc("get_email_by_login_code", {
      p_code: loginCode.trim(),
    })

    if (rpcError || !email) {
      alert("ログインIDが見つかりません。")
      setLoading(false)
      return
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      alert("パスワードが正しくありません。")
      setLoading(false)
      return
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .single()

    if (!profile) {
      alert("プロフィールがありません。管理者に連絡してください。")
      setLoading(false)
      return
    }

    if (profile.role === "admin") {
      router.push("/admin")
      return
    }

    router.push("/menu")
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f8f9fa", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        {/* ロゴ */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>🦷</div>
          <h1 style={{ fontSize: 22, fontWeight: "bold", color: "#1a1a1a", margin: 0 }}>歯科医院システム</h1>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>ログイン</p>
        </div>

        {/* フォーム */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "28px 24px", boxShadow: "0 2px 16px rgba(0,0,0,0.08)" }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: "bold", color: "#374151", display: "block", marginBottom: 6 }}>
              ログインID
            </label>
            <input
              value={loginCode}
              onChange={(e) => setLoginCode(e.target.value)}
              placeholder="例：yamamoto"
              autoComplete="username"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 12, fontWeight: "bold", color: "#374151", display: "block", marginBottom: 6 }}>
              パスワード
            </label>
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

          <button onClick={handleLogin} disabled={loading} style={{
            width: "100%", padding: 14, borderRadius: 10, border: "none",
            background: loading ? "#9ca3af" : "#22a648",
            color: "#fff", fontWeight: "bold", fontSize: 15, cursor: loading ? "not-allowed" : "pointer",
          }}>
            {loading ? "ログイン中..." : "ログイン"}
          </button>
        </div>
      </div>
    </main>
  )
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 13px",
  borderRadius: 8,
  border: "1.5px solid #e5e7eb",
  fontSize: 15,
  boxSizing: "border-box",
  outline: "none",
  color: "#1a1a1a",
}
