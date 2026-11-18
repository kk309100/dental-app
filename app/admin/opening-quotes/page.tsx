"use client"

// 開設見積書の一覧
import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import type { OpeningQuote } from "@/lib/opening-quote"

export default function OpeningQuoteListPage() {
  const [rows, setRows] = useState<OpeningQuote[]>([])
  const [clinics, setClinics] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [q, setQ] = useState("")

  useEffect(() => { (async () => {
    const { data, error } = await supabase.from("opening_quotes").select("*").order("manage_no", { ascending: false }).limit(500)
    if (error) setMissing(true)
    setRows((data as OpeningQuote[]) || [])
    const { data: cl } = await supabase.from("clinics").select("id,name")
    setClinics(new Map(((cl as { id: string; name: string }[]) || []).map(c => [c.id, c.name])))
    setLoading(false)
  })() }, [])

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase()
    return rows.filter(r => !k || `${r.manage_no} ${r.title} ${clinics.get(r.clinic_id || "") || ""}`.toLowerCase().includes(k))
  }, [rows, q, clinics])

  return (
    <div className="max-w-5xl mx-auto space-y-3">
      <div className="flex items-center flex-wrap gap-2">
        <Link href="/admin/quotes" className="px-3 py-1.5 border border-gray-200 rounded text-sm bg-white hover:bg-gray-50">← 見積</Link>
        <h1 className="font-bold text-gray-900" style={{ fontSize: 20 }}>開設見積書</h1>
        <Link href="/admin/opening-quotes/new" className="ml-auto px-4 py-2 text-sm font-bold rounded bg-blue-600 text-white">＋ 新規作成</Link>
      </div>
      <p className="text-xs text-gray-500">個別見積を「内訳」として組み込み、総括ページと内訳ページで印刷できる見積書です。</p>
      {missing && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">開設見積の表が、まだ作られていません（SQLの実行が必要です）。</p>}
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="管理番号・表題・医院で検索" className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white" />
      {loading ? <p className="text-gray-400 text-center py-8">読み込み中…</p> : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-xs text-gray-600">
              <th className="px-2 py-1.5 text-left">管理番号</th><th className="px-2 py-1.5 text-left">作成日</th><th className="px-2 py-1.5 text-left">医院</th><th className="px-2 py-1.5 text-left">表題</th>
              <th className="px-2 py-1.5 text-right">内訳</th><th className="px-2 py-1.5 text-right">合計（税込）</th><th className="px-2 py-1.5"></th>
            </tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={7} className="text-center text-gray-400 py-8">開設見積はありません</td></tr>}
              {shown.map(r => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="px-2 py-1.5 font-mono"><Link href={`/admin/opening-quotes/${r.id}`} className="text-blue-700 underline">{r.manage_no}</Link></td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.issue_date || ""}</td>
                  <td className="px-2 py-1.5">{clinics.get(r.clinic_id || "") || ""}</td>
                  <td className="px-2 py-1.5">{r.title || ""}{r.status === "ordered" && <span className="ml-1 text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">注文済</span>}</td>
                  <td className="px-2 py-1.5 text-right">{r.section_count}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-bold">{fmtYen(Number(r.total || 0))}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap"><Link href={`/admin/opening-quotes/${r.id}/print`} target="_blank" className="text-[12px] px-2 py-0.5 rounded border border-gray-300 bg-white">印刷</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
