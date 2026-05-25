"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { downloadCSV, toCSV } from "@/lib/csv"

type Mvmt = {
  id: string
  product_id: string
  movement_type: string
  quantity: number
  before_stock: number | null
  after_stock: number | null
  ref_type: string | null
  reason: string | null
  occurred_at: string
}
type Product = { id: string; name: string; product_code: string | null; cost: number | null }

const TYPE_COLORS: Record<string, string> = {
  "入庫": "#10b981",
  "出庫": "#dc2626",
  "棚卸調整": "#f59e0b",
  "破損": "#9ca3af",
  "紛失": "#9ca3af",
  "返品": "#6366f1",
}

export default function StockMovementsPage() {
  const [mvmts, setMvmts] = useState<Mvmt[]>([])
  const [products, setProducts] = useState<Map<string, Product>>(new Map())
  const [loading, setLoading] = useState(true)
  const [tableMissing, setTableMissing] = useState(false)
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data: m, error } = await supabase.from("stock_movements").select("*").order("occurred_at", { ascending: false }).limit(2000)
    if (error) { setTableMissing(true); setLoading(false); return }
    setMvmts((m as Mvmt[]) || [])
    const ids = Array.from(new Set((m as Mvmt[] || []).map(x => x.product_id)))
    if (ids.length > 0) {
      const { data: ps } = await supabase.from("products").select("id,name,product_code,cost").in("id", ids)
      const map = new Map<string, Product>()
      ;(ps as Product[] | null)?.forEach(p => map.set(p.id, p))
      setProducts(map)
    }
    setLoading(false)
  }

  const filtered = useMemo(() => {
    return mvmts.filter(m => {
      if (typeFilter !== "all" && m.movement_type !== typeFilter) return false
      if (from && m.occurred_at < from) return false
      if (to && m.occurred_at > to + "T23:59:59") return false
      if (search) {
        const p = products.get(m.product_id)
        const target = `${p?.name || ""} ${p?.product_code || ""} ${m.reason || ""}`.toLowerCase()
        if (!target.includes(search.toLowerCase())) return false
      }
      return true
    })
  }, [mvmts, products, typeFilter, search, from, to])

  const summary = useMemo(() => {
    const types = new Map<string, { count: number; qty: number; value: number }>()
    filtered.forEach(m => {
      const e = types.get(m.movement_type) || { count: 0, qty: 0, value: 0 }
      e.count += 1
      e.qty += Number(m.quantity || 0)
      const cost = Number(products.get(m.product_id)?.cost || 0)
      e.value += Number(m.quantity || 0) * cost
      types.set(m.movement_type, e)
    })
    return Array.from(types.entries()).map(([k, v]) => ({ type: k, ...v }))
  }, [filtered, products])

  function exportCSV() {
    const csv = toCSV(
      filtered.map(m => {
        const p = products.get(m.product_id)
        return {
          日時: new Date(m.occurred_at).toLocaleString("ja-JP"),
          種別: m.movement_type,
          商品名: p?.name || "(削除済み)",
          商品コード: p?.product_code || "",
          数量: m.quantity,
          変更前: m.before_stock ?? "",
          変更後: m.after_stock ?? "",
          理由: m.reason || "",
          参照元: m.ref_type || "",
        }
      })
    )
    downloadCSV(`在庫履歴_${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  if (tableMissing) {
    return (
      <div className="max-w-2xl mx-auto bg-amber-50 border border-amber-200 rounded-lg p-6 mt-12">
        <h1 className="text-lg font-bold text-amber-900 mb-2">📋 在庫履歴（未セットアップ）</h1>
        <p className="text-sm text-amber-800">stock_movements テーブルがまだ作成されていません。<br />
          Supabase Studio で <code className="bg-white px-1.5 py-0.5 rounded">db/migrations/2026-05-05_full_overhaul.sql</code> を実行してください。
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827" }}>
        在庫移動履歴
        <span className="ml-2 text-xs font-normal text-gray-400">直近 {mvmts.length} 件</span>
      </h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {summary.map(s => (
          <div key={s.type} className="bg-white rounded p-3" style={{ border: "1px solid #e8eaed" }}>
            <p style={{ fontSize: 12, fontWeight: 700 }} className="text-gray-500">
              <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: TYPE_COLORS[s.type] || "#9ca3af" }}></span>
              {s.type}
            </p>
            <p className="text-xs text-gray-600 mt-1">{s.count} 件 / {s.qty > 0 ? "+" : ""}{s.qty} 個</p>
            <p className="text-sm font-bold tabular-nums">{fmtYen(Math.abs(s.value))}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-1.5 items-center bg-gray-50 p-2 rounded-lg flex-wrap" style={{ border: "1px solid #e8eaed" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="商品名・コード・理由"
          className="flex-1 min-w-[180px] px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="all">全種別</option>
          {Object.keys(TYPE_COLORS).map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <span className="text-xs text-gray-400">〜</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <button onClick={exportCSV} className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded hover:bg-gray-50">📤 CSV</button>
      </div>

      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0" }}>
        <table className="w-full text-xs">
          <thead className="bg-gray-100 sticky top-0">
            <tr style={{ fontSize: 12, fontWeight: 700 }} className="text-gray-700 border-b-2 border-gray-300">
              <th className="px-2 py-1.5 text-center w-32">日時</th>
              <th className="px-2 py-1.5 text-center w-20">種別</th>
              <th className="px-2 py-1.5 text-left">商品</th>
              <th className="px-2 py-1.5 text-right w-16">数量</th>
              <th className="px-2 py-1.5 text-right w-16">前</th>
              <th className="px-2 py-1.5 text-right w-16">後</th>
              <th className="px-2 py-1.5 text-left">理由・参照</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">該当なし</td></tr>
            ) : filtered.map(m => {
              const p = products.get(m.product_id)
              const color = TYPE_COLORS[m.movement_type] || "#9ca3af"
              return (
                <tr key={m.id} className="border-b border-gray-100 hover:bg-blue-50/40">
                  <td className="px-2 py-1.5 text-center text-gray-600" style={{ fontSize: 12 }}>{new Date(m.occurred_at).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="px-2 py-1.5 text-center">
                    <span className="font-bold px-2 py-0.5 rounded" style={{ fontSize: 11, background: color + "22", color }}>{m.movement_type}</span>
                  </td>
                  <td className="px-2 py-1.5">{p?.name || "(削除済み)"} <span style={{ fontSize: 11 }} className="text-gray-400">{p?.product_code || ""}</span></td>
                  <td className={"px-2 py-1.5 text-right tabular-nums font-bold " + (m.quantity > 0 ? "text-emerald-700" : "text-red-600")}>{m.quantity > 0 ? "+" : ""}{m.quantity}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{m.before_stock ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-700 font-bold">{m.after_stock ?? "—"}</td>
                  <td className="px-2 py-1.5 text-gray-600" style={{ fontSize: 12 }}>{m.reason || ""} {m.ref_type ? `(${m.ref_type})` : ""}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
