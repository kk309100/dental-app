"use client"

import Link from "next/link"

export default function AdminPage() {
  return (
    <main style={containerStyle}>
      <h1 style={titleStyle}>管理画面</h1>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>① 注文管理</h2>

        <AdminLink href="/admin/orders" label="注文一覧・注文編集" />
        <AdminLink href="/admin/delivered" label="納品済み一覧・再発行" />
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>② 帳票</h2>

        <AdminLink href="/admin/delivery" label="納品書" />
        <AdminLink href="/admin/purchase-order" label="発注書" />
        <AdminLink href="/admin/delivery-search" label="納品書検索" />
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>③ 商品・在庫</h2>

        <AdminLink href="/admin/inventory" label="在庫管理" />
        <AdminLink href="/admin/barcodes" label="バーコード生成" />
         <AdminLink href="/admin/products" label="商品編集" />
         <AdminLink href="/admin/receiving" label="入荷処理" />
        <button style={disabledButtonStyle} disabled>
          商品編集（今後実装）
        </button>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>④ 設定</h2>

        <button style={disabledButtonStyle} disabled>
          医院管理（今後実装）
        </button>

        <button style={disabledButtonStyle} disabled>
          ユーザー管理（今後実装）
        </button>
      </section>
    </main>
  )
}

function AdminLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} style={{ textDecoration: "none" }}>
      <button style={buttonStyle}>{label}</button>
    </Link>
  )
}

const containerStyle: React.CSSProperties = {
  maxWidth: 640,
  margin: "0 auto",
  padding: 20,
}

const titleStyle: React.CSSProperties = {
  fontSize: 26,
  marginBottom: 24,
}

const sectionStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #eee",
  borderRadius: 14,
  padding: 16,
  marginBottom: 18,
  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 18,
  marginBottom: 12,
}

const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: 14,
  marginBottom: 10,
  borderRadius: 10,
  border: "none",
  background: "#111",
  color: "#fff",
  fontSize: 16,
  fontWeight: "bold",
  cursor: "pointer",
}

const disabledButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: 14,
  marginBottom: 10,
  borderRadius: 10,
  border: "1px solid #ddd",
  background: "#f3f4f6",
  color: "#777",
  fontSize: 16,
  fontWeight: "bold",
}