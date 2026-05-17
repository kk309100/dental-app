"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { downloadCSV, toCSV } from "@/lib/csv"

type Log = {
  id: string
  occurred_at: string
  actor: string | null
  action: string
  entity_type: string
  entity_id: string | null
  before_data: unknown
  after_data: unknown
  note: string | null
}

const ACTION_COLORS: Record<string, string> = {
  INSERT: "#10b981",
  UPDATE: "#3b82f6",
  DELETE: "#dc2626",
  VIEW: "#9ca3af",
  LOGIN: "#8b5cf6",
  EXPORT: "#f59e0b",
  PRINT: "#6366f1",
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<Log[]>([])
  const [loading, setLoading] = useState(true)
  const [tableMissing, setTableMissing] = useState(false)
  const [search, setSearch] = useState("")
  const [actionFilter, setActionFilter] = useState("all")
  const [entityFilter, setEntityFilter] = useState("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [showDetailId, setShowDetailId] = useState<string | null>(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data, error } = await supabase.from("audit_logs").select("*").order("occurred_at", { ascending: false }).limit(2000)
    if (error) { setTableMissing(true); setLoading(false); return }
    setLogs((data as Log[]) || [])
    setLoading(false)
  }

  const entityTypes = useMemo(() => Array.from(new Set(logs.map(l => l.entity_type))).sort(), [logs])
  const actors = useMemo(() => Array.from(new Set(logs.map(l => l.actor || "(unknown)"))).sort(), [logs])

  const filtered = useMemo(() => {
    return logs.filter(l => {
      if (actionFilter !== "all" && l.action !== actionFilter) return false
      if (entityFilter !== "all" && l.entity_type !== entityFilter) return false
      if (from && l.occurred_at < from) return false
      if (to && l.occurred_at > to + "T23:59:59") return false
      if (search) {
        const k = search.toLowerCase()
        const target = `${l.actor || ""} ${l.action} ${l.entity_type} ${l.entity_id || ""} ${l.note || ""}`.toLowerCase()
        if (!target.includes(k)) return false
      }
      return true
    })
  }, [logs, actionFilter, entityFilter, search, from, to])

  function exportCSV() {
    const csv = toCSV(
      filtered.map(l => ({
        日時: new Date(l.occurred_at).toLocaleString("ja-JP"),
        操作者: l.actor || "(unknown)",
        操作: l.action,
        対象テーブル: l.entity_type,
        対象ID: l.entity_id || "",
        備考: l.note || "",
      }))
    )
    downloadCSV(`監査ログ_${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  if (tableMissing) {
    return (
      <div className="max-w-2xl mx-auto bg-amber-50 border border-amber-200 rounded-lg p-6 mt-12">
        <h1 className="text-lg font-bold text-amber-900 mb-2">📋 監査ログ（未セットアップ）</h1>
        <p className="text-sm text-amber-800">audit_logs テーブルがまだ作成されていません。<br />
          Supabase Studio で <code className="bg-white px-1.5 py-0.5 rounded">db/migrations/2026-05-05_full_overhaul.sql</code> を実行してください。
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900">
          監査ログ
          <span className="ml-2 text-xs font-normal text-gray-400">直近 {logs.length} 件 / 該当 {filtered.length} 件</span>
        </h1>
        <button onClick={exportCSV} className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded hover:bg-gray-50">📤 CSV</button>
      </div>

      <div className="flex gap-1.5 items-center bg-gray-50 p-2 rounded-lg flex-wrap" style={{ border: "1px solid #e8eaed" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="操作者・対象・備考で検索"
          className="flex-1 min-w-[180px] px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="all">全操作</option>
          {Object.keys(ACTION_COLORS).map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="all">全テーブル</option>
          {entityTypes.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <span className="text-xs text-gray-400">〜</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
      </div>

      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0" }}>
        <table className="w-full text-xs">
          <thead className="bg-gray-100 sticky top-0">
            <tr className="text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-2 py-1.5 text-center w-36">日時</th>
              <th className="px-2 py-1.5 text-left w-32">操作者</th>
              <th className="px-2 py-1.5 text-center w-20">操作</th>
              <th className="px-2 py-1.5 text-left w-32">対象テーブル</th>
              <th className="px-2 py-1.5 text-left w-48">対象ID</th>
              <th className="px-2 py-1.5 text-left">備考</th>
              <th className="px-2 py-1.5 text-center w-16">詳細</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">該当なし</td></tr>
            ) : filtered.map(l => {
              const color = ACTION_COLORS[l.action] || "#9ca3af"
              return (
                <tr key={l.id} className="border-b border-gray-100 hover:bg-blue-50/40">
                  <td className="px-2 py-1.5 text-center text-[11px] text-gray-600">{new Date(l.occurred_at).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "medium" })}</td>
                  <td className="px-2 py-1.5">{l.actor || <span className="text-gray-400">(unknown)</span>}</td>
                  <td className="px-2 py-1.5 text-center">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: color + "22", color }}>{l.action}</span>
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-gray-700">{l.entity_type}</td>
                  <td className="px-2 py-1.5 font-mono text-[10px] text-gray-500">{l.entity_id ? l.entity_id.slice(0, 8) + "…" : "—"}</td>
                  <td className="px-2 py-1.5 text-[11px] text-gray-600">{l.note || ""}</td>
                  <td className="px-2 py-1.5 text-center">
                    {(l.before_data || l.after_data) && (
                      <button onClick={() => setShowDetailId(l.id)} className="text-[10px] px-2 py-0.5 border border-gray-200 rounded hover:bg-gray-50">差分</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 差分モーダル */}
      {showDetailId && (() => {
        const l = logs.find(x => x.id === showDetailId)
        if (!l) return null
        return (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowDetailId(null)}>
            <div className="bg-white rounded-lg max-w-3xl w-full max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <h2 className="font-bold">変更内容: {l.entity_type} {l.entity_id?.slice(0, 8) || ""}</h2>
                <button onClick={() => setShowDetailId(null)} className="text-2xl text-gray-400">×</button>
              </div>
              <div className="p-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-bold text-gray-500 mb-1">変更前</p>
                  <pre className="text-[10px] bg-red-50 p-2 rounded overflow-auto" style={{ maxHeight: 400 }}>
                    {l.before_data ? JSON.stringify(l.before_data, null, 2) : "(なし)"}
                  </pre>
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-500 mb-1">変更後</p>
                  <pre className="text-[10px] bg-emerald-50 p-2 rounded overflow-auto" style={{ maxHeight: 400 }}>
                    {l.after_data ? JSON.stringify(l.after_data, null, 2) : "(なし)"}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
