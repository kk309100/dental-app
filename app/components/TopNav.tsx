"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

// グローバルなトップナビ
// - 医院側ページ（/, /order, /history, /purchase, /order-edit）: 「注文 | 履歴」
// - 管理画面（/admin/**）: 「← 管理画面トップ」のみ（戻りやすく）
// - ログイン画面（/login）: 何も表示しない
export default function TopNav() {
  const pathname = usePathname()

  if (pathname.startsWith("/login")) return null

  if (pathname.startsWith("/admin")) {
    return (
      <nav style={navStyle}>
        <Link href="/admin" style={linkStyle}>← 管理画面トップ</Link>
      </nav>
    )
  }

  // 医院側
  return (
    <nav style={navStyle}>
      <Link href="/" style={linkStyle}>注文</Link>
      <Link href="/history" style={linkStyle}>履歴</Link>
    </nav>
  )
}

const navStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-around",
  alignItems: "center",
  padding: 12,
  background: "#111",
  color: "#fff",
  position: "sticky",
  top: 0,
  zIndex: 100,
}

const linkStyle: React.CSSProperties = {
  color: "#fff",
  textDecoration: "none",
  fontWeight: "bold",
}
