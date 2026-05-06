"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { GroupViewTabs, useGroupView, type GroupableRow } from "@/app/components/GroupViewTabs"

type PO = {
  id: string
  po_number: string | null
  supplier_id: string | null
  status: string
  ordered_at: string | null
  expected_at: string | null
  total_amount: number | null
  note: string | null
  sent_method: string | null
  sent_at: string | null
  created_at: string
}
type Supplier = { id: string; name: string }
type POItem = { id: string; po_id: string; product_name: string | null; quantity: number; unit_price: number | null }

const STATUSES = ["下書き", "発注済", "部分入荷", "入荷済", "取消"] as const
const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  "下書き": { bg: "#f3f4f6", color: "#6b7280" },
  "発注済": { bg: "#dbeafe", color: "#1e40af" },
  "部分入荷": { bg: "#fef3c7", color: "#92400e" },
  "入荷済": { bg: "#dcfce7", color: "#15803d" },
  "取消": { bg: "#fee2e2", color: "#b91c1c" },
}

export default function PurchaseOrdersListPage() {
  const [pos, setPos] = useState<PO[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [poItems, setPoItems] = useState<POItem[]>([])
  const [loading, setLoading] = useState(true)
  const [tableMissing, setTableMissing] = useState(false)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [supplierFilter, setSupplierFilter] = useState<string>("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [sortBy, setSortBy] = useState<"date_desc" | "date_asc" | "amount_desc" | "amount_asc">("date_desc")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [groupView, setGroupView] = useGroupView()

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data: s } = await supabase.from("suppliers").select("id,name").order("name").limit(50000)
    setSuppliers((s as Supplier[]) || [])
    const { data: p, error } = await supabase.from("purchase_orders").select("*").order("created_at", { ascending: false }).limit(50000)
    if (error) { setTableMissing(true); setPos([]) }
    else setPos((p as PO[]) || [])
    // 商品別集計用に明細も取得（テーブル無い時はスキップ）
    try {
      const { data: items } = await supabase.from("purchase_order_items").select("id,po_id,product_name,quantity,unit_price").limit(50000)
      setPoItems((items as POItem[]) || [])
    } catch { setPoItems([]) }
    setLoading(false)
  }

  const supplierName = (id: string | null) => id ? suppliers.find(s => s.id === id)?.name || "(削除済み)" : "(未指定)"

  const filtered = useMemo(() => {
    return pos.filter(p => {
      if (statusFilter === "active" && (p.status === "入荷済" || p.status === "取消")) return false
      if (statusFilter !== "active" && statusFilter !== "all" && p.status !== statusFilter) return false
      if (supplierFilter !== "all" && p.supplier_id !== supplierFilter) return false
      const dateStr = (p.ordered_at || p.created_at).slice(0, 10)
      if (from && dateStr < from) return false
      if (to && dateStr > to) return false
      if (!search) return true
      const k = search.toLowerCase()
      const target = `${p.po_number || ""} ${supplierName(p.supplier_id)} ${p.note || ""}`.toLowerCase()
      return target.includes(k)
    }).sort((a, b) => {
      const ad = a.ordered_at || a.created_at
      const bd = b.ordered_at || b.created_at
      if (sortBy === "date_desc") return bd.localeCompare(ad)
      if (sortBy === "date_asc") return ad.localeCompare(bd)
      if (sortBy === "amount_desc") return Number(b.total_amount || 0) - Number(a.total_amount || 0)
      if (sortBy === "amount_asc") return Number(a.total_amount || 0) - Number(b.total_amount || 0)
      return 0
    })
  }, [pos, statusFilter, supplierFilter, from, to, sortBy, search, suppliers])

  // 明細を発注書IDでグループ化
  const itemsByPo = useMemo(() => {
    const m = new Map<string, POItem[]>()
    poItems.forEach(it => {
      if (!m.has(it.po_id)) m.set(it.po_id, [])
      m.get(it.po_id)!.push(it)
    })
    return m
  }, [poItems])

  // GroupViewTabs 用の行データ
  const groupRows: GroupableRow[] = useMemo(() => filtered.map(p => ({
    id: p.id,
    date: (p.ordered_at || p.created_at || "").slice(0, 10),
    party: supplierName(p.supplier_id),
    amount: Number(p.total_amount || 0),
    items: (itemsByPo.get(p.id) || []).map(it => ({
      name: it.product_name || "(不明)",
      quantity: Number(it.quantity || 0),
      price: Number(it.unit_price || 0),
    })),
  })), [filtered, itemsByPo, suppliers])

  function toggleSel(id: string) {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function selectAll() { setSelected(new Set(filtered.map(p => p.id))) }
  function clearSel() { setSelected(new Set()) }
  function bulkPrint() {
    if (selected.size === 0) { alert("選択がありません"); return }
    const ids = Array.from(selected).join(",")
    window.open(`/admin/purchase-orders/print?ids=${ids}`, "_blank")
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  if (tableMissing) {
    return (
      <div className="max-w-2xl mx-auto bg-amber-50 border border-amber-200 rounded-lg p-6 mt-12">
        <h1 className="text-lg font-bold text-amber-900 mb-2">📋 発注書管理（未セットアップ）</h1>
        <p className="text-sm text-amber-800 mb-3">
          purchase_orders テーブルがまだ作成されていません。<br />
          Supabase Studio で <code className="bg-white px-1.5 py-0.5 rounded">db/migrations/2026-05-05_full_overhaul.sql</code> を実行してください。
        </p>
        <Link href="/admin/purchase-order" className="text-sm text-blue-600 underline">→ 既存の「発注（推奨発注リスト）」ページへ</Link>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900">
          発注書管理
          <span className="ml-2 text-xs font-normal text-gray-400">該当 {filtered.length}/全 {pos.length} 件</span>
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={bulkPrint} disabled={selected.size === 0}
            className="px-3 py-1.5 bg-gray-800 text-white text-xs font-bold rounded hover:bg-gray-700 disabled:opacity-40">
            🖨 選択を一括印刷 ({selected.size})
          </button>
          <Link href="/admin/purchase-orders/suggest"
            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded hover:bg-blue-700">
            🤖 在庫不足から自動作成
          </Link>
          <Link href="/admin/purchase-orders/new"
            className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded hover:bg-emerald-700">
            ＋ 新規発注書
          </Link>
        </div>
      </div>

      <div className="flex gap-1.5 items-center bg-gray-50 p-2 rounded-lg flex-wrap" style={{ border: "1px solid #e8eaed" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="発注書No・仕入先・備考"
          className="flex-1 min-w-[180px] px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="active">未完了のみ</option>
          <option value="all">すべて</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}
          className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white max-w-[200px]">
          <option value="all">全仕入先</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <span className="text-xs text-gray-400">〜</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="date_desc">📅 新しい順</option>
          <option value="date_asc">📅 古い順</option>
          <option value="amount_desc">💰 金額大→小</option>
          <option value="amount_asc">💰 金額小→大</option>
        </select>
      </div>

      <GroupViewTabs value={groupView} onChange={setGroupView} rows={groupRows} partyLabel="仕入先">
      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0" }}>
        <table className="w-full text-xs">
          <thead className="bg-gray-100">
            <tr className="text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-2 py-1.5 text-center w-8">
                <input type="checkbox" checked={filtered.length > 0 && selected.size === filtered.length} onChange={e => e.target.checked ? selectAll() : clearSel()} />
              </th>
              <th className="px-3 py-1.5 text-left w-32">発注書No</th>
              <th className="px-3 py-1.5 text-left">仕入先</th>
              <th className="px-2 py-1.5 text-center w-20">状態</th>
              <th className="px-2 py-1.5 text-center w-24">発注日</th>
              <th className="px-2 py-1.5 text-center w-24">納期予定</th>
              <th className="px-2 py-1.5 text-right w-28">金額</th>
              <th className="px-2 py-1.5 text-center w-24">送付方法</th>
              <th className="px-2 py-1.5 text-center w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-400">該当なし</td></tr>
            ) : filtered.map(p => {
              const sc = STATUS_COLORS[p.status] || STATUS_COLORS["下書き"]
              return (
                <tr key={p.id} className={"border-b border-gray-100 hover:bg-blue-50/40 " + (selected.has(p.id) ? "bg-blue-100" : "")}>
                  <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSel(p.id)} /></td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-gray-700">{p.po_number || p.id.slice(0, 8)}</td>
                  <td className="px-3 py-1.5">{supplierName(p.supplier_id)}</td>
                  <td className="px-2 py-1.5 text-center">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: sc.bg, color: sc.color }}>{p.status}</span>
                  </td>
                  <td className="px-2 py-1.5 text-center text-[11px] text-gray-600">
                    {p.ordered_at ? new Date(p.ordered_at).toLocaleDateString("ja-JP") : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-center text-[11px] text-gray-600">
                    {p.expected_at ? new Date(p.expected_at).toLocaleDateString("ja-JP") : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-bold">{fmtYen(p.total_amount || 0)}</td>
                  <td className="px-2 py-1.5 text-center text-[11px] text-gray-500">
                    {p.sent_method || "—"}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <Link href={`/admin/purchase-orders/${p.id}`} className="text-[10px] px-2 py-0.5 border border-gray-200 rounded hover:bg-gray-50">開く</Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      </GroupViewTabs>
    </div>
  )
}
