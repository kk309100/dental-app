"use client"

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase, fetchAll } from "@/lib/supabase"
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode"

type Product = { id: string; name: string; barcode: string; stock: number | null; price: number | null }
type CartItem = { product: Product; qty: number }
type Mode = "stock" | "reorder"

// スキャン対象フォーマット（絞ることで解析速度が大幅改善）
const SCAN_FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,   // JAN13（歯科用品で最多）
  Html5QrcodeSupportedFormats.EAN_8,    // JAN8
  Html5QrcodeSupportedFormats.CODE_128, // CODE128
  Html5QrcodeSupportedFormats.CODE_39,  // CODE39
  Html5QrcodeSupportedFormats.QR_CODE,  // QRコード
]

export default function ScanPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-500">読み込み中…</div>}>
      <ScanReceive />
    </Suspense>
  )
}

function ScanReceive() {
  const router = useRouter()
  const [clinicId, setClinicId] = useState<string | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [input, setInput] = useState("")
  const [cart, setCart] = useState<CartItem[]>([])
  const [mode, setMode] = useState<Mode>("stock")
  const [ordererName, setOrdererName] = useState("")
  const [saving, setSaving] = useState(false)

  // O(1) バーコードルックアップ用 Map
  const barcodeMap = useMemo(() => {
    const m = new Map<string, Product>()
    for (const p of products) {
      if (p.barcode) m.set(String(p.barcode), p)
    }
    return m
  }, [products])
  const [msg, setMsg] = useState("")
  const [done, setDone] = useState<{ mode: Mode; count: number; orderId?: string } | null>(null)
  const [cameraScanning, setCameraScanning] = useState(false)
  const [scanFlash, setScanFlash] = useState<{ name: string; ok: boolean } | null>(null)
  const inputRef    = useRef<HTMLInputElement>(null)
  const scannerRef  = useRef<any>(null)
  const lastScanRef = useRef<{ code: string; time: number }>({ code: "", time: 0 })
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push("/login"); return }
      const { data: profile } = await supabase.from("profiles").select("clinic_id").eq("id", user.id).single()
      if (profile?.clinic_id) setClinicId(profile.clinic_id)
      const data = await fetchAll(
        "products",
        "id,name,barcode,stock,price",
        (q) => q.not("barcode", "is", null).neq("barcode", "")
      )
      setProducts((data as Product[]) || [])
    })()
  }, [])

  // スキャン入力欄に常にフォーカス
  useEffect(() => {
    if (!done) inputRef.current?.focus()
  }, [cart.length, done])

  async function startCameraScan() {
    setCameraScanning(true)
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const scanner = new Html5Qrcode("scan-reader")
    scannerRef.current = scanner
    try {
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 15,                                    // 10→15fps で反応速度アップ
          qrbox: { width: 280, height: 100 },         // JANバーコード向けの横長枠
          aspectRatio: 1.777778,                      // 16:9 カメラビュー
          formatsToSupport: SCAN_FORMATS,             // 対象形式を絞って高速化
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true,      // ブラウザ内蔵APIを優先使用
          },
        },
        (code) => {
          const now = Date.now()
          // デバウンス：同じバーコードを2秒以内に2回登録しない
          if (code === lastScanRef.current.code && now - lastScanRef.current.time < 2000) return
          lastScanRef.current = { code, time: now }

          // O(1) Map検索
          const found = barcodeMap.get(code)
          if (!found) {
            // 触覚フィードバック（エラー）
            if (typeof navigator.vibrate === "function") navigator.vibrate([80, 50, 80])
            if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
            setScanFlash({ name: `「${code}」は未登録`, ok: false })
            flashTimerRef.current = setTimeout(() => setScanFlash(null), 1800)
            setMsg(`⚠ 「${code}」に一致する商品が見つかりません`)
            setTimeout(() => setMsg(""), 2000)
            return
          }

          // 触覚フィードバック（成功）
          if (typeof navigator.vibrate === "function") navigator.vibrate(60)

          // カメラ内フラッシュ表示
          if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
          setScanFlash({ name: found.name, ok: true })
          flashTimerRef.current = setTimeout(() => setScanFlash(null), 1200)

          // カメラは止めずに連続スキャン継続
          setCart(prev => {
            const existing = prev.find(i => i.product.id === found.id)
            if (existing) return prev.map(i => i.product.id === found.id ? { ...i, qty: i.qty + 1 } : i)
            return [...prev, { product: found, qty: 1 }]
          })
          setMsg(`✅ ${found.name}`)
          setTimeout(() => setMsg(""), 1500)
        },
        () => {}
      )
    } catch {
      scannerRef.current = null
      setCameraScanning(false)
    }
  }

  function stopCameraScan() {
    if (scannerRef.current) {
      try { scannerRef.current.stop(); scannerRef.current.clear() } catch (_) {}
      scannerRef.current = null
    }
    setCameraScanning(false)
  }

  function handleScan(e: React.FormEvent) {
    e.preventDefault()
    const code = input.trim()
    setInput("")
    if (!code) return

    // O(1) Map検索
    const found = barcodeMap.get(code)
    if (!found) {
      setMsg(`⚠ 「${code}」に一致する商品が見つかりません`)
      setTimeout(() => setMsg(""), 2000)
      return
    }

    if (typeof navigator.vibrate === "function") navigator.vibrate(60)
    setCart(prev => {
      const existing = prev.find(i => i.product.id === found.id)
      if (existing) return prev.map(i => i.product.id === found.id ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { product: found, qty: 1 }]
    })
    setMsg(`✅ ${found.name}`)
    setTimeout(() => setMsg(""), 1500)
  }

  function updateQty(productId: string, delta: number) {
    setCart(prev =>
      prev.map(i => i.product.id === productId ? { ...i, qty: Math.max(1, i.qty + delta) } : i)
    )
  }

  function setQtyDirect(productId: string, val: string) {
    const n = parseInt(val, 10)
    if (isNaN(n) || n < 1) return
    setCart(prev => prev.map(i => i.product.id === productId ? { ...i, qty: n } : i))
  }

  function removeFromCart(productId: string) {
    setCart(prev => prev.filter(i => i.product.id !== productId))
  }

  // 在庫管理登録（まとめて）
  async function confirmStock() {
    if (cart.length === 0) return
    setSaving(true)
    setMsg("")
    try {
      for (const item of cart) {
        const before = Number(item.product.stock ?? 0)
        const after = before + item.qty
        const { error } = await supabase.from("products").update({ stock: after }).eq("id", item.product.id)
        if (error) throw new Error(error.message)
        await supabase.from("stock_receipts").insert({
          product_id: item.product.id,
          quantity: item.qty,
          note: "納品バーコードスキャン",
          received_at: new Date().toISOString(),
        })
        await supabase.from("stock_movements").insert({
          product_id: item.product.id,
          change_amount: item.qty,
          change_type: "receive",
          memo: "納品バーコードスキャン",
          before_stock: before,
          after_stock: after,
        })
      }
      setDone({ mode: "stock", count: cart.length })
      setCart([])
    } catch (err) {
      setMsg("❌ エラー: " + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // 再注文
  async function confirmReorder() {
    if (cart.length === 0 || !clinicId) return
    if (!ordererName.trim()) { setMsg("⚠ 注文者名を入力してください"); return }
    setSaving(true)
    setMsg("")
    try {
      const total = cart.reduce((s, i) => s + Number(i.product.price ?? 0) * i.qty, 0)
      const now = new Date()
      const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, "0"), d = String(now.getDate()).padStart(2, "0")
      const { data: ex } = await supabase.from("orders").select("id")
        .gte("created_at", `${y}-${m}-${d}T00:00:00`)
        .lte("created_at", `${y}-${m}-${d}T23:59:59`)
      const dn = `DN-${y}${m}${d}-${String((ex?.length || 0) + 1).padStart(4, "0")}`

      const { data: order, error } = await supabase.from("orders").insert([{
        clinic_id: clinicId,
        status: "注文受付",
        total_price: total,
        delivery_number: dn,
        orderer_name: ordererName.trim(),
        note: "スキャン再注文",
      }]).select().single()
      if (error || !order) throw new Error(error?.message || "注文作成失敗")

      await supabase.from("order_items").insert(
        cart.map(i => ({
          order_id: order.id,
          product_id: i.product.id,
          product_name: i.product.name,
          quantity: i.qty,
          price: i.product.price ?? 0,
        }))
      )
      setDone({ mode: "reorder", count: cart.length, orderId: order.id })
      setCart([])
      setOrdererName("")
    } catch (err) {
      setMsg("❌ エラー: " + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const totalQty = cart.reduce((s, i) => s + i.qty, 0)
  const totalPrice = cart.reduce((s, i) => s + Number(i.product.price ?? 0) * i.qty, 0)

  // 完了画面
  if (done) {
    return (
      <div style={{ minHeight: "100vh", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 36, textAlign: "center", maxWidth: 360, width: "100%", boxShadow: "0 4px 20px rgba(0,0,0,0.10)" }}>
          <div style={{ fontSize: 52, marginBottom: 12 }}>{done.mode === "stock" ? "📦" : "🛒"}</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
            {done.mode === "stock" ? "在庫を追加しました" : "注文を受け付けました"}
          </h2>
          <p style={{ fontSize: 14, color: "#64748b", marginBottom: 24 }}>
            {done.mode === "stock"
              ? `${done.count}種類の商品を在庫に追加しました`
              : `${done.count}種類の商品を注文しました`}
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => { setDone(null); setTimeout(() => inputRef.current?.focus(), 100) }}
              style={{ padding: "12px 24px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer" }}
            >
              続けてスキャン
            </button>
            <button
              onClick={() => router.push("/menu")}
              style={{ padding: "12px 20px", background: "#f1f5f9", border: "none", borderRadius: 10, fontSize: 14, cursor: "pointer" }}
            >
              メニューへ
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", padding: "16px", maxWidth: 560, margin: "0 auto" }}>
      {/* カメラスキャン オーバーレイ */}
      {cameraScanning && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "#000", display: "flex", flexDirection: "column",
        }}>
          <button onClick={stopCameraScan} style={{
            padding: "14px 0", background: "#ef4444", color: "#fff",
            border: "none", fontSize: 15, fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexShrink: 0,
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          }}>
            ✕ スキャンを停止
          </button>
          <div style={{ position: "relative", flex: 1, width: "100%" }}>
            <div id="scan-reader" style={{ width: "100%", height: "100%" }} />
            {/* スキャン成功/失敗フラッシュ */}
            {scanFlash && (
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                padding: "20px 24px",
                background: scanFlash.ok ? "#16a34a" : "#dc2626",
                color: "#fff",
                fontSize: 17,
                fontWeight: 700,
                textAlign: "center",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                boxShadow: `0 -4px 20px ${scanFlash.ok ? "rgba(22,163,74,0.6)" : "rgba(220,38,38,0.6)"}`,
                animation: "scanFlashIn 0.15s ease",
              }}>
                <span style={{ fontSize: 24 }}>{scanFlash.ok ? "✅" : "⚠️"}</span>
                <span style={{ maxWidth: "80%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {scanFlash.name}
                </span>
              </div>
            )}
            {/* 操作ヒント（フラッシュ非表示時） */}
            {!scanFlash && (
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                padding: "14px 20px",
                background: "rgba(0,0,0,0.55)",
                color: "rgba(255,255,255,0.75)",
                fontSize: 13,
                textAlign: "center",
              }}>
                QRコードを枠内に合わせてください
              </div>
            )}
          </div>
          <style>{`@keyframes scanFlashIn { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: translateY(0) } }`}</style>
        </div>
      )}
      {/* ヘッダー */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button
          onClick={() => router.push("/menu")}
          style={{ padding: "6px 14px", background: "#e2e8f0", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}
        >
          ← メニュー
        </button>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>📷 バーコードスキャン</h1>
      </div>

      {/* モード切替 */}
      <div style={{ display: "flex", background: "#e2e8f0", borderRadius: 12, padding: 4, marginBottom: 16, gap: 4 }}>
        <button
          onClick={() => setMode("stock")}
          style={{
            flex: 1, padding: "10px 0", borderRadius: 9, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700,
            background: mode === "stock" ? "#fff" : "transparent",
            color: mode === "stock" ? "#f08c00" : "#94a3b8",
            boxShadow: mode === "stock" ? "0 1px 4px rgba(0,0,0,0.10)" : "none",
            transition: "all 0.15s",
          }}
        >
          📦 在庫管理登録
        </button>
        <button
          onClick={() => setMode("reorder")}
          style={{
            flex: 1, padding: "10px 0", borderRadius: 9, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700,
            background: mode === "reorder" ? "#fff" : "transparent",
            color: mode === "reorder" ? "#2563eb" : "#94a3b8",
            boxShadow: mode === "reorder" ? "0 1px 4px rgba(0,0,0,0.10)" : "none",
            transition: "all 0.15s",
          }}
        >
          🛒 再注文
        </button>
      </div>

      {/* スキャン入力 */}
      <div style={{ background: "#fff", borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
        <p style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
          バーコードをスキャンしてカートに追加（連続スキャン可）
        </p>
        <form onSubmit={handleScan} style={{ display: "flex", gap: 8 }}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="バーコードをスキャン…"
            autoFocus
            style={{
              flex: 1, fontSize: 16, padding: "10px 14px",
              border: "2px solid #2563eb", borderRadius: 9, outline: "none", background: "#f8fafc",
            }}
          />
          <button
            type="submit"
            style={{ padding: "10px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 9, fontSize: 14, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            追加
          </button>
        </form>
        <button
          onClick={startCameraScan}
          style={{
            width: "100%", marginTop: 10, padding: "11px 0", background: "#7c3aed", color: "#fff",
            border: "none", borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          📷 カメラでスキャン
        </button>
        {msg && (
          <div style={{ marginTop: 8, padding: "7px 12px", background: "#fef9c3", borderRadius: 7, fontSize: 13, color: "#92400e" }}>
            {msg}
          </div>
        )}
      </div>

      {/* カート */}
      {cart.length > 0 ? (
        <div style={{ background: "#fff", borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "#374151" }}>
              スキャン済み {cart.length}種類・計{totalQty}点
            </h3>
            <button
              onClick={() => setCart([])}
              style={{ fontSize: 12, color: "#ef4444", background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}
            >
              全削除
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {cart.map(item => (
              <div key={item.product.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", background: "#f8fafc", borderRadius: 9,
                border: "1px solid #e2e8f0",
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.product.name}
                  </p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "#94a3b8" }}>
                    在庫: {item.product.stock ?? 0}個
                    {item.product.price ? `　¥${Number(item.product.price).toLocaleString()}` : ""}
                  </p>
                </div>
                {/* 数量調整 */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => updateQty(item.product.id, -1)}
                    style={{ width: 30, height: 30, borderRadius: 7, border: "1px solid #cbd5e1", background: "#f1f5f9", cursor: "pointer", fontSize: 16 }}
                  >−</button>
                  <input
                    type="number"
                    value={item.qty}
                    onChange={e => setQtyDirect(item.product.id, e.target.value)}
                    style={{ width: 44, textAlign: "center", fontSize: 15, fontWeight: 700, border: "1px solid #cbd5e1", borderRadius: 7, padding: "4px 0" }}
                  />
                  <button
                    onClick={() => updateQty(item.product.id, 1)}
                    style={{ width: 30, height: 30, borderRadius: 7, border: "1px solid #cbd5e1", background: "#f1f5f9", cursor: "pointer", fontSize: 16 }}
                  >＋</button>
                </div>
                <button
                  onClick={() => removeFromCart(item.product.id)}
                  style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "#fee2e2", color: "#ef4444", cursor: "pointer", fontSize: 15, flexShrink: 0 }}
                >✕</button>
              </div>
            ))}
          </div>

          {/* 合計（再注文モードのみ） */}
          {mode === "reorder" && totalPrice > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #e2e8f0", textAlign: "right", fontSize: 13, color: "#374151" }}>
              合計金額: <strong style={{ fontSize: 15 }}>¥{totalPrice.toLocaleString()}</strong>（税抜）
            </div>
          )}
        </div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 12, padding: "28px 16px", marginBottom: 14, textAlign: "center", color: "#94a3b8", fontSize: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
          スキャンした商品がここに表示されます
        </div>
      )}

      {/* 再注文：注文者名 */}
      {mode === "reorder" && (
        <div style={{ background: "#fff", borderRadius: 12, padding: 14, marginBottom: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
            注文者名 <span style={{ color: "#ef4444" }}>*</span>
          </label>
          <input
            type="text"
            value={ordererName}
            onChange={e => setOrdererName(e.target.value)}
            placeholder="例：山田 太郎"
            style={{
              width: "100%", boxSizing: "border-box", padding: "9px 12px",
              border: "1.5px solid #cbd5e1", borderRadius: 8, fontSize: 14, outline: "none",
            }}
          />
        </div>
      )}

      {/* 確定ボタン */}
      {mode === "stock" ? (
        <button
          onClick={confirmStock}
          disabled={saving || cart.length === 0}
          style={{
            width: "100%", padding: "16px", borderRadius: 12, border: "none", cursor: cart.length === 0 ? "not-allowed" : "pointer",
            background: cart.length === 0 ? "#e2e8f0" : saving ? "#9ca3af" : "#f08c00",
            color: cart.length === 0 ? "#94a3b8" : "#fff",
            fontSize: 16, fontWeight: 700, transition: "background 0.15s",
          }}
        >
          {saving ? "登録中…" : `📦 ${cart.length > 0 ? `${cart.length}種類・${totalQty}点を` : ""}在庫に追加する`}
        </button>
      ) : (
        <button
          onClick={confirmReorder}
          disabled={saving || cart.length === 0}
          style={{
            width: "100%", padding: "16px", borderRadius: 12, border: "none", cursor: cart.length === 0 ? "not-allowed" : "pointer",
            background: cart.length === 0 ? "#e2e8f0" : saving ? "#9ca3af" : "#2563eb",
            color: cart.length === 0 ? "#94a3b8" : "#fff",
            fontSize: 16, fontWeight: 700, transition: "background 0.15s",
          }}
        >
          {saving ? "注文中…" : `🛒 ${cart.length > 0 ? `${cart.length}種類を` : ""}再注文する`}
        </button>
      )}
    </div>
  )
}
