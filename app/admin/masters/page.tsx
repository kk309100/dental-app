"use client"

import Link from "next/link"
import { Ic } from "../_lib/icons"

type MasterItem = {
  href: string
  label: string
  desc: string
  icon: React.ReactNode
  color: string
  group: string
}

const ITEMS: MasterItem[] = [
  // 取引先
  { href: "/admin/clinics", label: "得意先", desc: "医院マスタ・締日・住所", icon: Ic.clinic, color: "#0d9488", group: "取引先" },
  { href: "/admin/suppliers", label: "仕入先", desc: "仕入先マスタ・連絡先", icon: Ic.truck, color: "#475569", group: "取引先" },
  // 商品
  { href: "/admin/products", label: "商品", desc: "商品マスタ・原価・定価", icon: Ic.product, color: "#3b82f6", group: "商品" },
  { href: "/admin/product-images", label: "商品画像", desc: "楽天APIで画像を一括取得", icon: Ic.product, color: "#f08c00", group: "商品" },
  { href: "/admin/palladium", label: "パラ価格", desc: "パラジウム価格管理", icon: Ic.product, color: "#a855f7", group: "商品" },
  { href: "/admin/barcodes", label: "バーコード", desc: "商品バーコード一覧", icon: Ic.csv, color: "#f59e0b", group: "商品" },
  // 医院在庫
  { href: "/admin/clinic-items", label: "医院在庫", desc: "置き場所・最低在庫の設定", icon: Ic.product, color: "#22a648", group: "医院在庫" },
  // 設定
  { href: "/admin/users", label: "ユーザー", desc: "ログインID設定・医院ユーザー管理", icon: Ic.clinic, color: "#22a648", group: "設定" },
  { href: "/admin/settings", label: "自社情報", desc: "請求書・納品書の自社欄", icon: Ic.gear, color: "#0891b2", group: "設定" },
  { href: "/admin/audit-logs", label: "監査ログ", desc: "操作履歴の閲覧", icon: Ic.lock, color: "#9333ea", group: "設定" },
]

export default function MastersPage() {
  const groups = Array.from(new Set(ITEMS.map(i => i.group)))

  return (
    <div className="space-y-5">
      <div className="text-center pt-2">
        <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "'Cormorant Garamond',serif", letterSpacing: "0.1em" }}>MASTERS</h1>
        <p className="text-xs text-gray-400 mt-1" style={{ fontFamily: "'Josefin Sans',sans-serif", letterSpacing: "0.2em" }}>マスター・設定</p>
      </div>

      {groups.map(group => (
        <section key={group}>
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">{group}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {ITEMS.filter(i => i.group === group).map(item => (
              <BigButton key={item.href} {...item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function BigButton({ href, label, desc, icon, color }: MasterItem) {
  return (
    <Link href={href}
      className="group bg-white rounded-2xl p-5 hover:shadow-lg transition-all relative overflow-hidden"
      style={{ border: "1px solid #e8eaed", display: "block" }}>
      <div className="absolute top-0 right-0 w-20 h-20 rounded-full opacity-5 group-hover:opacity-10 transition-opacity"
        style={{ background: color, transform: "translate(30%, -30%)" }} />
      <div className="flex flex-col items-start gap-2 relative z-10">
        <div className="p-2 rounded-lg" style={{ background: color + "11", color }}>
          <span className="block" style={{ transform: "scale(1.6)", display: "inline-block", padding: "4px" }}>{icon}</span>
        </div>
        <div>
          <p className="text-xl font-bold text-gray-900" style={{ letterSpacing: "0.05em" }}>{label}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">{desc}</p>
        </div>
      </div>
    </Link>
  )
}
