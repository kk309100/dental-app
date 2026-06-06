"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import { Ic } from "./_lib/icons"
import UserBadge from "@/app/components/UserBadge"
import { supabase } from "@/lib/supabase"
import "./admin-base.css"

const NAV = [
  { id: "home",           href: "/admin",                     label: "ホーム",     icon: Ic.dash,     exact: true },
  { id: "orders",         href: "/admin/orders",              label: "注文",       icon: Ic.order },
  { id: "purchase-orders",href: "/admin/purchase-orders",     label: "発注",       icon: Ic.truck },
  { id: "po-pool",        href: "/admin/purchase-orders/pool",label: "発注プール", icon: Ic.purchase },
  { id: "receivings",     href: "/admin/receivings",          label: "仕入納品",   icon: Ic.purchase },
  { id: "deliveries",     href: "/admin/deliveries",          label: "医院納品",   icon: Ic.doc },
  { id: "invoices",       href: "/admin/invoices",            label: "請求",       icon: Ic.sales },
  { id: "inventory",      href: "/admin/inventory",           label: "在庫",       icon: Ic.product },
  { id: "sales",          href: "/admin/sales",               label: "売上",       icon: Ic.sales },
  { id: "masters",        href: "/admin/masters",             label: "マスター",   icon: Ic.dash },
  { id: "repair-orders",  href: "/admin/repair-orders",        label: "修理依頼",   icon: Ic.wrench },
  { id: "notices",        href: "/admin/notices",             label: "お知らせ",   icon: Ic.dash },
  { id: "dashboard",      href: "/admin/dashboard",           label: "分析",       icon: Ic.dash },
]

const SUB = [
  { href: "/admin/audit",                label: "📋 請求書チェック" },
  { href: "/admin/supplier-invoices",    label: "仕入先請求書付け合わせ" },
  { href: "/admin/invoices/bulk",        label: "一括請求" },
  { href: "/admin/payments",             label: "入金処理" },
  { href: "/admin/receivables",          label: "売掛金台帳" },
  { href: "/admin/bank-import",          label: "銀行CSV消込" },
  { href: "/admin/purchase-order",       label: "推奨発注リスト(旧)" },
  { href: "/admin/stocktakes",           label: "棚卸" },
  { href: "/admin/stock-movements",      label: "在庫履歴" },
  { href: "/admin/inventory-valuation",  label: "在庫評価" },
  { href: "/admin/delivery-search",      label: "納品書検索" },
  { href: "/admin/products/dedup",       label: "商品重複管理" },
]

