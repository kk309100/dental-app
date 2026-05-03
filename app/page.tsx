"use client"

import Link from "next/link"

export default function AdminPage() {
  return (
    <main style={containerStyle}>
      <h1 style={titleStyle}>管理画面</h1>

      <div style={sectionStyle}>
        <h2 style={sectionTitle}>帳票</h2>

        <Link href="/admin/delivery">
          <button style={buttonStyle}>納品書</button>
        </Link>

        <Link href="/admin/purchase-order">
          <button style={buttonStyle}>発注書</button>
        </Link>

        <Link href="/admin/delivery-search">
          <button style={buttonStyle}>納品書検索</button>
        </Link>

        <Link href="/admin/delivered">
          <button style={buttonStyle}>納品済み一覧</button>
        </Link>
      </div>

      <div style={sectionStyle}>
        <h2 style={sectionTitle}>商品・在庫管理</h2>

        <Link href="/admin/inventory">
          <button style={buttonStyle}>在庫管理</button>
        </Link>

        <Link href="/admin/barcodes">
          <button style={buttonStyle}>バーコード生成</button>
        </Link>

        <Link href="/admin/orders">
          <button style={buttonStyle}>注文編集</button>
        </Link>
      </div>
    </main>
  )
}

const containerStyle: React.CSSProperties = {
  maxWidth: 600,
  margin: "0 auto",
  padding: 20,
}

const titleStyle: React.CSSProperties = {
  fontSize: 24,
  marginBottom: 20,
}

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  marginBottom: 30,
}

const sectionTitle: React.CSSProperties = {
  fontSize: 18,
  marginBottom: 10,
}

const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: 14,
  borderRadius: 10,
  border: "none",
  background: "#111",
  color: "#fff",
  fontSize: 16,
  fontWeight: "bold",
  cursor: "pointer",
}