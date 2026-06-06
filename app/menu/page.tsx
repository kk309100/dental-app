"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import {
  ShoppingCart, ClipboardList, Package, ScanLine,
  ChevronRight, LogOut, RefreshCw, Heart,
} from "lucide-react"

const MENUS = [
  {
    href: "/order",
    Icon: ShoppingCart,
    label: "注文する",
    desc: "商品を選んで発注",
    color: "#059669",
    bg: "#ecfdf5",
    border: "#a7f3d0",
  },
  {
    href: "/history",
    Icon: ClipboardList,
    label: "注文履歴",
    desc: "過去の注文・配送状況",
    color: "#2563eb",
    bg: "#eff6ff",
    border: "#bfdbfe",
  },
  {
    href: "/inventory",
    Icon: Package,
    label: "在庫管理",
    desc: "院内在庫の確認・管理",
    color: "#d97706",
    bg: "#fffbeb",
    border: "#fde68a",
  },
  {
    href: "/scan",
    Icon: ScanLine,
    label: "納品スキャン",
    desc: "バーコードで在庫を更新・再注文",
    color: "#7c3aed",
    bg: "#f5f3ff",
    border: "#ddd6fe",
  },
]

const SHORTCUTS = [
  { href: "/history", label: "前回の注文から再注文", Icon: RefreshCw, color: "#2563eb" },
  { href: "/order",   label: "お気に入り商品から注文",  Icon: Heart,      color: "#e11d48" },
]

export default function MenuPage() {
  const router = useRouter()
  const [clinicName, setClinicName] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => { checkLogin() }, [])

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
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#f8fafc" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 40, height: 40, border: "3px solid #e5e7eb", borderTopColor: "#059669",
            borderRadius: "50%", margin: "0 auto 12px", animation: "spin 0.8s linear infinite",
          }} />
          <p style={{ color: "#9ca3af", fontSize: 14, margin: 0 }}>読み込み中…</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", paddingBottom: 48 }}>
      <style>{`
        .menu-card { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .menu-card:active { transform: scale(0.97) !important; box-shadow: 0 1px 4px rgba(0,0,0,0.06) !important; }
        .shortcut-card { transition: opacity 0.1s; }
        .shortcut-card:active { opacity: 0.65; }
      `}</style>

      {/* ── ヘッダーグラデーション ── */}
      <div style={{
        background: "linear-gradient(150deg, #f0fdf4 0%, #eff6ff 100%)",
        padding: "52px 24px 28px",
      }}>
        <div style={{ maxWidth: 480, margin: "0 auto" }}>
          {/* ブランドロゴ行 */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
            <div style={{
              width: 50, height: 50, borderRadius: 15, background: "white",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 14px rgba(5,150,105,0.14)",
            }}>
              <span style={{ fontSize: 26 }}>🦷</span>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 19, fontWeight: 800, color: "#059669", letterSpacing: "-0.01em" }}>
                DentHub
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 11, fontWeight: 500, color: "#6b7280", letterSpacing: "0.02em" }}>
                発注・在庫管理
              </p>
            </div>
          </div>

          {/* 医院名カード */}
          {clinicName && (
            <div style={{
              background: "white", borderRadius: 16, padding: "14px 18px",
              boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
              border: "1px solid rgba(5,150,105,0.10)",
            }}>
              <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>ようこそ 👋</p>
              <p style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 700, color: "#111827" }}>
                {clinicName}&nbsp;<span style={{ fontSize: 13, fontWeight: 500, color: "#6b7280" }}>様</span>
              </p>
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: "0 auto", padding: "24px 16px" }}>

        {/* ── メインメニュー ── */}
        <p style={{ margin: "0 0 12px", fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.12em" }}>
          MENU
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 30 }}>
          {MENUS.map((m) => (
            <button
              key={m.href}
              className="menu-card"
              onClick={() => router.push(m.href)}
              style={{
                display: "flex", alignItems: "center", gap: 16,
                background: "white", border: `1.5px solid ${m.border}`,
                borderRadius: 20, padding: "18px 20px",
                cursor: "pointer", textAlign: "left", width: "100%",
                boxShadow: "0 2px 10px rgba(0,0,0,0.05)",
              }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLButtonElement
                el.style.transform = "translateY(-2px)"
                el.style.boxShadow = "0 8px 24px rgba(0,0,0,0.09)"
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLButtonElement
                el.style.transform = "translateY(0)"
                el.style.boxShadow = "0 2px 10px rgba(0,0,0,0.05)"
              }}
            >
              <div style={{
                width: 52, height: 52, borderRadius: 16, background: m.bg,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <m.Icon size={24} color={m.color} strokeWidth={1.8} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111827" }}>{m.label}</p>
                <p style={{ margin: "3px 0 0", fontSize: 12, color: "#9ca3af" }}>{m.desc}</p>
              </div>
              <ChevronRight size={18} color="#d1d5db" strokeWidth={2} />
            </button>
          ))}
        </div>

        {/* ── ショートカット ── */}
        <p style={{ margin: "0 0 12px", fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.12em" }}>
          SHORTCUTS
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 36 }}>
          {SHORTCUTS.map((s) => (
            <button
              key={s.href + s.label}
              className="shortcut-card"
              onClick={() => router.push(s.href)}
              style={{
                display: "flex", alignItems: "center", gap: 14,
                background: "white", border: "1px solid #f0f0f0",
                borderRadius: 14, padding: "13px 16px",
                cursor: "pointer", textAlign: "left", width: "100%",
                boxShadow: "0 1px 4px rgba(0,0,0,0.03)",
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 10, background: "#f9fafb",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <s.Icon size={16} color={s.color} strokeWidth={2} />
              </div>
              <span style={{ flex: 1, fontSize: 14, color: "#374151", fontWeight: 500 }}>{s.label}</span>
              <ChevronRight size={15} color="#e5e7eb" strokeWidth={2} />
            </button>
          ))}
        </div>

        {/* ── ログアウト ── */}
        <div style={{ textAlign: "center" }}>
          <button
            onClick={handleLogout}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: "none", border: "none",
              color: "#9ca3af", fontSize: 13, cursor: "pointer", padding: "8px 16px",
            }}
          >
            <LogOut size={14} color="#9ca3af" strokeWidth={2} />
            ログアウト
          </button>
        </div>
      </div>
    </div>
  )
}
