"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

const FB_KEY = "denthub_feedback_v1"

type FeedbackItem = {
  id: string
  timestamp: string
  page: string
  content: string
  priority: "高" | "中" | "低"
  status: "未対応" | "対応中" | "完了"
}

function load(): FeedbackItem[] {
  try { return JSON.parse(localStorage.getItem(FB_KEY) || "[]") } catch { return [] }
}
function save(items: FeedbackItem[]) {
  localStorage.setItem(FB_KEY, JSON.stringify(items))
}

const PRIORITY_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  高: { bg: "#fee2e2", color: "#b91c1c", border: "#fca5a5" },
  中: { bg: "#fef3c7", color: "#92400e", border: "#fde68a" },
  低: { bg: "#f3f4f6", color: "#6b7280", border: "#d1d5db" },
}
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  未対応: { bg: "#fee2e2", color: "#b91c1c" },
  対応中: { bg: "#fef3c7", color: "#92400e" },
  完了:   { bg: "#dcfce7", color: "#15803d" },
}

export default function FeedbackPage() {
  const [items, setItems]       = useState<FeedbackItem[]>([])
  const [filter, setFilter]     = useState<"all" | "未対応" | "対応中" | "完了">("all")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [mounted, setMounted]   = useState(false)

  useEffect(() => {
    setMounted(true)
    setItems(load())
  }, [])

  function updateStatus(id: string, status: FeedbackItem["status"]) {
    const next = items.map(i => i.id === id ? { ...i, status } : i)
    setItems(next); save(next)
  }

  function deleteItem(id: string) {
    if (!confirm("この修正メモを削除しますか？")) return
    const next = items.filter(i => i.id !== id)
    setItems(next); save(next)
  }

  function clearDone() {
    if (!confirm("「完了」の修正メモをすべて削除しますか？")) return
    const next = items.filter(i => i.status !== "完了")
    setItems(next); save(next)
  }

  async function copyForClaudeCode(item: FeedbackItem) {
    const dt = new Date(item.timestamp).toLocaleString("ja-JP")
    const text = [
      "以下の修正依頼に対応してください。既存機能は壊さないでください。Supabaseのデータ構造は変更しないでください。",
      "",
      `【ページ】   ${item.page}`,
      `【内容】     ${item.content}`,
      `【優先度】   ${item.priority}`,
      `【報告日時】 ${dt}`,
      "",
      "修正をお願いします。",
    ].join("\n")
    await navigator.clipboard.writeText(text)
    setCopiedId(item.id)
    setTimeout(() => setCopiedId(null), 3000)
  }

  function exportCSV() {
    const header = "ID,日時,ページ,優先度,ステータス,内容\n"
    const rows = items.map(i =>
      [i.id, new Date(i.timestamp).toLocaleString("ja-JP"), i.page, i.priority, i.status, `"${i.content.replace(/"/g, '""')}"`].join(",")
    ).join("\n")
    const blob = new Blob(["﻿" + header + rows], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a"); a.href = url
    a.download = `denthub_修正依頼_${new Date().toISOString().slice(0,10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  if (!mounted) return null

  const filtered = filter === "all" ? items : items.filter(i => i.status === filter)
  const counts = {
    未対応: items.filter(i => i.status === "未対応").length,
    対応中: items.filter(i => i.status === "対応中").length,
    完了:   items.filter(i => i.status === "完了").length,
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: 0 }}>
          📋 修正依頼一覧
        </h1>
        <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
          {counts.完了 > 0 && (
            <button onClick={clearDone} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", fontSize: 12, color: "#6b7280", cursor: "pointer" }}>
              🗑 完了済みをクリア
            </button>
          )}
          <button onClick={exportCSV} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", fontSize: 12, color: "#374151", cursor: "pointer", fontWeight: 600 }}>
            📥 CSV出力
          </button>
        </div>
      </div>

      {/* サマリーカード */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        {(["未対応", "対応中", "完了"] as const).map(s => (
          <div key={s} style={{ flex: 1, minWidth: 100, background: "#fff", border: `2px solid ${filter === s ? "#7c3aed" : "#e5e7eb"}`, borderRadius: 12, padding: "12px 16px", textAlign: "center", cursor: "pointer" }}
            onClick={() => setFilter(filter === s ? "all" : s)}>
            <div style={{ fontSize: 24, fontWeight: 800, color: STATUS_STYLE[s].color }}>{counts[s]}</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{s}</div>
          </div>
        ))}
        <div style={{ flex: 1, minWidth: 100, background: "#fff", border: `2px solid ${filter === "all" ? "#7c3aed" : "#e5e7eb"}`, borderRadius: 12, padding: "12px 16px", textAlign: "center", cursor: "pointer" }}
          onClick={() => setFilter("all")}>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#374151" }}>{items.length}</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>合計</div>
        </div>
      </div>

      {/* 使い方ガイド */}
      <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 12, color: "#0369a1" }}>
        💡 <strong>使い方：</strong>
        ① 管理画面で気になったら「📝 修正メモ」ボタンから記録
        　②「📋 Claude Code用コピー」でこのチャットに貼り付けて修正依頼
        　③ 対応済みになったらステータスを「完了」に
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, background: "#f9fafb", borderRadius: 14, color: "#9ca3af" }}>
          {items.length === 0
            ? <>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📝</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>まだ修正メモがありません</div>
                <p style={{ fontSize: 12, marginTop: 6 }}>管理画面右下の「📝 修正メモ」ボタンから記録できます</p>
              </>
            : <div>「{filter}」の修正メモはありません</div>
          }
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map(item => {
            const ps = PRIORITY_STYLE[item.priority]
            const ss = STATUS_STYLE[item.status]
            const isCopied = copiedId === item.id
            return (
              <div key={item.id} style={{
                background: item.status === "完了" ? "#f9fafb" : "#fff",
                border: "1px solid #e5e7eb", borderRadius: 12, padding: "14px 16px",
                opacity: item.status === "完了" ? 0.7 : 1,
              }}>
                {/* ヘッダー行 */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  {/* 優先度バッジ */}
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: ps.bg, color: ps.color, border: `1px solid ${ps.border}` }}>
                    {item.priority === "高" ? "🔴 高" : item.priority === "中" ? "🟡 中" : "⚪ 低"}
                  </span>
                  {/* ステータス選択 */}
                  <select
                    value={item.status}
                    onChange={e => updateStatus(item.id, e.target.value as FeedbackItem["status"])}
                    style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, border: "1px solid #e5e7eb", background: ss.bg, color: ss.color, cursor: "pointer" }}>
                    <option value="未対応">⬜ 未対応</option>
                    <option value="対応中">🟡 対応中</option>
                    <option value="完了">✅ 完了</option>
                  </select>
                  {/* ページ */}
                  <Link href={item.page} style={{ fontSize: 11, color: "#2563eb", fontFamily: "monospace", textDecoration: "none", background: "#eff6ff", padding: "2px 8px", borderRadius: 4 }}>
                    {item.page}
                  </Link>
                  {/* 日時 */}
                  <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: "auto" }}>
                    {new Date(item.timestamp).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                {/* 内容 */}
                <div style={{ fontSize: 14, color: "#111827", lineHeight: 1.6, marginBottom: 12, whiteSpace: "pre-wrap" }}>
                  {item.content}
                </div>
                {/* アクション */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => copyForClaudeCode(item)}
                    style={{
                      padding: "7px 14px", borderRadius: 8,
                      border: isCopied ? "1px solid #86efac" : "1px solid #c4b5fd",
                      background: isCopied ? "#d1fae5" : "#f5f3ff",
                      color: isCopied ? "#059669" : "#7c3aed",
                      fontSize: 12, fontWeight: 700, cursor: "pointer",
                    }}>
                    {isCopied ? "✅ コピー済み！貼り付けてください" : "📋 Claude Code用コピー"}
                  </button>
                  <button onClick={() => deleteItem(item.id)}
                    style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #fca5a5", background: "#fff5f5", color: "#dc2626", fontSize: 12, cursor: "pointer" }}>
                    🗑
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Claude Code への貼り付けガイド */}
      {filtered.some(i => i.status !== "完了") && (
        <div style={{ marginTop: 24, background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: 12, padding: "14px 18px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#7c3aed", marginBottom: 8 }}>📌 Claude Code への送り方</div>
          <ol style={{ fontSize: 12, color: "#4c1d95", lineHeight: 2, margin: 0, paddingLeft: 20 }}>
            <li>修正したい項目の「📋 Claude Code用コピー」をクリック</li>
            <li>Claude Code のチャット欄にそのまま貼り付け（Ctrl+V）して送信</li>
            <li>修正が完了したら、この一覧でステータスを「✅ 完了」に変更</li>
          </ol>
        </div>
      )}
    </div>
  )
}