// アクセントカラー
const ACCENT = "#2563eb"   // blue-600

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [subOpen, setSubOpen]   = useState(false)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.replace("/login")
        return
      }
      const { data: profile } = await supabase
        .from("profiles").select("role").eq("id", session.user.id).single()
      if (profile?.role !== "admin") {
        router.replace("/login")
        return
      }
      setAuthChecked(true)
    })
  }, [])

  if (!authChecked) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f3f4f6" }}>
        <div style={{ fontSize: 14, color: "#9ca3af" }}>認証確認中…</div>
      </div>
    )
  }

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href)

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#f3f4f6", fontFamily: "'Noto Sans JP','Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif" }}>

      {/* ── モバイルドロワー ── */}
      {menuOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.5)" }} onClick={() => setMenuOpen(false)} />
      )}
      {menuOpen && (
        <div style={{ position: "fixed", top: 0, bottom: 0, left: 0, zIndex: 50, width: 260, background: "#fff", display: "flex", flexDirection: "column", boxShadow: "4px 0 20px rgba(0,0,0,0.12)" }}>
          {/* ドロワーヘッダー */}
          <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #e5e7eb" }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>DentHub</span>
            <button onClick={() => setMenuOpen(false)} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#9ca3af", lineHeight: 1 }}>×</button>
          </div>
          {/* ドロワーナビ */}
          <nav style={{ flex: 1, padding: "10px 12px", overflowY: "auto" }}>
            {NAV.map((item) => {
              const active = isActive(item.href, item.exact)
              return (
                <Link key={item.id} href={item.href} onClick={() => setMenuOpen(false)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "11px 14px", borderRadius: 10, marginBottom: 2,
                    fontSize: 15, fontWeight: active ? 700 : 500,
                    color: active ? "#fff" : "#374151",
                    background: active ? ACCENT : "transparent",
                    textDecoration: "none",
                  }}>
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              )
            })}
            <div style={{ borderTop: "1px solid #e5e7eb", marginTop: 12, paddingTop: 12 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.08em", padding: "0 14px 8px", textTransform: "uppercase" }}>その他</p>
              {SUB.map((item) => (
                <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 14px", borderRadius: 10, marginBottom: 2,
                    fontSize: 14, fontWeight: 400, color: "#6b7280",
                    background: "transparent", textDecoration: "none",
                  }}>
                  <span>{item.label}</span>
                </Link>
              ))}
              <Link href="/login"
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 10, fontSize: 14, color: "#ef4444", textDecoration: "none", marginTop: 4 }}>
                {Ic.lock}<span>ログアウト</span>
              </Link>
            </div>
          </nav>
        </div>
      )}

      {/* ── トップヘッダー ── */}
      <header className="admin-layout-header" style={{
        background: "#1e3a8a",
        position: "sticky", top: 0, zIndex: 30,
        boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
      }}>
        <div style={{ display: "flex", alignItems: "center", padding: "0 16px", height: 56 }}>

          {/* ロゴ */}
          <Link href="/admin" style={{ textDecoration: "none", marginRight: 16, flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: "#fff", letterSpacing: "0.02em" }}>
              DentHub
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, color: "#93c5fd",
              background: "rgba(255,255,255,0.12)", padding: "2px 7px", borderRadius: 4, letterSpacing: "0.05em",
            }}>管理</span>
          </Link>

          {/* PCナビ */}
          <nav style={{ flex: 1, display: "flex", alignItems: "center", gap: 1, overflowX: "auto", scrollbarWidth: "none" }}
            className="hide-scrollbar">
            {NAV.map((item) => {
              const active = isActive(item.href, item.exact)
              return (
                <Link key={item.id} href={item.href}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "6px 11px", borderRadius: 7,
                    fontSize: 13, fontWeight: active ? 700 : 400,
                    color: active ? "#fff" : "#bfdbfe",
                    background: active ? "rgba(255,255,255,0.18)" : "transparent",
                    textDecoration: "none", whiteSpace: "nowrap",
                    transition: "all 0.15s",
                  }}>
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </nav>

          {/* 右側 PC */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 8, flexShrink: 0 }}
            className="pc-only">

            {/* その他ドロップダウン */}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setSubOpen(v => !v)}
                onBlur={() => setTimeout(() => setSubOpen(false), 150)}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "6px 11px", borderRadius: 7, border: "none", cursor: "pointer",
                  fontSize: 13, fontWeight: 400,
                  color: subOpen ? "#fff" : "#bfdbfe",
                  background: subOpen ? "rgba(255,255,255,0.18)" : "transparent",
                  transition: "all 0.15s",
                }}
              >
                その他
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  style={{ transition: "transform 0.2s", transform: subOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {subOpen && (
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 100,
                  background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                  border: "1px solid #e5e7eb", minWidth: 200, padding: "6px 0", overflow: "hidden",
                }}>
                  {SUB.map(item => (
                    <Link key={item.href} href={item.href}
                      onClick={() => setSubOpen(false)}
                      style={{
                        display: "block", padding: "9px 16px", fontSize: 13,
                        color: pathname.startsWith(item.href) ? "#2563eb" : "#374151",
                        background: pathname.startsWith(item.href) ? "#eff6ff" : "transparent",
                        textDecoration: "none", fontWeight: pathname.startsWith(item.href) ? 700 : 400,
                        whiteSpace: "nowrap",
                      }}
                      onMouseEnter={e => { if (!pathname.startsWith(item.href)) (e.currentTarget as HTMLElement).style.background = "#f9fafb" }}
                      onMouseLeave={e => { if (!pathname.startsWith(item.href)) (e.currentTarget as HTMLElement).style.background = "transparent" }}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <UserBadge />
            <Link href="/" style={{
              padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
              color: "#fff", border: "1px solid rgba(255,255,255,0.3)", textDecoration: "none",
              background: "rgba(255,255,255,0.1)",
            }}>
              医院側 →
            </Link>
          </div>

          {/* ハンバーガー（モバイル） */}
          <button onClick={() => setMenuOpen(true)}
            style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", padding: 6, display: "flex", flexDirection: "column", gap: 5 }}
            className="mobile-only">
            <span style={{ display: "block", width: 22, height: 2, background: "#fff", borderRadius: 2 }} />
            <span style={{ display: "block", width: 22, height: 2, background: "#fff", borderRadius: 2 }} />
            <span style={{ display: "block", width: 22, height: 2, background: "#fff", borderRadius: 2 }} />
          </button>
        </div>

        <style>{`
          .hide-scrollbar { scrollbar-width: none; }
          .hide-scrollbar::-webkit-scrollbar { display: none; }
          @media (max-width: 767px) {
            .pc-only { display: none !important; }
            nav.hide-scrollbar { display: none !important; }
          }
          @media (min-width: 768px) {
            .mobile-only { display: none !important; }
          }
        `}</style>
      </header>

      {/* ── メインコンテンツ ── */}
      <main style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ padding: "20px 16px 32px", maxWidth: 1400, margin: "0 auto" }}
          className="main-inner">
          <style>{`
            @media (min-width: 768px) {
              .main-inner { padding: 24px 24px 40px !important; }
            }
          `}</style>
          {children}
        </div>
      </main>

      {/* ── スマホ底部ナビ ── */}
      <nav style={{
        display: "none",
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: "#fff", zIndex: 30,
        borderTop: "1px solid #e5e7eb",
        paddingBottom: "env(safe-area-inset-bottom)",
        boxShadow: "0 -2px 10px rgba(0,0,0,0.06)",
      }} className="mobile-bottom-nav">
        <style>{`
          @media (max-width: 767px) {
            .mobile-bottom-nav { display: flex !important; }
            .mobile-spacer { display: block !important; }
          }
        `}</style>
        {[
          { href: "/admin",           label: "ホーム",   icon: Ic.dash,    exact: true },
          { href: "/admin/orders",    label: "注文",     icon: Ic.order },
          { href: "/admin/invoices",  label: "請求",     icon: Ic.sales },
          { href: "/admin/inventory", label: "在庫",     icon: Ic.product },
        ].map((item) => {
          const active = isActive(item.href, item.exact as boolean | undefined)
          return (
            <Link key={item.href} href={item.href}
              style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", padding: "8px 4px 10px", gap: 4, textDecoration: "none",
                color: active ? ACCENT : "#9ca3af",
              }}>
              {item.icon}
              <span style={{ fontSize: 11, fontWeight: active ? 700 : 500 }}>{item.label}</span>
            </Link>
          )
        })}
        <button onClick={() => setMenuOpen(true)}
          style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", padding: "8px 4px 10px", gap: 4,
            background: "none", border: "none", cursor: "pointer", color: "#9ca3af",
          }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={18} height={18}>
            <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 500 }}>メニュー</span>
        </button>
      </nav>
      <div style={{ display: "none" }} className="mobile-spacer"><div style={{ height: 64 }} /></div>
    </div>
  )
}
