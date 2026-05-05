"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { Ic } from "./_lib/icons"
import UserBadge from "@/app/components/UserBadge"

const NAV = [
  { id: "home", href: "/admin", label: "HOME", icon: Ic.dash, exact: true },
  // 業務フロー順: 注文 → 発注 → 仕入 → 納品 → 請求
  { id: "orders", href: "/admin/orders", label: "注文", icon: Ic.order },
  { id: "purchase-orders", href: "/admin/purchase-orders", label: "発注", icon: Ic.truck },
  { id: "receiving", href: "/admin/receiving", label: "仕入納品", icon: Ic.purchase },
  { id: "shipping", href: "/admin/shipping", label: "医院納品", icon: Ic.doc },
  { id: "invoices", href: "/admin/invoices", label: "請求", icon: Ic.sales },
  { id: "inventory", href: "/admin/inventory", label: "在庫", icon: Ic.product },
  { id: "sales", href: "/admin/sales", label: "売上", icon: Ic.sales },
  { id: "masters", href: "/admin/masters", label: "マスター", icon: Ic.dash },
  // 一番右にダッシュボード
  { id: "dashboard", href: "/admin/dashboard", label: "📊 ダッシュ", icon: Ic.dash },
]

const SUB = [
  { href: "/admin/invoices/bulk", label: "一括請求", icon: Ic.doc },
  { href: "/admin/receivables", label: "売掛金台帳", icon: Ic.sales },
  { href: "/admin/bank-import", label: "銀行CSV消込", icon: Ic.dl },
  { href: "/admin/purchase-order", label: "推奨発注リスト(旧)", icon: Ic.purchase },
  { href: "/admin/stocktakes", label: "棚卸", icon: Ic.check },
  { href: "/admin/stock-movements", label: "在庫履歴", icon: Ic.dash },
  { href: "/admin/inventory-valuation", label: "在庫評価", icon: Ic.product },
  { href: "/admin/delivery-search", label: "納品書検索", icon: Ic.search },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)

  const isActive = (href: string, exact?: boolean) => exact ? pathname === href : pathname.startsWith(href)

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#f8f9fb", fontFamily: "'Noto Sans JP','Hiragino Kaku Gothic ProN',sans-serif" }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300&family=Josefin+Sans:wght@100;200;300&display=swap" />

      {/* モバイルメニュー */}
      {menuOpen && <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setMenuOpen(false)} />}
      {menuOpen && (
        <div className="fixed inset-y-0 left-0 z-50 w-64 bg-white flex flex-col shadow-xl">
          <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100">
            <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontWeight: 200, fontSize: 9, letterSpacing: "0.3em", color: "#aaa", textTransform: "uppercase" as const }}>Dental Connect</div>
            <button onClick={() => setMenuOpen(false)} className="text-gray-400 text-2xl">×</button>
          </div>
          <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
            {NAV.map((item) => (
              <Link key={item.id} href={item.href} onClick={() => setMenuOpen(false)}
                className={"w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium " + (isActive(item.href, item.exact) ? "text-gray-900 bg-gray-100" : "text-gray-600 hover:bg-gray-50")}>
                {item.icon}
                <span style={{ flex: 1, textAlign: "left", fontFamily: "'Josefin Sans',sans-serif", fontWeight: 300, letterSpacing: "0.05em" }}>{item.label}</span>
              </Link>
            ))}
            <div className="pt-3 mt-2 border-t border-gray-100 space-y-0.5">
              {SUB.map((item) => (
                <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-gray-500 hover:bg-gray-50">
                  {item.icon}
                  <span style={{ fontFamily: "'Josefin Sans',sans-serif", fontWeight: 300, fontSize: 13 }}>{item.label}</span>
                </Link>
              ))}
              <Link href="/login" className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-400 hover:bg-red-50 hover:text-red-500">
                {Ic.lock}<span>ログアウト</span>
              </Link>
            </div>
          </nav>
        </div>
      )}

      {/* トップナビ */}
      <header className="bg-white sticky top-0 z-30 shrink-0" style={{ borderBottom: "1px solid #e8eaed", boxShadow: "0 1px 8px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center px-4 h-14">
          <Link href="/admin" className="flex flex-col mr-6 shrink-0">
            <span style={{ fontFamily: "'Josefin Sans',sans-serif", fontWeight: 200, fontSize: 8, letterSpacing: "0.3em", color: "#aaa", textTransform: "uppercase" as const }}>Dental Connect</span>
            <span style={{ fontFamily: "'Cormorant Garamond',serif", fontWeight: 300, fontSize: 13, color: "#222", letterSpacing: "0.05em", marginTop: -2 }}>管理画面</span>
          </Link>
          <nav className="flex items-center flex-1 overflow-x-auto" style={{ gap: 2 }}>
            {NAV.map((item) => {
              const active = isActive(item.href, item.exact)
              return (
                <Link key={item.id} href={item.href}
                  className={"flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition-all whitespace-nowrap " + (active ? "text-gray-900 bg-gray-100 font-semibold" : "text-gray-500 hover:text-gray-800 hover:bg-gray-50")}>
                  {item.icon}
                  <span style={{ fontFamily: "'Josefin Sans',sans-serif", fontWeight: 300, letterSpacing: "0.02em", fontSize: 11 }}>{item.label}</span>
                </Link>
              )
            })}
          </nav>
          <div className="hidden md:flex items-center gap-2 ml-4 shrink-0">
            <UserBadge />
            <Link href="/" className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-gray-400 hover:bg-gray-50 hover:text-gray-700">
              医院側 →
            </Link>
          </div>
          <div className="md:hidden flex items-center gap-3 ml-auto">
            <button onClick={() => setMenuOpen(true)} className="flex flex-col gap-1.5 p-1">
              <span className="w-5 h-0.5 bg-gray-700 block rounded" />
              <span className="w-5 h-0.5 bg-gray-700 block rounded" />
              <span className="w-5 h-0.5 bg-gray-700 block rounded" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="px-4 py-4 md:px-6 md:py-5">
          {children}
        </div>
      </main>

      {/* スマホ底部ナビ */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white z-30 flex" style={{ borderTop: "1px solid #e8eaed", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {[
          { href: "/admin", label: "ホーム", icon: Ic.dash, exact: true },
          { href: "/admin/orders", label: "注文", icon: Ic.order },
          { href: "/admin/invoices", label: "請求書", icon: Ic.sales },
          { href: "/admin/masters", label: "マスター", icon: Ic.dash },
        ].map((item) => (
          <Link key={item.href} href={item.href} className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5"
            style={{ color: isActive(item.href, item.exact) ? "#1a1a1a" : "#9ca3af" }}>
            {item.icon}
            <span style={{ fontSize: 10, fontFamily: "'Josefin Sans',sans-serif", fontWeight: 300, letterSpacing: "0.08em" }}>{item.label}</span>
          </Link>
        ))}
        <button onClick={() => setMenuOpen(true)} className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5" style={{ color: "#9ca3af" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
          <span style={{ fontSize: 10, fontFamily: "'Josefin Sans',sans-serif", fontWeight: 300, letterSpacing: "0.08em" }}>メニュー</span>
        </button>
      </nav>
      <div className="md:hidden h-16" />
    </div>
  )
}
