"use client"

// 仕入先請求書（月次まとめ）一覧
// アップロードした請求書 PDFごとに 1レコード
// 自動マッチング結果をカウント表示

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"

type SupplierInvoice = {
  id: string
  supplier_id: string
  invoice_number: string | null
  invoice_date: string | null
  period_start: string | null
  period_end: string | null
  total_amount: number | null
  computed_total: number | null
  status: string
  matched_at: string | null
  pdf_filename: string | null
  notes: string | null
  created_at: string
}
type Supplier = { id: string; name: string }
type ItemCount = {
  supplier_invoice_id: string
  total: number
  matched: number
  qty_mismatch: number
  price_mismatch: number
  amount_mismatch: number
  no_product: number
  unmatched: number
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  "未照合": { bg: "#f3f4f6", color: "#6b7280" },
  "差異あり": { bg: "#fef3c7", color: "#92400e" },
  "OK": { bg: "#dcfce7", color: "#15803d" },
  "確定": { bg: "#dbeafe", color: "#1e40af" },
  "取消": { bg: "#fee2e2", color: "#b91c1c" },
}

export default function SupplierInvoicesPage() {
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [counts, setCounts] = useState<Map<string, ItemCount>>(new Map())
  const [loading, setLoading] = useState(true)
  const [supplierFilter, setSupplierFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [inv, sup] = await Promise.all([
      supabase.from("supplier_invoices").select("*").order("invoice_date", { ascending: false }).limit(50000),
      supabase.from("suppliers").select("id,name").order("name").limit(50000),
    ])
    setInvoices((inv.data as SupplierInvoice[]) || [])
    setSuppliers((sup.data as Supplier[]) || [])

    // 各請求書のマッチング集計
    const ids = ((inv.data as SupplierInvoice[]) || []).map(i => i.id)
    if (ids.length > 0) {
      const { data: items } = await supabase.from("supplier_invoice_items")
        .select("supplier_invoice_id,match_status")
        .in("supplier_invoice_id", ids)
        .limit(50000)
      const m = new Map<string, ItemCount>()
      ids.forEach(id => m.set(id, {
        supplier_invoice_id: id,
        total: 0, matched: 0, qty_mismatch: 0, price_mismatch: 0, amount_mismatch: 0, no_product: 0, unmatched: 0,
      }))
      ;(items || []).forEach((it: any) => {
        const c = m.get(it.supplier_invoice_id)
        if (!c) return
        c.total++
        const k = it.match_status as keyof ItemCount
        if (typeof c[k] === "number") (c[k] as number)++
      })
      setCounts(m)
    }
    setLoading(false)
  }

  const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name || "(削除済)"

  const filtered = useMemo(() => {
    return invoices.filter(iv => {
      if (supplierFilter !== "all" && iv.supplier_id !== supplierFilter) return false
      if (statusFilter !== "all" && iv.status !== statusFilter) return false
      const d = (iv.invoice_date || iv.created_at).slice(0, 10)
      if (from && d < from) return false
      if (to && d > to) return false
      return true
    })
  }, [invoices, supplierFilter, statusFilter, from, to])

  if (loading) return <p className="text-center py-12 text-gray-400">読み込み中…</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900">
          📋 仕入先請求書 付け合わせ
          <span className="ml-2 text-xs font-normal text-gray-400">該当 {filtered.length}/全{invoices.length}件</span>
        </h1>
        <div className="flex items-center gap-2">
          <Link href="/admin/supplier-invoices/new"
            className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded hover:bg-emerald-700">
            ＋ 月次請求書をアップロード
          </Link>
        </div>
      </div>

      <div className="text-xs text-gray-600 bg-blue-50 rounded p-2" style={{ border: "1px solid #c7d2fe" }}>
        💡 仕入先から届く<strong>月次まとめ請求書PDF</strong>をアップロードすると、AIが明細を解析し、
        既にシステムに登録済みの<strong>仕入入荷データ</strong>と自動で付け合わせます。
        差異（数量・金額ズレ、漏れ）を可視化して仕入先への問い合わせを支援します。
      </div>

      <div className="flex gap-1.5 items-center bg-gray-50 p-2 rounded-lg flex-wrap" style={{ border: "1px solid #e8eaed" }}>
        <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}
          className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white max-w-[200px]">
          <option value="all">全仕入先</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="all">全状態</option>
          {Object.keys(STATUS_COLORS).map(s => <option key={s}>{s}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <span className="text-xs text-gray-400">〜</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
      </div>

      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0" }}>
        <table className="w-full text-xs">
          <thead className="bg-gray-100">
            <tr className="text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-2 py-1.5 text-left">仕入先</th>
              <th className="px-2 py-1.5 text-left w-32">請求書No</th>
              <th className="px-2 py-1.5 text-center w-32">期間</th>
              <th className="px-2 py-1.5 text-right w-28">請求額</th>
              <th className="px-2 py-1.5 text-center w-16">明細</th>
              <th className="px-2 py-1.5 text-center w-16">一致</th>
              <th className="px-2 py-1.5 text-center w-16">差異</th>
              <th className="px-2 py-1.5 text-center w-16">未マッチ</th>
              <th className="px-2 py-1.5 text-center w-20">状態</th>
              <th className="px-2 py-1.5 text-center w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400">
                月次請求書がありません。<br />
                <Link href="/admin/supplier-invoices/new" className="text-blue-600 underline mt-2 inline-block">＋ 最初の請求書をアップロード</Link>
              </td></tr>
            ) : filtered.map(iv => {
              const c = counts.get(iv.id)
              const matchedCount = c?.matched || 0
              const issueCount = (c?.qty_mismatch || 0) + (c?.price_mismatch || 0) + (c?.amount_mismatch || 0)
              const unmatchedCount = (c?.no_product || 0) + (c?.unmatched || 0)
              const sc = STATUS_COLORS[iv.status] || STATUS_COLORS["未照合"]
              return (
                <tr key={iv.id} className="border-b border-gray-100 hover:bg-blue-50/40">
                  <td className="px-2 py-1.5 font-bold">{supplierName(iv.supplier_id)}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-gray-600">{iv.invoice_number || "—"}</td>
                  <td className="px-2 py-1.5 text-center text-[11px] text-gray-600">
                    {iv.period_start && iv.period_end ? (
                      `${iv.period_start.slice(5)} 〜 ${iv.period_end.slice(5)}`
                    ) : iv.invoice_date ? (
                      new Date(iv.invoice_date).toLocaleDateString("ja-JP")
                    ) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-bold">{fmtYen(iv.total_amount || 0)}</td>
                  <td className="px-2 py-1.5 text-center">{c?.total || 0}</td>
                  <td className="px-2 py-1.5 text-center text-emerald-700 font-bold">{matchedCount}</td>
                  <td className="px-2 py-1.5 text-center text-amber-700 font-bold">{issueCount > 0 ? `⚠ ${issueCount}` : "—"}</td>
                  <td className="px-2 py-1.5 text-center text-red-700 font-bold">{unmatchedCount > 0 ? `❌ ${unmatchedCount}` : "—"}</td>
                  <td className="px-2 py-1.5 text-center">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: sc.bg, color: sc.color }}>{iv.status}</span>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <Link href={`/admin/supplier-invoices/${iv.id}/match`}>
                      <button className="text-[10px] px-2 py-0.5 border border-gray-200 rounded hover:bg-gray-50">開く</button>
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
