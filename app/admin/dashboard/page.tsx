"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { fmtYen, fmtDate } from "@/lib/invoice"
import Link from "next/link"
import { Ic } from "../_lib/icons"

type Order = { id: string; clinic_id: string; status: string; created_at: string; total_price: number; invoice_id: string | null }
type Invoice = { id: string; clinic_id: string | null; invoice_number: string; issue_date: string; total: number; status: string }
type Product = { id: string; name: string; stock: number | null; reorder_level: number | null }
type Clinic = { id: string; name: string; corporate_name: string | null }

export default function AdminDashboard() {
  const [orders, setOrders] = useState<Order[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    const [o, i, p, c] = await Promise.all([
      supabase.from("orders").select("id,clinic_id,status,created_at,total_price,invoice_id"),
      supabase.from("invoices").select("id,clinic_id,invoice_number,issue_date,total,status").order("issue_date", { ascending: false }),
      supabase.from("products").select("id,name,stock,reorder_level"),
      supabase.from("clinics").select("id,name,corporate_name"),
    ])
    setOrders((o.data as Order[]) || [])
    setInvoices((i.data as Invoice[]) || [])
    setProducts((p.data as Product[]) || [])
    setClinics((c.data as Clinic[]) || [])
    setLoading(false)
  }

  const clinicName = (id: string | null) => id ? (clinics.find((c) => c.id === id)?.name || "(削除済み)") : "-"

  // KPIs
  const kpi = useMemo(() => {
    const now = new Date()
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

    const thisMonthInvoices = invoices.filter((i) => i.issue_date?.startsWith(thisMonth))
    const thisMonthAmount = thisMonthInvoices.reduce((s, i) => s + (i.total || 0), 0)
    const thisMonthPaid = thisMonthInvoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.total, 0)

    const unpaid = invoices.filter((i) => i.status === "issued")
    const unpaidTotal = unpaid.reduce((s, i) => s + i.total, 0)

    const pendingOrders = orders.filter((o) => o.status === "注文受付" || o.status === "確認中" || o.status === "準備中")

    // 「未請求の納品済み注文」 = 売上化されていない注文
    const undeliveredInvoiced = orders.filter((o) => o.status === "納品済み" && !o.invoice_id)

    const lowStock = products.filter((p) => p.stock !== null && p.reorder_level !== null && p.stock <= p.reorder_level)

    return {
      thisMonthAmount, thisMonthPaid, thisMonthCount: thisMonthInvoices.length,
      unpaidTotal, unpaidList: unpaid,
      pendingCount: pendingOrders.length,
      undeliveredInvoicedCount: undeliveredInvoiced.length,
      undeliveredInvoicedTotal: undeliveredInvoiced.reduce((s, o) => s + o.total_price, 0),
      lowStockCount: lowStock.length, lowStockList: lowStock,
    }
  }, [orders, invoices, products])

  if (loading) return <p style={{ padding: 32, textAlign: "center", color: "#999" }}>読み込み中…</p>

  return (
    <div className="space-y-5">
      {/* タイトル */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">ダッシュボード</h1>
        <p className="text-xs text-gray-400 mt-0.5">{fmtDate(new Date())} 現在</p>
      </div>

      {/* KPI カード */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="今月請求額"
          value={fmtYen(kpi.thisMonthAmount)}
          sub={`うち入金済 ${fmtYen(kpi.thisMonthPaid)}`}
          href="/admin/invoices"
        />
        <KpiCard
          label="未収金合計"
          value={fmtYen(kpi.unpaidTotal)}
          sub={`${kpi.unpaidList.length}件`}
          href="/admin/invoices"
          color={kpi.unpaidTotal > 0 ? "#dc2626" : "#10b981"}
        />
        <KpiCard
          label="処理中の注文"
          value={`${kpi.pendingCount}件`}
          sub={kpi.pendingCount > 0 ? "要対応" : "なし"}
          href="/admin/orders"
          color={kpi.pendingCount > 0 ? "#d97706" : "#10b981"}
        />
        <KpiCard
          label="未請求の納品済み"
          value={`${kpi.undeliveredInvoicedCount}件`}
          sub={kpi.undeliveredInvoicedCount > 0 ? `合計 ${fmtYen(kpi.undeliveredInvoicedTotal)}` : "全部請求済"}
          href="/admin/invoices/create"
          color={kpi.undeliveredInvoicedCount > 0 ? "#3b82f6" : "#10b981"}
        />
      </div>

      {/* クイックアクション */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <ActionCard href="/admin/invoices/create" title="請求書発行" desc="未請求注文をまとめる" icon={Ic.sales} />
        <ActionCard href="/admin/invoices/bulk" title="一括請求" desc="締日別に全医院まとめて" icon={Ic.doc} />
        <ActionCard href="/admin/quotes/create" title="見積書作成" desc="新規見積→売上化対応" icon={Ic.doc} />
        <ActionCard href="/admin/receiving" title="仕入入力" desc="入荷+仕入価格更新" icon={Ic.purchase} />
        <ActionCard href="/admin/palladium" title="パラ価格更新" desc="今日の相場を入力" icon={Ic.product} />
        <ActionCard href="/admin/sales" title="売上分析" desc="月次/医院/商品別" icon={Ic.sales} />
      </div>

      {/* 詳細カード（未収金 + 在庫アラート） */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 未収金一覧 */}
        <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #e8eaed" }}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-bold text-gray-900">未収金一覧</p>
              <p className="text-xs text-gray-400">発行済みで入金待ちの請求書</p>
            </div>
            <Link href="/admin/invoices" className="text-xs text-blue-600 hover:underline">すべて</Link>
          </div>
          {kpi.unpaidList.length === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">未収金はありません ✓</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {kpi.unpaidList.slice(0, 8).map((iv) => (
                <Link key={iv.id} href={`/admin/invoices/${iv.id}`} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 border border-gray-100">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{clinicName(iv.clinic_id)}</p>
                    <p className="text-xs text-gray-400">{iv.invoice_number} ・ {fmtDate(iv.issue_date)}</p>
                  </div>
                  <span className="text-sm font-bold text-red-600 ml-2">{fmtYen(iv.total)}</span>
                </Link>
              ))}
              {kpi.unpaidList.length > 8 && <p className="text-xs text-gray-400 text-center pt-2">…他 {kpi.unpaidList.length - 8}件</p>}
            </div>
          )}
        </div>

        {/* 在庫アラート */}
        <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #e8eaed" }}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-bold text-gray-900">在庫アラート</p>
              <p className="text-xs text-gray-400">最低在庫を下回っています</p>
            </div>
            <Link href="/admin/inventory" className="text-xs text-blue-600 hover:underline">すべて</Link>
          </div>
          {kpi.lowStockCount === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">在庫不足はありません ✓</p>
          ) : (
            <>
              <p className="text-xl font-bold text-red-600 mb-2">{kpi.lowStockCount}品</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {kpi.lowStockList.slice(0, 5).map((p) => (
                  <div key={p.id} className="flex items-center justify-between py-1.5 px-2 rounded text-xs border border-gray-100">
                    <span className="truncate flex-1 pr-2">{p.name}</span>
                    <span className="text-red-600 font-bold ml-2">{p.stock}/{p.reorder_level}</span>
                  </div>
                ))}
                {kpi.lowStockCount > 5 && <p className="text-xs text-gray-400 text-center pt-1">…他 {kpi.lowStockCount - 5}品</p>}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 全機能リンク（フッタ） */}
      <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #e8eaed" }}>
        <p className="text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">すべての機能</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs">
          {[
            { href: "/admin/orders", label: "注文一覧" },
            { href: "/admin/delivered", label: "納品済み一覧" },
            { href: "/admin/delivery", label: "納品書" },
            { href: "/admin/delivery-search", label: "納品書検索" },
            { href: "/admin/delivery-control", label: "納品処理" },
            { href: "/admin/purchase-order", label: "発注書" },
            { href: "/admin/products", label: "商品編集" },
            { href: "/admin/inventory", label: "在庫管理" },
            { href: "/admin/barcodes", label: "バーコード" },
          ].map((l) => (
            <Link key={l.href} href={l.href} className="px-3 py-2 rounded text-gray-600 hover:bg-gray-50 hover:text-gray-900">
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

function KpiCard({ label, value, sub, href, color = "#111" }: { label: string; value: string; sub?: string; href: string; color?: string }) {
  return (
    <Link href={href} className="bg-white rounded-xl p-4 hover:shadow transition-shadow" style={{ border: "1px solid #e8eaed", display: "block" }}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-bold" style={{ color }}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </Link>
  )
}

function ActionCard({ href, title, desc, icon }: { href: string; title: string; desc: string; icon: React.ReactNode }) {
  return (
    <Link href={href} className="bg-white rounded-xl p-4 hover:bg-gray-50 transition-colors flex items-start gap-3" style={{ border: "1px solid #e8eaed" }}>
      <div className="text-gray-700 mt-0.5">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-gray-900">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
      </div>
    </Link>
  )
}
