"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

type Notice = {
  id: string
  title: string
  body: string | null
  is_active: boolean
  created_at: string
}

export default function NoticesPage() {
  const [notices, setNotices] = useState<Notice[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchNotices() }, [])

  async function fetchNotices() {
    const { data } = await supabase.from("notices").select("*").order("created_at", { ascending: false })
    setNotices(data || [])
    setLoading(false)
  }

  async function addNotice() {
    if (!title.trim()) return
    setSaving(true)
    await supabase.from("notices").insert([{ title: title.trim(), body: body.trim() || null, is_active: true }])
    setTitle(""); setBody("")
    await fetchNotices()
    setSaving(false)
  }

  async function toggleActive(notice: Notice) {
    await supabase.from("notices").update({ is_active: !notice.is_active }).eq("id", notice.id)
    setNotices((prev) => prev.map((n) => n.id === notice.id ? { ...n, is_active: !n.is_active } : n))
  }

  async function deleteNotice(id: string) {
    if (!confirm("このお知らせを削除しますか？")) return
    await supabase.from("notices").delete().eq("id", id)
    setNotices((prev) => prev.filter((n) => n.id !== id))
  }

  function fmtDate(str: string) {
    const d = new Date(str)
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <h1 style={{ fontSize: 20, fontWeight: "bold", marginBottom: 24, color: "#111" }}>📢 お知らせ管理</h1>

      {/* 新規作成フォーム */}
      <div style={{ background: "#fff", borderRadius: 14, padding: 20, marginBottom: 28, border: "1px solid #e5e7eb", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
        <h2 style={{ fontSize: 15, fontWeight: "bold", marginBottom: 14, color: "#333" }}>新しいお知らせを投稿</h2>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="タイトル（必須）"
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, marginBottom: 10, boxSizing: "border-box" as const }}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="本文（任意）"
          rows={3}
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, marginBottom: 14, boxSizing: "border-box" as const, resize: "vertical" }}
        />
        <button onClick={addNotice} disabled={saving || !title.trim()} style={{
          padding: "10px 24px", borderRadius: 8, border: "none",
          background: saving || !title.trim() ? "#ccc" : "#22a648",
          color: "#fff", fontWeight: "bold", fontSize: 14, cursor: saving || !title.trim() ? "not-allowed" : "pointer",
        }}>
          {saving ? "投稿中…" : "投稿する"}
        </button>
      </div>

      {/* お知らせ一覧 */}
      <h2 style={{ fontSize: 15, fontWeight: "bold", marginBottom: 12, color: "#333" }}>投稿済み一覧</h2>
      {loading ? (
        <p style={{ color: "#999", fontSize: 14 }}>読み込み中…</p>
      ) : notices.length === 0 ? (
        <p style={{ color: "#aaa", fontSize: 14 }}>お知らせはまだありません</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {notices.map((n) => (
            <div key={n.id} style={{
              background: "#fff", borderRadius: 12, padding: "14px 16px",
              border: `1px solid ${n.is_active ? "#b2dfbd" : "#e5e7eb"}`,
              borderLeft: `4px solid ${n.is_active ? "#22a648" : "#d1d5db"}`,
              opacity: n.is_active ? 1 : 0.6,
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{
                      fontSize: 11, fontWeight: "bold", padding: "2px 8px", borderRadius: 999,
                      background: n.is_active ? "#e8f5ec" : "#f3f4f6",
                      color: n.is_active ? "#22a648" : "#9ca3af",
                    }}>
                      {n.is_active ? "表示中" : "非表示"}
                    </span>
                    <span style={{ fontSize: 11, color: "#9ca3af" }}>{fmtDate(n.created_at)}</span>
                  </div>
                  <p style={{ margin: 0, fontWeight: "bold", fontSize: 14, color: "#111" }}>{n.title}</p>
                  {n.body && <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280", lineHeight: 1.6 }}>{n.body}</p>}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button onClick={() => toggleActive(n)} style={{
                    padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: "bold", cursor: "pointer",
                    border: "1px solid #e5e7eb", background: "#fff",
                    color: n.is_active ? "#f08c00" : "#22a648",
                  }}>
                    {n.is_active ? "非表示" : "表示"}
                  </button>
                  <button onClick={() => deleteNotice(n.id)} style={{
                    padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: "bold", cursor: "pointer",
                    border: "1px solid #fca5a5", background: "#fff7f7", color: "#ef4444",
                  }}>
                    削除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
