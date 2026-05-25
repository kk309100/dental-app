/**
 * AdminPageHeader
 * 全管理ページ共通のページヘッダーコンポーネント
 *
 * 使い方:
 *   <AdminPageHeader
 *     title="注文管理"
 *     subtitle="受注・ステータス確認"
 *     count={orders.length}
 *     countLabel="件"
 *     actions={<><button>...</button></>}
 *   />
 */

import React from "react"

type Props = {
  title: string
  subtitle?: string
  count?: number
  countLabel?: string
  badge?: { value: number; label: string; color?: string }
  actions?: React.ReactNode
  backHref?: string
  backLabel?: string
}

export default function AdminPageHeader({
  title, subtitle, count, countLabel = "件", badge, actions, backHref, backLabel
}: Props) {
  return (
    <div className="admin-page-header" style={{ marginBottom: 20 }}>
      <div className="header-left">
        {backHref && (
          <a href={backHref} style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            fontSize: 12, color: "#6b7280", textDecoration: "none", marginBottom: 6,
            padding: "3px 0",
          }}>
            ← {backLabel || "戻る"}
          </a>
        )}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: 0, lineHeight: 1.3 }}>
            {title}
          </h1>
          {count !== undefined && (
            <span style={{ fontSize: 13, color: "#9ca3af", fontWeight: 500 }}>
              {count.toLocaleString()}{countLabel}
            </span>
          )}
          {badge && badge.value > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 700,
              background: badge.color || "#dc2626",
              color: "#fff",
              borderRadius: 999, padding: "2px 10px",
            }}>
              {badge.value} {badge.label}
            </span>
          )}
        </div>
        {subtitle && (
          <p style={{ fontSize: 13, color: "#6b7280", margin: "3px 0 0" }}>{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="header-actions" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {actions}
        </div>
      )}
    </div>
  )
}

/* ── ボタンスタイル定数（各ページで使い回し可） ── */
export const btnPrimary: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "8px 16px", borderRadius: 8,
  background: "#2563eb", color: "#fff",
  border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer",
  boxShadow: "0 1px 4px rgba(37,99,235,0.3)",
}
export const btnSuccess: React.CSSProperties = {
  ...{} as React.CSSProperties,
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "8px 16px", borderRadius: 8,
  background: "#059669", color: "#fff",
  border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer",
  boxShadow: "0 1px 4px rgba(5,150,105,0.3)",
}
export const btnOutline: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "7px 14px", borderRadius: 8,
  background: "#fff", color: "#374151",
  border: "1.5px solid #e5e7eb", fontSize: 13, fontWeight: 600, cursor: "pointer",
}
export const btnDanger: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "7px 14px", borderRadius: 8,
  background: "#fff", color: "#dc2626",
  border: "1.5px solid #fca5a5", fontSize: 13, fontWeight: 600, cursor: "pointer",
}
