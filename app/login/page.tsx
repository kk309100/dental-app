"use client"

import { useState } from "react"
import { supabase } from "@/lib/supabase"
import { useRouter } from "next/navigation"

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
      alert("ログイン失敗")
      setLoading(false)
      return
    }

    // プロフィール確認
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .single()

    if (profile?.role === "admin") {
      router.push("/admin")
    } else {
      router.push("/order")
    }

    setLoading(false)
  }

  return (
    <main style={{ maxWidth: 400, margin: "0 auto", padding: 20 }}>
      <h1>ログイン</h1>

      <input
        placeholder="メールアドレス"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={input}
      />

      <input
        placeholder="パスワード"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={input}
      />

      <button onClick={handleLogin} style={button} disabled={loading}>
        {loading ? "ログイン中..." : "ログイン"}
      </button>
    </main>
  )
}

const input = {
  width: "100%",
  padding: 12,
  marginBottom: 12,
  borderRadius: 8,
  border: "1px solid #ddd",
}

const button = {
  width: "100%",
  padding: 14,
  borderRadius: 10,
  background: "#111",
  color: "#fff",
  border: "none",
}