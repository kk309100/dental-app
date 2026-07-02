"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { supabase } from "@/lib/supabase"

// ── 型 ───────────────────────────────────────────────
type Product = { id: string; name: string; manufacturer: string | null; image_url: string | null }
type Stats   = { total: number; withImage: number; noImage: number }
type Mode    = "manual" | "edit" | "csv" | "auto"

// ── 定数 ─────────────────────────────────────────────
const PAGE = 50   // 手動モードで一度に取得する件数バッファ

export default function ProductImagesPage() {
  const [mode, setMode]         = useState<Mode>("manual")
  const [stats, setStats]       = useState<Stats | null>(null)

  // 手動モード
  const [products, setProducts] = useState<Product[]>([])
  const [idx, setIdx]           = useState(0)
  const [urlInput, setUrlInput] = useState("")
  const [preview, setPreview]   = useState("")
  const [saving, setSaving]     = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [manualSearchInput, setManualSearchInput] = useState("")
  const [manualUploading, setManualUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // CSV インポートモード
  const [csvText, setCsvText]   = useState("")
  const [csvResult, setCsvResult] = useState<string | null>(null)
  const [csvRunning, setCsvRunning] = useState(false)

  // 編集・削除モード
  const [editSearch, setEditSearch]     = useState("")
  const [editProducts, setEditProducts] = useState<Product[]>([])
  const [editLoading, setEditLoading]   = useState(false)
  const [editId, setEditId]             = useState<string | null>(null)
  const [editUrl, setEditUrl]           = useState("")
  const [editSaving, setEditSaving]     = useState(false)
  const [editMsg, setEditMsg]           = useState<{ id: string; msg: string } | null>(null)
  const [uploading, setUploading]       = useState(false)

  // 自動取得モード（楽天）
  const [running, setRunning]   = useState(false)
  const [done, setDone]         = useState(false)
  const [processed, setProcessed] = useState(0)
  const [found, setFound]       = useState(0)
  const [log, setLog]           = useState<string[]>([])
  const [autoError, setAutoError] = useState<string | null>(null)
  const stopRef = useRef(false)
  const logRef  = useRef<HTMLDivElement>(null)

  useEffect(() => { fetchStats() }, [])

  // 手動モードに切り替えたとき商品を読み込む
  useEffect(() => {
    if (mode === "manual" && products.length === 0) loadProducts()
  }, [mode])

  // URLが変わったらプレビュー更新
  useEffect(() => {
    const trimmed = urlInput.trim()
    if (trimmed.startsWith("http")) setPreview(trimmed)
    else setPreview("")
  }, [urlInput])

  // 手動モード：商品読み込み時にinputにフォーカス
  useEffect(() => {
    if (mode === "manual") inputRef.current?.focus()
  }, [idx, mode])

  // ── データ取得 ──────────────────────────────────────
  async function fetchStats() {
    const [r1, r2, r3] = await Promise.all([
      supabase.from("products").select("*", { count: "exact", head: true }),
      supabase.from("products").select("*", { count: "exact", head: true }).not("image_url", "is", null).neq("image_url", ""),
      supabase.from("products").select("*", { count: "exact", head: true }).or("image_url.is.null,image_url.eq."),
    ])
    setStats({ total: r1.count ?? 0, withImage: r2.count ?? 0, noImage: r3.count ?? 0 })
  }

  async function loadProducts(offset = 0) {
    setLoadingProducts(true)
    const { data } = await supabase
      .from("products")
      .select("id, name, manufacturer, image_url")
      .or("image_url.is.null,image_url.eq.")
      .order("manufacturer", { ascending: true })
      .order("name", { ascending: true })
      .range(offset, offset + PAGE - 1)
    setProducts(data ?? [])
    setIdx(0)
    setUrlInput("")
    setManualSearchInput("")
    setLoadingProducts(false)
  }

  async function searchManualProducts(q: string) {
    if (!q.trim()) { loadProducts(); return }
    setLoadingProducts(true)
    // 画像未登録商品を名前で検索（全商品対象）
    const { data } = await supabase
      .from("products")
      .select("id, name, manufacturer, image_url")
      .ilike("name", `%${q.trim()}%`)
      .order("manufacturer", { ascending: true })
      .order("name", { ascending: true })
      .limit(100)
    setProducts(data ?? [])
    setIdx(0)
    setUrlInput("")
    setLoadingProducts(false)
  }

  async function uploadManualImageFile(file: File) {
    if (!currentProduct) return
    setManualUploading(true)
    try {
      let jpeg: Blob
      try { jpeg = await fileToJpeg(file) }
      catch (e) { alert(`画像変換失敗: ${(e as Error).message}`); return }
      const form = new FormData()
      form.append("file", jpeg, `${currentProduct.id}.jpg`)
      form.append("productId", currentProduct.id)
      const res  = await fetch("/api/admin/upload-product-image", { method: "POST", body: form })
      const json = await res.json()
      if (!res.ok) { alert(`アップロード失敗: ${json.error ?? res.statusText}`); return }
      await supabase.from("products").update({ image_url: json.publicUrl }).eq("id", currentProduct.id)
      setSavedCount(c => c + 1)
      nextProduct()
      fetchStats()
    } finally {
      setManualUploading(false)
    }
  }

  // ── 手動モード操作 ──────────────────────────────────
  const currentProduct = products[idx] ?? null

  async function saveImage(url: string) {
    if (!currentProduct || !url.trim()) return
    setSaving(true)
    await supabase.from("products").update({ image_url: url.trim() }).eq("id", currentProduct.id)
    setSavedCount(c => c + 1)
    setSaving(false)
    nextProduct()
    fetchStats()
  }

  function skipProduct() {
    nextProduct()
  }

  function prevProduct() {
    setIdx(i => Math.max(0, i - 1))
    setUrlInput("")
  }

  function nextProduct() {
    if (idx < products.length - 1) {
      setIdx(i => i + 1)
      setUrlInput("")
    } else {
      // 次バッチ読み込み
      loadProducts()
    }
  }

  function openGoogleImages() {
    if (!currentProduct) return
    const q = [currentProduct.manufacturer, currentProduct.name].filter(Boolean).join(" ")
    window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`, "_blank")
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && preview)  { e.preventDefault(); saveImage(preview) }
    if (e.key === "Escape")            { setUrlInput(""); inputRef.current?.focus() }
  }

  // ── CSV インポート ──────────────────────────────────
  async function runCsvImport() {
    const lines = csvText.trim().split("\n").filter(l => l.trim())
    if (lines.length === 0) return
    setCsvRunning(true)
    setCsvResult(null)
    let ok = 0; let ng = 0
    for (const line of lines) {
      const cols = line.split(",")
      const id  = cols[0]?.trim()
      const url = cols.slice(1).join(",").trim().replace(/^"|"$/g, "")
      if (!id || !url) { ng++; continue }
      const { error } = await supabase.from("products").update({ image_url: url }).eq("id", id)
      if (error) ng++; else ok++
    }
    setCsvRunning(false)
    setCsvResult(`✅ 成功: ${ok}件　❌ 失敗: ${ng}件`)
    fetchStats()
  }

  // ── 編集・削除モード ────────────────────────────────
  async function loadEditProducts(q: string) {
    setEditLoading(true)
    setEditId(null)
    let query = supabase
      .from("products")
      .select("id, name, manufacturer, image_url")
      .order("manufacturer", { ascending: true })
      .order("name", { ascending: true })
    if (q.trim()) {
      query = query.ilike("name", `%${q.trim()}%`)
    } else {
      query = query.limit(200)
    }
    const { data } = await query
    setEditProducts(data ?? [])
    setEditLoading(false)
  }

  useEffect(() => {
    if (mode === "edit") loadEditProducts(editSearch)
  }, [mode])

  // 画像ファイルをcanvas経由でJPEGに変換（HEIC・大容量対応）
  function fileToJpeg(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        const MAX = 1600
        let w = img.naturalWidth, h = img.naturalHeight
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX }
          else       { w = Math.round(w * MAX / h); h = MAX }
        }
        const canvas = document.createElement("canvas")
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext("2d")
        if (!ctx) { URL.revokeObjectURL(url); reject(new Error("canvas取得失敗")); return }
        ctx.fillStyle = "#ffffff"
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        URL.revokeObjectURL(url)
        canvas.toBlob(blob => {
          if (blob) resolve(blob)
          else reject(new Error("JPEG変換失敗"))
        }, "image/jpeg", 0.85)
      }
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("画像読み込み失敗")) }
      img.src = url
    })
  }

  async function uploadImageFile(id: string, file: File) {
    setUploading(true)
    try {
      // canvas で JPEG 変換（HEIC・PNG・WebP など全形式対応）
      let jpeg: Blob
      try {
        jpeg = await fileToJpeg(file)
      } catch (convErr) {
        alert(`画像変換失敗: ${(convErr as Error).message}`)
        return
      }

      // サービスロールAPIルート経由でアップロード（クライアントキーのRLS制限を回避）
      const form = new FormData()
      form.append("file", jpeg, `${id}.jpg`)
      form.append("productId", id)

      const res = await fetch("/api/admin/upload-product-image", { method: "POST", body: form })
      const json = await res.json()
      if (!res.ok) { alert(`アップロード失敗: ${json.error ?? res.statusText}`); return }

      await saveEditUrl(id, json.publicUrl)
    } finally {
      setUploading(false)
    }
  }

  async function saveEditUrl(id: string, url: string) {
    setEditSaving(true)
    await supabase.from("products").update({ image_url: url.trim() || null }).eq("id", id)
    setEditId(null)
    setEditMsg({ id, msg: "✅ 保存しました" })
    setTimeout(() => setEditMsg(null), 2000)
    setEditSaving(false)
    await loadEditProducts(editSearch)
    fetchStats()
  }

  async function clearImage(id: string) {
    if (!window.confirm("この商品の画像を削除しますか？")) return
    await supabase.from("products").update({ image_url: null }).eq("id", id)
    setEditMsg({ id, msg: "🗑 削除しました" })
    setTimeout(() => setEditMsg(null), 2000)
    await loadEditProducts(editSearch)
    fetchStats()
  }

  // ── 自動取得（楽天） ────────────────────────────────
  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }
  function addLog(msg: string) {
    setLog(prev => [...prev.slice(-200), msg])
    setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 50)
  }
  async function startFetch() {
    const token = await getToken()
    if (!token) { setAutoError("セッションが切れています。再ログインしてください。"); return }
    stopRef.current = false
    setRunning(true); setDone(false); setAutoError(null)
    setProcessed(0); setFound(0); setLog([])
    addLog("🚀 画像取得を開始します…")
    await runBatch(0, token, 0, 0)
  }
  async function runBatch(cur: number, token: string, tp: number, tf: number) {
    if (stopRef.current) { addLog("⏹ 停止しました"); setRunning(false); await fetchStats(); return }
    try {
      const res  = await fetch("/api/admin/fetch-images", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ offset: cur }),
      })
      const json = await res.json()
      if (!res.ok) { setAutoError(json.error || "APIエラー"); setRunning(false); return }
      const np = tp + (json.processed ?? 0); const nf = tf + (json.found ?? 0)
      setProcessed(np); setFound(nf)
      addLog(`✓ ${np}件処理済み（画像あり：${nf}件、残り：${json.remaining ?? 0}件）`)
      if (json.done || (json.processed ?? 0) === 0) {
        addLog("🎉 完了しました！"); setDone(true); setRunning(false); await fetchStats(); return
      }
      await runBatch(cur + (json.processed ?? 0), token, np, nf)
    } catch (e: any) { setAutoError(e.message || "ネットワークエラー"); setRunning(false) }
  }

  // ── 統計 ─────────────────────────────────────────────
  const pct = stats ? Math.round((stats.withImage / Math.max(stats.total, 1)) * 100) : 0

  // ── UI ───────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 740 }}>

      {/* タイトル */}
      <h1 style={{ fontSize: 20, fontWeight: "bold", marginBottom: 16, color: "#111" }}>🖼 商品画像 管理</h1>

      {/* 統計 */}
      {stats && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: "16px 20px", marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 28, marginBottom: 12 }}>
            {[
              { label: "総商品数",  val: stats.total,     color: "#111" },
              { label: "画像あり",  val: stats.withImage, color: "#059669" },
              { label: "未登録",    val: stats.noImage,   color: "#dc2626" },
            ].map(s => (
              <div key={s.label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 26, fontWeight: "bold", color: s.color }}>{s.val.toLocaleString()}</div>
                <div style={{ fontSize: 11, color: "#6b7280" }}>{s.label}</div>
              </div>
            ))}
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              <div style={{ fontSize: 26, fontWeight: "bold", color: "#2563eb" }}>{pct}%</div>
              <div style={{ fontSize: 11, color: "#6b7280" }}>完了率</div>
            </div>
          </div>
          <div style={{ background: "#f3f4f6", borderRadius: 999, height: 8, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "#059669", borderRadius: 999, transition: "width 0.5s" }} />
          </div>
        </div>
      )}

      {/* タブ */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "2px solid #e5e7eb", flexWrap: "wrap" }}>
        {([
          { key: "manual", label: "✋ 手動登録" },
          { key: "edit",   label: "✏️ 編集・削除" },
          { key: "csv",    label: "📄 CSVインポート" },
          { key: "auto",   label: "🤖 自動取得（楽天）" },
        ] as { key: Mode; label: string }[]).map(t => (
          <button key={t.key} onClick={() => setMode(t.key)} style={{
            padding: "8px 18px", border: "none", borderRadius: "8px 8px 0 0",
            background: mode === t.key ? "#2563eb" : "transparent",
            color: mode === t.key ? "#fff" : "#6b7280",
            fontWeight: mode === t.key ? 700 : 400,
            fontSize: 13, cursor: "pointer",
            borderBottom: mode === t.key ? "2px solid #2563eb" : "none",
            marginBottom: -2,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ══ 手動登録 ══════════════════════════════════════ */}
      {mode === "manual" && (
        <div>
          {/* 商品名検索 */}
          <form onSubmit={e => { e.preventDefault(); searchManualProducts(manualSearchInput) }}
            style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input
              value={manualSearchInput}
              onChange={e => setManualSearchInput(e.target.value)}
              placeholder="商品名で検索…"
              style={{ flex: 1, padding: "9px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13, outline: "none" }}
            />
            <button type="submit"
              style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              検索
            </button>
            {manualSearchInput && (
              <button type="button" onClick={() => { setManualSearchInput(""); loadProducts() }}
                style={{ padding: "9px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontSize: 13, cursor: "pointer", color: "#6b7280" }}>
                クリア
              </button>
            )}
          </form>

          {loadingProducts ? (
            <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>読み込み中…</div>
          ) : products.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, background: "#f0fdf4", borderRadius: 14, color: "#059669", fontWeight: "bold" }}>
              {manualSearchInput ? `「${manualSearchInput}」に一致する商品がありません` : "🎉 未登録商品はありません！"}
            </div>
          ) : (
            <>
              {/* 進捗バー */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ fontSize: 13, color: "#6b7280", whiteSpace: "nowrap" }}>
                  {idx + 1} / {products.length} 件表示中
                </div>
                <div style={{ flex: 1, background: "#f3f4f6", borderRadius: 999, height: 6 }}>
                  <div style={{ width: `${((idx + 1) / products.length) * 100}%`, height: "100%", background: "#2563eb", borderRadius: 999, transition: "width 0.2s" }} />
                </div>
                {savedCount > 0 && (
                  <div style={{ fontSize: 12, color: "#059669", whiteSpace: "nowrap" }}>✅ {savedCount}件保存済み</div>
                )}
              </div>

              {/* 商品カード */}
              {currentProduct && (
                <div style={{ background: "#fff", border: "2px solid #dbeafe", borderRadius: 16, padding: 20, marginBottom: 16 }}>

                  {/* メーカー + 商品名 */}
                  <div style={{ marginBottom: 14 }}>
                    {currentProduct.manufacturer && (
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#2563eb", background: "#eff6ff", display: "inline-block", padding: "2px 10px", borderRadius: 999, marginBottom: 6 }}>
                        {currentProduct.manufacturer}
                      </div>
                    )}
                    <div style={{ fontSize: 17, fontWeight: "bold", color: "#111", lineHeight: 1.4 }}>
                      {currentProduct.name}
                    </div>
                    <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4, fontFamily: "monospace" }}>
                      ID: {currentProduct.id}
                    </div>
                  </div>

                  {/* Google画像検索ボタン */}
                  <button onClick={openGoogleImages} style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "8px 16px", borderRadius: 8, border: "1px solid #e5e7eb",
                    background: "#f9fafb", color: "#374151", fontSize: 13, cursor: "pointer",
                    fontWeight: 600, marginBottom: 16, width: "100%", justifyContent: "center",
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="#4b5563" strokeWidth="2"/><path d="m21 21-4.35-4.35" stroke="#4b5563" strokeWidth="2" strokeLinecap="round"/></svg>
                    Google画像検索で調べる（新タブ）
                  </button>

                  {/* ファイルアップロード */}
                  <label style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    padding: "9px 16px", borderRadius: 8, border: "2px dashed #2563eb",
                    background: "#eff6ff", color: "#2563eb", fontSize: 13, fontWeight: 700,
                    cursor: manualUploading ? "wait" : "pointer", marginBottom: 12,
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    {manualUploading ? "アップロード中…" : "📷 写真ファイルをアップロード（JPG・PNG・HEIC対応）"}
                    <input type="file" accept="image/*" style={{ display: "none" }} disabled={manualUploading}
                      onChange={e => { const f = e.target.files?.[0]; if (f) uploadManualImageFile(f); e.target.value = "" }}
                    />
                  </label>

                  {/* URL入力 */}
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                      または 画像URL を貼り付け
                      <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 6 }}>（画像を右クリック →「画像アドレスをコピー」）</span>
                    </label>
                    <input
                      ref={inputRef}
                      value={urlInput}
                      onChange={e => setUrlInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="https://..."
                      style={{
                        width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: 8,
                        fontSize: 13, outline: "none", boxSizing: "border-box",
                        borderColor: preview ? "#2563eb" : "#e5e7eb",
                      }}
                    />
                  </div>

                  {/* プレビュー */}
                  {preview && (
                    <div style={{ marginBottom: 14, textAlign: "center" }}>
                      <img
                        src={preview}
                        alt="preview"
                        onError={() => setPreview("")}
                        style={{ maxHeight: 160, maxWidth: "100%", borderRadius: 8, border: "1px solid #e5e7eb", objectFit: "contain" }}
                      />
                    </div>
                  )}

                  {/* ボタン群 */}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={prevProduct} disabled={idx === 0}
                      style={{ padding: "9px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontSize: 13, cursor: idx === 0 ? "not-allowed" : "pointer", color: "#6b7280" }}>
                      ← 戻る
                    </button>
                    <button onClick={skipProduct}
                      style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontSize: 13, cursor: "pointer", color: "#6b7280", fontWeight: 600 }}>
                      スキップ →
                    </button>
                    <button onClick={() => saveImage(preview)} disabled={!preview || saving}
                      style={{
                        flex: 1, padding: "9px 16px", borderRadius: 8, border: "none",
                        background: preview && !saving ? "#2563eb" : "#d1d5db",
                        color: "#fff", fontSize: 14, fontWeight: "bold",
                        cursor: preview && !saving ? "pointer" : "not-allowed",
                      }}>
                      {saving ? "保存中…" : "✅ 保存して次へ（Enter）"}
                    </button>
                  </div>
                </div>
              )}

              {/* キーボードショートカットヒント */}
              <div style={{ fontSize: 11, color: "#9ca3af", textAlign: "center" }}>
                💡 Enter = 保存して次へ　／　Esc = URLをクリア
              </div>
            </>
          )}
        </div>
      )}

      {/* ══ 編集・削除 ════════════════════════════════════ */}
      {mode === "edit" && (
        <div>
          {/* 検索 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input
              value={editSearch}
              onChange={e => setEditSearch(e.target.value)}
              onKeyDown={e => e.key === "Enter" && loadEditProducts(editSearch)}
              placeholder="商品名で検索…"
              style={{ flex: 1, padding: "9px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13, outline: "none" }}
            />
            <button
              onClick={() => loadEditProducts(editSearch)}
              style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
            >
              検索
            </button>
          </div>

          {editLoading ? (
            <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>読み込み中…</div>
          ) : editProducts.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, background: "#f9fafb", borderRadius: 12, color: "#6b7280" }}>
              {editSearch ? `「${editSearch}」に一致する画像登録済み商品がありません` : "画像登録済み商品がありません"}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
                {editProducts.length}件表示{editSearch ? "" : "（初期表示は最大200件）"}— 商品名で絞り込むと全件検索
              </div>
              {editProducts.map(p => (
                <div key={p.id} style={{
                  background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
                  padding: "12px 14px", display: "flex", alignItems: "center", gap: 12,
                }}>
                  {/* サムネイル */}
                  <div style={{ width: 60, height: 60, flexShrink: 0, background: "#f3f4f6", borderRadius: 8, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {p.image_url ? (
                      <img src={p.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }}
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none" }} />
                    ) : (
                      <span style={{ fontSize: 20, color: "#d1d5db" }}>🖼</span>
                    )}
                  </div>

                  {/* 商品情報 */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {p.manufacturer && (
                      <div style={{ fontSize: 10, color: "#2563eb", fontWeight: 700, marginBottom: 2 }}>{p.manufacturer}</div>
                    )}
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#111", marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.name}
                    </div>

                    {/* 編集中 */}
                    {editId === p.id ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            autoFocus
                            defaultValue={p.image_url ?? ""}
                            onChange={e => setEditUrl(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") saveEditUrl(p.id, editUrl || (e.target as HTMLInputElement).value); if (e.key === "Escape") setEditId(null) }}
                            placeholder="https://... またはURLを貼り付け"
                            style={{ flex: 1, padding: "6px 10px", border: "2px solid #2563eb", borderRadius: 6, fontSize: 12, outline: "none" }}
                          />
                          <button
                            onClick={e => saveEditUrl(p.id, (e.currentTarget.parentElement?.querySelector("input") as HTMLInputElement)?.value ?? editUrl)}
                            disabled={editSaving || uploading}
                            style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
                          >
                            {editSaving ? "保存中" : "保存"}
                          </button>
                          <button onClick={() => setEditId(null)}
                            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", fontSize: 12, cursor: "pointer", color: "#6b7280" }}>
                            ✕
                          </button>
                        </div>
                        {/* ファイルアップロード */}
                        <label style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          padding: "5px 12px", borderRadius: 6, border: "1px dashed #2563eb",
                          background: "#eff6ff", color: "#2563eb", fontSize: 11, fontWeight: 600,
                          cursor: uploading ? "wait" : "pointer", width: "fit-content",
                        }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          {uploading ? "アップロード中…" : "📷 写真ファイルをアップロード"}
                          <input type="file" accept="image/*" style={{ display: "none" }}
                            disabled={uploading}
                            onChange={e => { const f = e.target.files?.[0]; if (f) uploadImageFile(p.id, f); e.target.value = "" }}
                          />
                        </label>
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: "#9ca3af", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {editMsg?.id === p.id ? (
                          <span style={{ color: "#059669", fontWeight: 700 }}>{editMsg.msg}</span>
                        ) : (
                          p.image_url
                        )}
                      </div>
                    )}
                  </div>

                  {/* 操作ボタン（編集中でなければ表示） */}
                  {editId !== p.id && (
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => { setEditId(p.id); setEditUrl(p.image_url ?? "") }}
                        style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid #e5e7eb", background: "#f9fafb", fontSize: 12, cursor: "pointer", color: "#374151", fontWeight: 600 }}
                      >
                        ✏️ 変更
                      </button>
                      <button
                        onClick={() => clearImage(p.id)}
                        style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid #fecaca", background: "#fff5f5", fontSize: 12, cursor: "pointer", color: "#dc2626", fontWeight: 600 }}
                      >
                        🗑 削除
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ CSVインポート ════════════════════════════════ */}
      {mode === "csv" && (
        <div>
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 20, marginBottom: 16 }}>
            <p style={{ fontSize: 13, color: "#374151", marginBottom: 12 }}>
              <strong>形式：</strong> 1行につき <code style={{ background: "#f3f4f6", padding: "1px 6px", borderRadius: 4 }}>商品ID,画像URL</code> を貼り付けてください。
            </p>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 16 }}>
              例：<code style={{ background: "#f3f4f6", padding: "1px 6px", borderRadius: 4 }}>00046197-5f6c-...,https://example.com/img.jpg</code>
            </p>
            <textarea
              value={csvText}
              onChange={e => setCsvText(e.target.value)}
              placeholder={"id,image_url\n00046197-...,https://...\n001e34e1-...,https://..."}
              rows={12}
              style={{
                width: "100%", padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: 8,
                fontSize: 12, fontFamily: "monospace", resize: "vertical", boxSizing: "border-box",
              }}
            />
            <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
              <button onClick={runCsvImport} disabled={csvRunning || !csvText.trim()}
                style={{
                  padding: "10px 24px", borderRadius: 8, border: "none",
                  background: csvRunning || !csvText.trim() ? "#d1d5db" : "#2563eb",
                  color: "#fff", fontWeight: "bold", fontSize: 14,
                  cursor: csvRunning || !csvText.trim() ? "not-allowed" : "pointer",
                }}>
                {csvRunning ? "インポート中…" : "📥 インポート実行"}
              </button>
              {csvResult && <span style={{ fontSize: 13, color: "#059669", fontWeight: 600 }}>{csvResult}</span>}
            </div>
          </div>

          {/* スクリプト案内 */}
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "14px 16px" }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#92400e", marginBottom: 6 }}>📋 CSVの作り方（ローカルスクリプト）</p>
            <p style={{ fontSize: 12, color: "#78350f", marginBottom: 8 }}>
              商品IDと名前の一覧は以下で取得できます：
            </p>
            <code style={{ display: "block", background: "#fff", border: "1px solid #fde68a", borderRadius: 6, padding: "8px 10px", fontSize: 11, fontFamily: "monospace", color: "#374151" }}>
              node scripts/export-products.js
            </code>
          </div>
        </div>
      )}

      {/* ══ 自動取得（楽天） ═════════════════════════════ */}
      {mode === "auto" && (
        <div>
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>
            楽天商品検索APIで商品名を検索し、画像URLを自動で取得します。
            歯科専門品は未取得になる場合があります。
          </p>

          {running && (
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 14, fontWeight: "bold", color: "#166534" }}>
                  取得中… {processed}件処理 / 画像発見：{found}件
                </span>
                <button onClick={() => { stopRef.current = true }}
                  style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #fca5a5", background: "#fff", color: "#ef4444", fontSize: 12, fontWeight: "bold", cursor: "pointer" }}>
                  ⏹ 停止
                </button>
              </div>
              <p style={{ fontSize: 11, color: "#6b7280", margin: 0 }}>タブを閉じると停止します</p>
            </div>
          )}

          {done && (
            <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
              <span style={{ fontSize: 15, fontWeight: "bold", color: "#166534" }}>🎉 完了！ {found}件の画像を取得しました</span>
            </div>
          )}

          {autoError && (
            <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#b91c1c" }}>
              ⚠ {autoError}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <button onClick={startFetch} disabled={running}
              style={{
                flex: 1, padding: "13px 0", borderRadius: 10, border: "none",
                background: running ? "#d1d5db" : "#059669", color: "#fff",
                fontSize: 15, fontWeight: "bold", cursor: running ? "not-allowed" : "pointer",
              }}>
              {running ? "取得中…" : done ? "🔄 再取得（未取得分のみ）" : "🚀 一括取得開始"}
            </button>
            <button onClick={fetchStats}
              style={{ padding: "13px 18px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", fontSize: 13, cursor: "pointer", color: "#374151" }}>
              更新
            </button>
          </div>

          {log.length > 0 && (
            <div ref={logRef} style={{ background: "#111", borderRadius: 10, padding: "12px 14px", maxHeight: 200, overflowY: "auto", fontFamily: "monospace", fontSize: 12 }}>
              {log.map((l, i) => (
                <div key={i} style={{ color: l.startsWith("⚠") ? "#fca5a5" : l.startsWith("🎉") ? "#86efac" : "#d1fae5", marginBottom: 2 }}>{l}</div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <button onClick={async () => {
              if (!window.confirm("取得した画像URLをすべてリセットしますか？")) return
              await supabase.from("products").update({ image_url: null }).not("image_url", "is", null)
              await fetchStats(); setProcessed(0); setFound(0); setDone(false); setLog([])
            }} style={{ fontSize: 12, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
              取得結果をリセット
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
