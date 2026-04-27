"use client"

import Link from "next/link"

export default function Home() {
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 20 }}>
      <h1 style={{ fontSize: 26, marginBottom: 20 }}>歯科注文アプリ</h1>

      <p style={{ marginBottom: 24 }}>
        注文・履歴確認・管理画面へ移動できます。
      </p>

      <div style={{ display: "grid", gap: 12 }}>
        <Link href="/order">
          <button
            style={{
              width: "100%",
              padding: 16,
              borderRadius: 10,
              border: "none",
              background: "#111",
              color: "#fff",
              fontSize: 18,
              fontWeight: "bold",
            }}
          >
            注文する
          </button>
        </Link>

        <Link href="/history">
          <button
            style={{
              width: "100%",
              padding: 16,
              borderRadius: 10,
              border: "1px solid #ccc",
              background: "#fff",
              color: "#111",
              fontSize: 18,
              fontWeight: "bold",
            }}
          >
            注文履歴
          </button>
        </Link>

        <Link href="/admin">
          <button
            style={{
              width: "100%",
              padding: 16,
              borderRadius: 10,
              border: "1px solid #ccc",
              background: "#fff",
              color: "#111",
              fontSize: 18,
              fontWeight: "bold",
            }}
          >
            管理画面
          </button>
        </Link>
      </div>
    </main>
  )
}