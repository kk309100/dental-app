"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

type Stocktake = {
  id: string
  taken_on: string
  status: string
  note: string | null
  created_at: string
  finalized_at: string | null
}

export default function StocktakesPage() {
  const router = useRouter()
  const [list, setList] = useState<Stocktake[]>([])
  const [loading, setLoading] = useState(true)
  const [tableMissing, setTableMissing] = useState(false)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data, error } = await supabase.from("stocktakes").select("*").order("taken_on", { ascending: false })
    if (error) { setTableMissing(true); setList([]) } else setList((data as Stocktake[]) || [])
    setLoading(false)
  }

  async function createNew() {
    const today = new Date().toISOString().slice(0, 10)
    const date = prompt("棚卸日 (YYYY-MM-DD)", today)
    if (!date) return
    // 1) 棚卸ヘッダ作成
    const { data: st, error: e1 } = await supabase.from("stocktakes")
      .insert({ taken_on: date, status: "進行中" }).select().single()
    if (e1 || !st) { alert("作成失敗: " + (e1?.message || "")); return }
    // 2) 全商品の現在在庫を初期値としてスナップショット
    const { data: products } = await supabase.from("products").select("id,stock,active").or("active.is.null,active.eq.true").limit(50000)
    if (products && products.length > 0) {
      const items = (products as { id: string; stock: number | null }[]).map(p => ({
        stocktake_id: st.id,
        product_id: p.id,
        system_stock: Number(p.stock || 0),
        counted_stock: null,
        reason: null,
      }))
      // バッチで insert（500件ずつ）
      for (let i = 0; i < items.length; i += 500) {
        const slice = items.slice(i, i + 500)
        const { error } = await supabase.from("stocktake_items").insert(slice)
        if (error) { alert("明細作成失敗: " + error.message); break }
      }
    }
    router.push(`/admin/stocktakes/${st.id}`)
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  if (tableMissing) {
    return (
      <div className="max-w-2xl mx-auto bg-amber-50 border border-amber-200 rounded-lg p-6 mt-12">
        <h1 className="text-lg font-bold text-amber-900 mb-2">📋 棚卸（未セットアップ）</h1>
        <p className="text-sm text-amber-800">stocktakes テーブルがまだ作成されていません。<br />
          Supabase Studio で <code className="bg-white px-1.5 py-0.5 rounded">db/migrations/2026-05-05_full_overhaul.sql</code> を実行してください。
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900">
          棚卸
          <span className="ml-2 text-xs font-normal text-gray-400">{list.length} 回実施</span>
        </h1>
        <button onClick={createNew} className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded hover:bg-emerald-700">
          ＋ 新規棚卸
        </button>
      </div>

      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0" }}>
        <table className="w-full text-xs">
          <thead className="bg-gray-100">
            <tr className="text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-3 py-1.5 text-left w-32">棚卸日</th>
              <th className="px-2 py-1.5 text-center w-24">状態</th>
              <th className="px-3 py-1.5 text-left">備考</th>
              <th className="px-2 py-1.5 text-center w-32">確定日時</th>
              <th className="px-2 py-1.5 text-center w-24">開く</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">棚卸履歴なし</td></tr>
            ) : list.map(st => (
              <tr key={st.id} className="border-b border-gray-100 hover:bg-blue-50/40">
                <td className="px-3 py-1.5">{new Date(st.taken_on).toLocaleDateString("ja-JP")}</td>
                <td className="px-2 py-1.5 text-center">
                  <span className={"text-[10px] font-bold px-2 py-0.5 rounded " + (st.status === "確定" ? "bg-emerald-100 text-emerald-700" : st.status === "取消" ? "bg-gray-200 text-gray-500" : "bg-amber-100 text-amber-800")}>
                    {st.status}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-gray-600">{st.note || ""}</td>
                <td className="px-2 py-1.5 text-center text-[11px] text-gray-500">
                  {st.finalized_at ? new Date(st.finalized_at).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" }) : "—"}
                </td>
                <td className="px-2 py-1.5 text-center">
                  <Link href={`/admin/stocktakes/${st.id}`} className="text-[10px] px-2 py-0.5 border border-gray-200 rounded hover:bg-gray-50">開く</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
