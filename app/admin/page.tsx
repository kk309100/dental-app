"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import Link from "next/link"
import { Ic } from "./_lib/icons"

// ホーム画面: 9つの大きなボタン
// 各ボタンには件数・要対応バッジを表示

type Order = { id: string; status: string; invoice_id: string | null }
type Invoice = { id: string; status: string }
type Product = { id: string; stock: number | null; reorder_level: number | null }

export default function AdminHomePage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    const [o, i, p] = await Promise.all([
      supabase.from("orders").select("id,status,invoice_id"),
      supabase.from("invoices").select("id,status"),
      supabase.from("products").select("id,stock,reorder_level"),
    ])
    setOrders((o.data as Order[]) || [])
    setInvoices((i.data as Invoice[]) || [])
    setProducts((p.data as Product[]) || [])
    setLoading(false)
  }

  // バッジ用カウント
  const badges = useMemo(() => {
    const pendingOrders = orders.filter((o) => ["注文受付", "確認中", "準備中"].includes(o.status)).length
    const undeliveredCount = orders.filter((o) => o.status !== "納品済み" && o.status !== "キャンセル").length
    const unbilled = orders.filter((o) => o.status === "納品済み" && !o.invoice_id).length
    const unpaidInvoices = invoices.filter((i) => i.status === "issued").length
    const lowStock = products.filter((p) => p.stock !== null && p.reorder_level !== null && p.stock <= p.reorder_level).length
    return { pendingOrders, undeliveredCount, unbilled, unpaidInvoices, lowStock }
  }, [orders, invoices, products])

  // ボタン定義（9つ）
  const buttons: ButtonItem[] = [
    { href: "/admin/receiving", label: "仕入", desc: "入荷・仕入価格更新", icon: Ic.purchase, color: "#7c3aed" },
    { href: "/admin/purchase-order", label: "発注", desc: "仕入先への発注書", icon: Ic.truck, color: "#0891b2" },
    { href: "/admin/orders", label: "注文", desc: "医院からの注文管理", icon: Ic.order, color: "#3b82f6", badge: badges.pendingOrders, badgeLabel: "未処理" },
    { href: "/admin/delivery", label: "納品", desc: "納品書の発行・印刷", icon: Ic.doc, color: "#10b981", badge: badges.undeliveredCount, badgeLabel: "未納品" },
    { href: "/admin/invoices", label: "請求", desc: "請求書発行・入金", icon: Ic.sales, color: "#dc2626", badge: badges.unbilled || badges.unpaidInvoices, badgeLabel: badges.unbilled > 0 ? "未請求" : "未収" },
    { href: "/admin/inventory", label: "在庫", desc: "在庫数・最低在庫", icon: Ic.product, color: "#d97706", badge: badges.lowStock, badgeLabel: "在庫不足" },
    { href: "/admin/clinics", label: "得意先", desc: "医院マスタ", icon: Ic.clinic, color: "#0d9488" },
    { href: "/admin/suppliers", label: "仕入先", desc: "仕入先マスタ", icon: Ic.truck, color: "#475569" },
    { href: "/admin/palladium", label: "パラ", desc: "パラジウム価格管理", icon: Ic.product, color: "#a855f7" },
  ]

  return (
    <div className="space-y-6">
      <div className="text-center pt-2">
        <h1 className="text-3xl font-bold text-gray-900" style={{ fontFamily: "'Cormorant Garamond',serif", letterSpacing: "0.1em" }}>HOME</h1>
        <p className="text-xs text-gray-400 mt-1" style={{ fontFamily: "'Josefin Sans',sans-serif", letterSpacing: "0.2em" }}>SELECT WHAT YOU&apos;D LIKE TO DO</p>
      </div>

      {/* 大きなボタングリッド */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 max-w-5xl mx-auto">
        {buttons.map((b) => (
          <BigButton key={b.href} {...b} loading={loading} />
        ))}
      </div>

      {/* セカンダリリンク */}
      <div className="max-w-5xl mx-auto pt-4">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 text-center">QUICK ACCESS</p>
        <div className="flex flex-wrap justify-center gap-2 text-xs">
          {[
            { href: "/admin/dashboard", label: "📊 ダッシュボード", featured: true },
            { href: "/admin/quotes", label: "見積書" },
            { href: "/admin/sales", label: "売上分析" },
            { href: "/admin/invoices/bulk", label: "一括請求" },
            { href: "/admin/products", label: "商品マスタ" },
            { href: "/admin/delivery-search", label: "納品書検索" },
            { href: "/admin/delivered", label: "納品済み一覧" },
            { href: "/admin/barcodes", label: "バーコード" },
          ].map((l) => (
            <Link key={l.href} href={l.href}
              className={"px-3 py-1.5 rounded-full border " + (l.featured ? "bg-gray-900 text-white border-gray-900 hover:bg-gray-700" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:text-gray-900")}>
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
      className="group bg-white rounded-2xl p-6 sm:p-8 hover:shadow-lg transition-all relative overflow-hidden"
      style={{ border: "1px solid #e8eaed", display: "block" }}>
      {/* 背景の薄いカラーアクセント */}
      <div className="absolute top-0 right-0 w-24 h-24 rounded-full opacity-5 group-hover:opacity-10 transition-opacity" style={{ background: color, transform: "translate(30%, -30%)" }} />

      {/* バッジ */}
      {!loading && badge !== undefined && badge > 0 && (
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: color + "22", color }}>
            {badge}
          </span>
          {badgeLabel && <span className="text-[10px] text-gray-400">{badgeLabel}</span>}
        </div>
      )}

      <div className="flex flex-col items-start gap-3 relative z-10">
        <div className="p-2 rounded-lg" style={{ background: color + "11", color }}>
          <span className="block" style={{ transform: "scale(2)", display: "inline-block", padding: "4px" }}>
            {icon}
          </span>
        </div>
        <div>
          <p className="text-2xl sm:text-3xl font-bold text-gray-900" style={{ letterSpacing: "0.05em" }}>
            {label}
          </p>
          <p className="text-xs text-gray-500 mt-1">{desc}</p>
        </div>
      </div>
    </Link>
  )
}
