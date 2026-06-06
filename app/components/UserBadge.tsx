"use client"

import { useEffect, useState } from "react"

const KEY = "denthub:user_name"

/**
 * 監査ログ・各種記録の actor として使う「操作者名」を localStorage に保存する小さい設定UI。
 * Supabase Auth が完全統合されるまでの暫定実装。ヘッダの右上に表示。
 */
export default function UserBadge() {
  const [name, setName] = useState("")
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")

  useEffect(() => {
    if (typeof window === "undefined") return
    const stored = localStorage.getItem(KEY) || ""
    setName(stored)
  }, [])

  function save() {
    const v = draft.trim()
    if (typeof window !== "undefined") {
      if (v) localStorage.setItem(KEY, v)
      else localStorage.removeItem(KEY)
    }
    setName(v)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") save() }}
          placeholder="氏名"
          className="px-2 py-1 border border-gray-300 rounded text-xs w-28"
        />
        <button onClick={save} className="text-xs px-2 py-1 bg-emerald-600 text-white rounded">OK</button>
        <button onClick={() => setEditing(false)} className="text-xs text-gray-400">×</button>
      </div>
    )
  }

  return (
    <button
      onClick={() => { setDraft(name); setEditing(true) }}
      className="text-xs px-2 py-1 rounded"
      style={{ color: "#bfdbfe", background: "transparent" }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.15)"; (e.currentTarget as HTMLButtonElement).style.color = "#fff" }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "#bfdbfe" }}
      title="クリックして変更"
    >
      👤 {name || "(操作者未設定)"}
    </button>
  )
}
