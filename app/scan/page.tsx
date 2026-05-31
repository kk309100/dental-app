"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

type Product = { id: string; name: string; barcode: string; stock: number | null }
type ScanResult = { product: Product; qty: number; done: boolean }

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
  const [results, setResults] = useState<ScanResult[]>([])
  const [pending, setPending] = useState<{ product: Product; qty: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  // 認証チェック & 商品ロード
  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push("/login"); return }
      const { data: profile } = await supabase.from("profiles").select("clinic_id").eq("id", user.id).single()
      if (profile?.clinic_id) setClinicId(profile.clinic_id)

      const { data } = await supabase
        .from("products")
        .select("id,name,barcode,stock")
        .not("barcode", "is", null)
        .neq("barcode", "")
        .limit(50000)
      setProducts((data as Product[]) || [])
    })()
  }, [])

  // 入力欄に常にフォーカス
  useEffect(() => { inputRef.current?.focus() }, [pending])

  function handleScan(e: React.FormEvent) {
    e.preventDefault()
    const code = input.trim()
    setInput("")
    if (!code) return

    // バーコードで商品検索
    const found = products.find(p => p.barcode === code)
    if (!found) {
      setMsg(`⚠ バーコード「${code}」に一致する商品が見つかりません`)
      setTimeout(() => setMsg(""), 3000)
      return
    }
    // 数量確認ダイアログへ
    setPending({ product: found, qty: 1 })
    setMsg("")
  }

  async function confirmReceive() {
    if (!pending) return
    setSaving(true)
    try {
      const before = Number(pending.product.stock || 0)
      const after = before + pending.qty

      // stock 更新
      const { error: e1 } = await supabase
        .from("products")
        .update({ stock: after })
        .eq("id", pending.product.id)
      if (e1) throw new Error(e1.message)

      // stock_receipts に記録
      await supabase.from("stock_receipts").insert({
        product_id: pending.product.id,
        quantity: pending.qty,
        note: "納品書バーコードスキャン",
        received_at: new Date().toISOString(),
      }).throwOnError()

      // stock_movements に記録（エラーは無視）
      await supabase.from("stock_movements").insert({
        product_id: pending.product.id,
        change_amount: pending.qty,
        change_type: "receive",
        memo: "納品書バーコードスキャン",
        before_stock: before,
        after_stock: after,
      })

      // ローカル商品在庫を更新
      setProducts(prev => prev.map(p => p.id === pending.product.id ? { ...p, stock: after } : p))
      setResults(prev => [
        { product: { ...pending.product, stock: after }, qty: pending.qty, done: true },
        ...prev,
      ])
      setPending(null)
    } catch (err) {
      setMsg("❌ エラー: " + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", padding: "16px" }}>
      {/* ヘッダー */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button
          onClick={() => router.push("/menu")}
          style={{ padding: "6px 14px", background: "#e2e8f0", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}
        >
          ← メニュー
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>📦 納品バーコードスキャン</h1>
      </div>

      {/* スキャン入力（USB スキャナー / カメラアプリ） */}
      {!pending && (
        <div style={{ background: "#fff", borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
          <p style={{ fontSize: 13, color: "#64748b", marginBottom: 10 }}>
            バーコードをスキャンしてください（USBスキャナーまたはバーコード読み取りアプリ）
          </p>
          <form onSubmit={handleScan} style={{ display: "flex", gap: 10 }}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="バーコードをスキャン…"
              autoFocus
              style={{
                flex: 1, fontSize: 18, padding: "12px 16px", border: "2px solid #2563eb",
                borderRadius: 10, outline: "none", background: "#f8fafc",
              }}
            />
            <button
              type="submit"
              style={{ padding: "12px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 10, fontSize: 16, cursor: "pointer" }}
            >
              確認
            </button>
          </form>
          {msg && (
            <div style={{ marginTop: 10, padding: "8px 14px", background: "#fef9c3", borderRadius: 8, fontSize: 13, color: "#92400e" }}>
              {msg}
            </div>
          )}
        </div>
      )}

      {/* 数量確認ダイアログ */}
      {pending && (
        <div style={{
          background: "#fff", borderRadius: 12, padding: 24, marginBottom: 16,
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)", border: "2px solid #2563eb",
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>✅ 商品を確認</h2>
          <div style={{ background: "#eff6ff", borderRadius: 8, padding: "12px 16px", marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{pending.product.name}</p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#64748b" }}>
              現在庫: {pending.product.stock ?? 0}個 → スキャン後: {(pending.product.stock ?? 0) + pending.qty}個
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>受取数量:</span>
            <button
              onClick={() => setPending(p => p ? { ...p, qty: Math.max(1, p.qty - 1) } : null)}
              style={{ width: 36, height: 36, fontSize: 20, borderRadius: 8, border: "1px solid #cbd5e1", background: "#f1f5f9", cursor: "pointer" }}
            >−</button>
            <span style={{ fontSize: 24, fontWeight: 700, minWidth: 40, textAlign: "center" }}>{pending.qty}</span>
            <button
              onClick={() => setPending(p => p ? { ...p, qty: p.qty + 1 } : null)}
              style={{ width: 36, height: 36, fontSize: 20, borderRadius: 8, border: "1px solid #cbd5e1", background: "#f1f5f9", cursor: "pointer" }}
            >＋</button>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={confirmReceive}
              disabled={saving}
              style={{
                flex: 1, padding: "14px", background: saving ? "#93c5fd" : "#2563eb", color: "#fff",
                border: "none", borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "保存中…" : "✅ 在庫に追加"}
            </button>
            <button
              onClick={() => { setPending(null); setInput(""); setTimeout(() => inputRef.current?.focus(), 100) }}
              style={{ padding: "14px 20px", background: "#f1f5f9", border: "none", borderRadius: 10, fontSize: 14, cursor: "pointer" }}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* スキャン済み履歴 */}
      {results.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 12, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "#374151" }}>スキャン履歴（今回）</h3>
          {results.map((r, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "8px 12px", background: "#f0fdf4", borderRadius: 8, marginBottom: 6,
            }}>
              <span style={{ fontSize: 14 }}>{r.product.name}</span>
              <span style={{ fontSize: 14, color: "#16a34a", fontWeight: 700 }}>+{r.qty}個 追加</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
