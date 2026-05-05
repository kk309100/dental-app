"use client"

import { useEffect, useState } from "react"

const KEY = "dental-app:user_name"

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
      className="text-xs text-gray-500 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-100"
      title="クリックして変更"
    >
      👤 {name || "(操作者未設定)"}
    </button>
  )
}
