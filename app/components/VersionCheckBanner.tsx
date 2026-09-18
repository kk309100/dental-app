"use client"

// タブを開きっぱなしのPCが、新しいデプロイに気づけるようにするバナー。
// 起動時のバージョンと定期チェックの結果がずれたら「更新してください」と表示する。

import { useEffect, useRef, useState } from "react"

const CHECK_INTERVAL_MS = 10 * 60 * 1000 // 10分ごと

export default function VersionCheckBanner() {
  const [outdated, setOutdated] = useState(false)
  const initialVersion = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchVersion(): Promise<string | null> {
      try {
        const res = await fetch("/api/version", { cache: "no-store" })
        if (!res.ok) return null
        const data = await res.json()
        return data.version || null
      } catch {
        return null
      }
    }

    async function check() {
      const v = await fetchVersion()
      if (cancelled || !v) return
      if (initialVersion.current === null) {
        initialVersion.current = v
        return
      }
      if (v !== initialVersion.current) setOutdated(true)
    }

    check()
    const timer = setInterval(check, CHECK_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])

  if (!outdated) return null

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
      background: "#111827", color: "#fff",
      padding: "10px 16px",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
      fontSize: 13, flexWrap: "wrap",
    }}>
      <span>🔄 新しいバージョンがあります。更新すると最新の状態になります。</span>
      <button
        onClick={() => window.location.reload()}
        style={{
          background: "#2563eb", color: "#fff", border: "none",
          padding: "5px 14px", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer",
        }}>
        今すぐ更新
      </button>
    </div>
  )
}
