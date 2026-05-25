"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import Link from "next/link"
import { Ic } from "./_lib/icons"

type Order   = { id: string; status: string; invoice_id: string | null }
type Invoice = { id: string; status: string }
type Product = { id: string; stock: number | null; reorder_level: number | null }

const ACCENT = "#2563eb"

export default function AdminHomePage() {
  const [orders,   setOrders]   = useState<Order[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    const [o, i, p] = await Promise.all([
      supabase.from("orders").select("id,status,invoice_id").limit(50000),
      supabase.from("invoices").select("id,status").limit(50000),
      supabase.from("products").select("id,stock,reorder_level").limit(50000),
    ])
    setOrders((o.data as Order[]) || [])
    setInvoices((i.data as Invoice[]) || [])
    setProducts((p.data as Product[]) || [])
    setLoading(false)
  }

  const badges = useMemo(() => {
    const pendingOrders    = orders.filter((o) => ["注文受付","確認中","準備中"].includes(o.status)).length
    const undeliveredCount = orders.filter((o) => !["納品済み","納品済","キャンセル","取消"].includes(o.status)).length
    const unbilled         = orders.filter((o) => ["納品済み","納品済"].includes(o.status) && !o.invoice_id).length
    const unpaidInvoices   = invoices.filter((i) => i.status === "issued").length
    const lowStock         = products.filter((p) => p.stock !== null && p.reorder_level !== null && p.stock <= p.reorder_level).length
    return { pendingOrders, undeliveredCount, unbilled, unpaidInvoices, lowStock }
  }, [orders, invoices, products])

  const buttons: ButtonItem[] = [
    { href: "/admin/orders",          label: "注文管理",   desc: "受注・ステータス確認",       icon: Ic.order,    color: "#2563eb", badge: badges.pendingOrders,    badgeLabel: "未処理" },
    { href: "/admin/purchase-orders", label: "発注管理",   desc: "発注書の作成・確認",          icon: Ic.truck,    color: "#0891b2" },
    { href: "/admin/receiving",       label: "仕入納品",   desc: "仕入先からの納品処理",        icon: Ic.purchase, color: "#7c3aed" },
    { href: "/admin/shipping",        label: "医院納品",   desc: "出荷・納品書発行",           icon: Ic.doc,      color: "#059669", badge: badges.undeliveredCount, badgeLabel: "未納品" },
    { href: "/admin/invoices",        label: "請求管理",   desc: "請求書発行・入金管理",        icon: Ic.sales,    color: "#dc2626", badge: (badges.unbilled || badges.unpaidInvoices) || undefined, badgeLabel: badges.unbilled > 0 ? "未請求" : "未収" },
    { href: "/admin/sales",           label: "売上分析",   desc: "月次・医院・商品別",          icon: Ic.sales,    color: "#059669" },
    { href: "/admin/inventory",       label: "在庫管理",   desc: "在庫数・発注点の確認",        icon: Ic.product,  color: "#d97706", badge: badges.lowStock,         badgeLabel: "在庫不足" },
    { href: "/admin/masters",         label: "マスター",   desc: "医院・仕入先・商品・設定",    icon: Ic.dash,     color: "#475569" },
  ]

  const quickLinks = [
    { href: "/admin/invoices/bulk",       label: "一括請求" },
    { href: "/admin/receivables",         label: "売掛金台帳" },
    { href: "/admin/stocktakes",          label: "棚卸" },
    { href: "/admin/stock-movements",     label: "在庫履歴" },
    { href: "/admin/inventory-valuation", label: "在庫評価" },
    { href: "/admin/bank-import",         label: "銀行CSV消込" },
    { href: "/admin/delivery-search",     label: "納品書検索" },
    { href: "/admin/deliveries",          label: "納品書一覧" },
    { href: "/admin/simulation",          label: "シミュレーション" },
    { href: "/admin/notices",             label: "お知らせ管理" },
    { href: "/admin/dashboard",           label: "分析ダッシュボード" },
  ]

  return (
    <div>
      {/* ページタイトル */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#111827", margin: 0 }}>管理ホーム</h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>業務メニューを選択してください</p>
      </div>

      {/* メインボタングリッド */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: 14,
        marginBottom: 32,
      }} className="home-grid">
        <style>{`
          @media (min-width: 640px)  { .home-grid { grid-template-columns: repeat(3, 1fr) !important; } }
          @media (min-width: 1024px) { .home-grid { grid-template-columns: repeat(4, 1fr) !important; } }
        `}</style>
        {buttons.map((b) => (
          <BigButton key={b.href} {...b} loading={loading} />
        ))}
      </div>

      {/* クイックアクセス */}
      <div>
        <p style={{ fontSize: 12, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.06em", marginBottom: 10, textTransform: "uppercase" }}>
          クイックアクセス
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {quickLinks.map((l) => (
            <Link key={l.href} href={l.href}
              style={{
                padding: "7px 14px", borderRadius: 20,
                fontSize: 13, fontWeight: 500,
                color: "#374151", background: "#fff",
                border: "1px solid #e5e7eb",
                textDecoration: "none",
              }}>
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

type ButtonItem = {
  href: string
  label: string
  desc: string
  icon: React.ReactNode
  color: string
  badge?: number
  badgeLabel?: string
}

function BigButton({ href, label, desc, icon, color, badge, badgeLabel, loading }: ButtonItem & { loading: boolean }) {
  return (
    <Link href={href}
      style={{
        display: "block", position: "relative", overflow: "hidden",
        background: "#fff", borderRadius: 16,
        border: "1px solid #e5e7eb",
        padding: "20px 18px",
        textDecoration: "none",
        boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
        transition: "box-shadow 0.15s, transform 0.1s",
      }}
      className="big-btn">
      <style>{`
        .big-btn:hover { box-shadow: 0 6px 20px rgba(0,0,0,0.1) !important; transform: translateY(-2px); }
        .big-btn:active { transform: translateY(0); }
      `}</style>

      {/* 背景アクセント */}
      <div style={{
        position: "absolute", top: -20, right: -20,
        width: 80, height: 80, borderRadius: "50%",
        background: color, opacity: 0.06,
      }} />

      {/* バッジ */}
      {!loading && badge !== undefined && badge > 0 && (
        <div style={{
          position: "absolute", top: 12, right: 12,
          display: "flex", alignItems: "center", gap: 4,
        }}>
          <span style={{
            fontSize: 12, fontWeight: 800,
            background: color, color: "#fff",
            borderRadius: 999, padding: "2px 9px",
            boxShadow: `0 2px 6px ${color}55`,
          }}>{badge}</span>
          {badgeLabel && (
            <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 600 }}>{badgeLabel}</span>
          )}
        </div>
      )}

      {/* アイコン */}
      <div style={{
        display: "inline-flex", padding: 10, borderRadius: 12, marginBottom: 12,
        background: color + "18", color,
      }}>
        <span style={{ display: "block", transform: "scale(1.4)", padding: 2 }}>{icon}</span>
      </div>

      {/* テキスト */}
      <p style={{ fontSize: 18, fontWeight: 800, color: "#111827", margin: "0 0 4px", letterSpacing: "0.01em" }}>
        {label}
      </p>
      <p style={{ fontSize: 12, color: "#6b7280", margin: 0, lineHeight: 1.5 }}>
        {desc}
      </p>
    </Link>
  )
}
