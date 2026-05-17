"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

export default function MenuPage() {
  const router = useRouter()
  const [clinicName, setClinicName] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkLogin()
  }, [])

  async function checkLogin() {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) { router.push("/login"); return }

    const { data: profile } = await supabase
      .from("profiles").select("*").eq("id", userData.user.id).single()

    if (!profile) { router.push("/login"); return }
    if (profile.role === "admin") { router.push("/admin"); return }

    const { data: clinic } = await supabase
      .from("clinics").select("name").eq("id", profile.clinic_id).single()

    setClinicName(clinic?.name || "")
    setLoading(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push("/login")
  }

  if (loading) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#999" }}>読み込み中…</div>
  }

  const menus = [
    {
      href: "/order",
      icon: "🛒",
      label: "注文する",
      desc: "商品を選んで注文",
      color: "#1a56db",
      bg: "#e8f0fe",
    },
    {
      href: "/history",
      icon: "📋",
      label: "注文履歴",
      desc: "過去の注文を確認",
      color: "#059669",
      bg: "#d1fae5",
    },
    {
      href: "/inventory",
      icon: "📦",
      label: "在庫管理",
      desc: "院内在庫の確認・管理",
      color: "#7c3aed",
      bg: "#ede9fe",
    },
  ]

  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fb", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        {/* ヘッダー */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🦷</div>
          <h1 style={{ fontSize: 20, fontWeight: "bold", color: "#111", margin: 0 }}>歯科医院システム</h1>
          {clinicName && (
            <p style={{ fontSize: 13, color: "#888", marginTop: 6, marginBottom: 0 }}>{clinicName}</p>
          )}
        </div>

        {/* メニューカード */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {menus.map((m) => (
            <button
              key={m.href}
              onClick={() => router.push(m.href)}
              style={{
                display: "flex", alignItems: "center", gap: 18,
                background: "#fff", border: "1.5px solid #e8eaed",
                borderRadius: 16, padding: "20px 22px",
                cursor: "pointer", textAlign: "left", width: "100%",
                boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                transition: "transform 0.1s, box-shadow 0.1s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 16px rgba(0,0,0,0.12)" }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)" }}
            >
              <div style={{
                width: 56, height: 56, borderRadius: 14,
                background: m.bg, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 28, flexShrink: 0,
              }}>
                {m.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 17, fontWeight: "bold", color: m.color }}>{m.label}</div>
                <div style={{ fontSize: 12, color: "#888", marginTop: 3 }}>{m.desc}</div>
              </div>
              <div style={{ color: "#ccc", fontSize: 20 }}>›</div>
            </button>
          ))}
        </div>

        {/* ログアウト */}
        <div style={{ textAlign: "center", marginTop: 32 }}>
          <button onClick={handleLogout}
            style={{ background: "none", border: "none", color: "#aaa", fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>
            ログアウト
          </button>
        </div>
      </div>
    </div>
  )
}
