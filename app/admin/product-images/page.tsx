"use client"

import { useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"

type Stats = {
  total: number
  withImage: number
  noImage: number
}

export default function ProductImagesPage() {
  const [stats, setStats]           = useState<Stats | null>(null)
  const [running, setRunning]       = useState(false)
  const [done, setDone]             = useState(false)
  const [offset, setOffset]         = useState(0)
  const [processed, setProcessed]   = useState(0)
  const [found, setFound]           = useState(0)
  const [log, setLog]               = useState<string[]>([])
  const [error, setError]           = useState<string | null>(null)
  const stopRef = useRef(false)
  const logRef  = useRef<HTMLDivElement>(null)

  useEffect(() => { fetchStats() }, [])

  async function fetchStats() {
    const { count: total }     = await supabase.from("products").select("*", { count: "exact", head: true })
    const { count: withImage } = await supabase.from("products").select("*", { count: "exact", head: true }).not("image_url", "is", null).neq("image_url", "")
    const { count: noImage }   = await supabase.from("products").select("*", { count: "exact", head: true }).or("image_url.is.null,image_url.eq.")
    setStats({ total: total ?? 0, withImage: withImage ?? 0, noImage: noImage ?? 0 })
  }

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }

  function addLog(msg: string) {
    setLog((prev) => [...prev.slice(-200), msg])
    setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 50)
  }

  async function startFetch() {
    const token = await getToken()
    if (!token) { setError("セッションが切れています。再ログインしてください。"); return }
    stopRef.current = false
    setRunning(true)
    setDone(false)
    setError(null)
    setOffset(0)
    setProcessed(0)
    setFound(0)
    setLog([])
    addLog("🚀 画像取得を開始します…")
    await runBatch(0, token, 0, 0)
  }

  async function runBatch(currentOffset: number, token: string, totalProcessed: number, totalFound: number) {
    if (stopRef.current) {
      addLog("⏹ 停止しました")
      setRunning(false)
      await fetchStats()
      return
    }

    try {
      const res = await fetch("/api/admin/fetch-images", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ offset: currentOffset }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error || "APIエラー"); setRunning(false); return }

      const newProcessed = totalProcessed + (json.processed ?? 0)
      const newFound     = totalFound     + (json.found ?? 0)
      setProcessed(newProcessed)
      setFound(newFound)
      setOffset(currentOffset + (json.processed ?? 0))

      addLog(`✓ ${newProcessed}件処理済み（画像あり：${newFound}件、残り：${json.remaining ?? 0}件）`)

      if (json.done || (json.processed ?? 0) === 0) {
        addLog("🎉 完了しました！")
        setDone(true)
        setRunning(false)
        await fetchStats()
        return
      }

      await runBatch(currentOffset + (json.processed ?? 0), token, newProcessed, newFound)
    } catch (e: any) {
      setError(e.message || "ネットワークエラー")
      setRunning(false)
    }
  }

  function stop() {
    stopRef.current = true
  }

  async function resetImages() {
    if (!window.confirm("取得した画像URLをすべてリセットしますか？（やり直し用）")) return
    await supabase.from("products").update({ image_url: null }).not("image_url", "is", null)
    await fetchStats()
    setProcessed(0); setFound(0); setDone(false); setLog([])
  }

  const pct = stats ? Math.round((stats.withImage / Math.max(stats.total, 1)) * 100) : 0

  return (
    <div style={{ maxWidth: 680 }}>
      <h1 style={{ fontSize: 20, fontWeight: "bold", marginBottom: 4, color: "#111" }}>
        🖼 商品画像 一括取得
      </h1>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24 }}>
        楽天商品検索APIで商品名を検索し、画像URLを自動で取得します。
        3,000件の場合、完了まで約50分かかります。
      </p>

      {/* 統計 */}
      {stats && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: "18px 20px", marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 24, marginBottom: 14 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: "bold", color: "#111" }}>{stats.total.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>総商品数</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: "bold", color: "#22a648" }}>{stats.withImage.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>画像あり</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: "bold", color: "#9ca3af" }}>{stats.noImage.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>未取得</div>
            </div>
          </div>
          {/* プログレスバー */}
          <div style={{ background: "#f3f4f6", borderRadius: 999, height: 10, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "#22a648", borderRadius: 999, transition: "width 0.5s" }} />
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6, textAlign: "right" }}>{pct}% 完了</div>
        </div>
      )}

      {/* 実行中プログレス */}
      {running && (
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: "bold", color: "#166534" }}>
              取得中… {processed}件処理 / 画像発見：{found}件
            </span>
            <button onClick={stop} style={{
              padding: "5px 14px", borderRadius: 7, border: "1px solid #fca5a5",
              background: "#fff", color: "#ef4444", fontSize: 12, fontWeight: "bold", cursor: "pointer",
            }}>⏹ 停止</button>
          </div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            ※ ページを閉じると停止します。バックグラウンドで動いているため、タブを開いたままにしてください。
          </div>
        </div>
      )}

      {done && (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
          <span style={{ fontSize: 15, fontWeight: "bold", color: "#166534" }}>
            🎉 完了！ {found}件の画像を取得しました
          </span>
        </div>
      )}

      {error && (
        <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#b91c1c" }}>
          ⚠ {error}
        </div>
      )}

      {/* ボタン */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <button onClick={startFetch} disabled={running}
          style={{
            flex: 1, padding: "13px 0", borderRadius: 10, border: "none",
            background: running ? "#d1d5db" : "#22a648", color: "#fff",
            fontSize: 15, fontWeight: "bold", cursor: running ? "not-allowed" : "pointer",
          }}>
          {running ? "取得中…" : done ? "🔄 再取得（未取得分のみ）" : "🚀 一括取得開始"}
        </button>
        <button onClick={fetchStats}
          style={{ padding: "13px 18px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", fontSize: 13, cursor: "pointer", color: "#374151" }}>
          更新
        </button>
      </div>

      {/* ログ */}
      {log.length > 0 && (
        <div ref={logRef} style={{
          background: "#111", borderRadius: 10, padding: "12px 14px",
          maxHeight: 220, overflowY: "auto", fontFamily: "monospace", fontSize: 12,
        }}>
          {log.map((l, i) => (
            <div key={i} style={{ color: l.startsWith("⚠") ? "#fca5a5" : l.startsWith("🎉") ? "#86efac" : "#d1fae5", marginBottom: 2 }}>{l}</div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <button onClick={resetImages} style={{
          fontSize: 12, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", textDecoration: "underline",
        }}>
          取得結果をリセット（やり直す場合）
        </button>
      </div>
    </div>
  )
}
