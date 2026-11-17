"use client"

// 操作の記録の一覧。「いつ・だれが・何をしたか」を、あとから調べる。
import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"

type Row = { id: string; created_at: string; actor: string | null; action: string; entity_type: string | null; entity_id: string | null; detail: unknown; page: string | null }

const fmt = (iso: string) => {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

export default function OperationLogPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [q, setQ] = useState("")
  const [action, setAction] = useState("")
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => { (async () => {
    const { data, error } = await supabase.from("operation_log").select("*").order("created_at", { ascending: false }).limit(1000)
    if (error) setMissing(true)
    setRows((data as Row[]) || [])
    setLoading(false)
  })() }, [])

  const actions = useMemo(() => Array.from(new Set(rows.map(r => r.action))).sort(), [rows])
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase()
    return rows.filter(r => (!action || r.action === action) && (!k || JSON.stringify([r.action, r.actor, r.entity_id, r.detail]).toLowerCase().includes(k)))
  }, [rows, q, action])

  return (
    <div className="max-w-6xl mx-auto space-y-3">
      <div className="flex items-center flex-wrap gap-2">
        <Link href="/admin/orders" className="px-3 py-1.5 border border-gray-200 rounded text-sm bg-white hover:bg-gray-50">← 注文管理</Link>
        <h1 className="font-bold text-gray-900" style={{ fontSize: 20 }}>操作の記録</h1>
        <span className="text-xs text-gray-500">強制発注・発注プール追加・入荷・注文の編集と削除・医院の変更・発注書の削除など（新しい順・最大1000件）</span>
      </div>
      {missing && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">記録の表（operation_log）がまだ作られていません。SQLの実行が必要です。</p>}
      <div className="flex items-center gap-2 flex-wrap bg-gray-50 p-2 rounded-lg" style={{ border: "1px solid #e8eaed" }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="商品名・注文番号の先頭8桁・内容で検索" className="flex-1 min-w-[200px] px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <select value={action} onChange={e => setAction(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="">すべての操作</option>
          {actions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="text-xs text-gray-500">{shown.length}件</span>
      </div>
      {loading ? <p className="text-gray-400 text-center py-8">読み込み中…</p> : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-gray-600 text-xs">
              <th className="px-2 py-1.5 text-left whitespace-nowrap">日時</th>
              <th className="px-2 py-1.5 text-left">操作</th>
              <th className="px-2 py-1.5 text-left">だれが</th>
              <th className="px-2 py-1.5 text-left">対象ID</th>
              <th className="px-2 py-1.5 text-left">内容</th>
            </tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={5} className="text-center text-gray-400 py-8">記録がありません</td></tr>}
              {shown.map(r => (
                <tr key={r.id} className="border-t border-gray-100 align-top cursor-pointer hover:bg-gray-50" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{fmt(r.created_at)}</td>
                  <td className="px-2 py-1.5 font-bold whitespace-nowrap">{r.action}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-gray-600">{r.actor || "-"}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-gray-500 whitespace-nowrap">{r.entity_id ? String(r.entity_id).slice(0, 8) : "-"}</td>
                  <td className="px-2 py-1.5 text-[12px] text-gray-700 break-all">
                    {open === r.id ? <pre className="whitespace-pre-wrap">{JSON.stringify(r.detail, null, 1)}</pre> : <span className="line-clamp-2">{r.detail ? JSON.stringify(r.detail) : ""}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
