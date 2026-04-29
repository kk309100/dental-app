"use client"

import Link from "next/link"

export default function AdminPage() {
  return (
    <main style={containerStyle}>
      <h1 style={titleStyle}>管理画面</h1>

      {/* ドキュメント導線 */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>帳票</h2>

        <Link href="/admin/delivery">
          <button style={buttonStyle}>納品書</button>
        </Link>

        <Link href="/admin/purchase-order">
          <button style={buttonStyle}>発注書</button>
        </Link>
      </div>

      {/* 他機能（今後拡張用） */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>管理機能</h2>

        <Link href="/admin/orders">
          <button style={buttonStyle}>注文編集</button>
        </Link>
      </div>
    </main>
  )
}

const containerStyle = {
  maxWidth: 600,
  margin: "0 auto",
  padding: 20,
}

const titleStyle = {
  fontSize: 24,
  marginBottom: 20,
}

const sectionStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 12,
  marginBottom: 30,
}

const sectionTitle = {
  fontSize: 18,
  marginBottom: 10,
}

const buttonStyle = {
  width: "100%",
  padding: 14,
  borderRadius: 10,
  border: "none",
  background: "#111",
  color: "#fff",
  fontSize: 16,
  fontWeight: "bold" as const,
  cursor: "pointer",
}