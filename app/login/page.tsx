"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

export default function LoginPage() {
  const router = useRouter()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    setLoading(true)

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      alert("ログインできません。メールアドレスかパスワードを確認してください。")
      setLoading(false)
      return
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .single()

    if (!profile) {
      alert("プロフィールがありません。profilesテーブルを確認してください。")
      setLoading(false)
      return
    }

    if (profile.role === "admin") {
      router.push("/admin")
      return
    }

    router.push("/order")
  }

  return (
    <main style={{ maxWidth: 400, margin: "0 auto", padding: 20 }}>
      <h1>ログイン</h1>

      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="メールアドレス"
        style={inputStyle}
      />

      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="パスワード"
        type="password"
        style={inputStyle}
      />

      <button onClick={handleLogin} disabled={loading} style={buttonStyle}>
        {loading ? "ログイン中..." : "ログイン"}
      </button>
    </main>
  )
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 12,
  marginBottom: 12,
  borderRadius: 8,
  border: "1px solid #ddd",
  boxSizing: "border-box",
}

const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: 14,
  borderRadius: 10,
  border: "none",
  background: "#111",
  color: "#fff",
  fontWeight: "bold",
}