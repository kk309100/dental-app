"use client"

// 受注処理ページ
// 新着注文（注文受付）を一覧表示し、1クリックで
//   在庫あり → ステータス「準備中」（出荷準備）
//   在庫なし → 発注プール自動追加
// まで処理できる業務フロー専用画面

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { poolFromOrders } from "@/lib/po-pool"
import { fmtYen } from "@/lib/invoice"
import Link from "next/link"

// ─── 型定義 ───────────────────────────────────────────────
type Order = {
  id: string
  clinic_id: string
  status: string
  created_at: string
  total_price: number
  delivery_number: string | null
  source: string | null
  note: string | null
}
type OrderItem = {
  id: string
  order_id: string
  product_id: string | null
  product_name: string | null
  quantity: number
  price: number
}
type Product = {
  id: string
  name: string
  stock: number | null
}
type Clinic = {
  id: string
  name: string
  corporate_name: string | null
}

// 処理結果
type ProcessResult = {
  orderId: string
  clinicName: string
  inStockCount: number
  shortCount: number
  poolAdded: { supplier_name: string; added_items: number }[]
  skippedNoSupplier: number
  error: string | null
}

// ─── カラー定数 ───────────────────────────────────────────
const C = {
  green:  { bg: "#dcfce7", color: "#15803d", border: "#86efac" },
  red:    { bg: "#fee2e2", color: "#b91c1c", border: "#fca5a5" },
  yellow: { bg: "#fef3c7", color: "#92400e", border: "#fde68a" },
  blue:   { bg: "#dbeafe", color: "#1e40af", border: "#93c5fd" },
  gray:   { bg: "#f3f4f6", color: "#6b7280", border: "#d1d5db" },
}

export default function OrderProcessPage() {
  const [orders, setOrders]       = useState<Order[]>([])
  const [items, setItems]         = useState<OrderItem[]>([])
  const [products, setProducts]   = useState<Product[]>([])
  const [clinics, setClinics]     = useState<Clinic[]>([])
  const [loading, setLoading]     = useState(true)
  const [processing, setProcessing] = useState<Set<string>>(new Set())
  const [results, setResults]     = useState<ProcessResult[]>([])
  const [showResult, setShowResult] = useState(false)
  const [processingAll, setProcessingAll] = useState(false)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [o, i, p, c] = await Promise.all([
      supabase.from("orders")
        .select("id,clinic_id,status,created_at,total_price,delivery_number,source,note")
        .in("status", ["注文受付", "確認中"])
        .order("created_at", { ascending: true })
        .limit(200),
      supabase.from("order_items").select("id,order_id,product_id,product_name,quantity,price").limit(50000),
      supabase.from("products").select("id,name,stock").limit(50000),
      supabase.from("clinics").select("id,name,corporate_name").limit(50000),
    ])
    setOrders((o.data as Order[]) || [])
    setItems((i.data as OrderItem[]) || [])
    setProducts((p.data as Product[]) || [])
    setClinics((c.data as Clinic[]) || [])
    setLoading(false)
  }

  // O(1) ルックアップ
  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const clinicById  = useMemo(() => new Map(clinics.map(c => [c.id, c])), [clinics])
  const itemsByOrder = useMemo(() => {
    const m = new Map<string, OrderItem[]>()
    for (const it of items) {
      if (!m.has(it.order_id)) m.set(it.order_id, [])
      m.get(it.order_id)!.push(it)
    }
    return m
  }, [items])

  // 在庫状態の計算
  function stockStatus(item: OrderItem): { ok: boolean; stock: number; short: number } {
    const p = item.product_id ? productById.get(item.product_id) : null
    const stock = Number(p?.stock || 0)
    const need  = Number(item.quantity || 0)
    return { ok: stock >= need, stock, short: Math.max(0, need - stock) }
  }

  // 注文全体の在庫サマリ
  function orderStockSummary(orderId: string) {
    const its = itemsByOrder.get(orderId) || []
    let inStock = 0, short = 0
    for (const it of its) {
      if (stockStatus(it).ok) inStock++
      else short++
    }
    return { inStock, short, total: its.length }
  }

  // 1件処理
  async function processOrder(order: Order) {
    if (processing.has(order.id)) return
    setProcessing(prev => new Set([...prev, order.id]))

    try {
      const clinic = clinicById.get(order.clinic_id)
      const clinicName = clinic?.name || "(不明)"

      // 1. 在庫チェック
      const summary = orderStockSummary(order.id)

      // 2. ステータスを「準備中」に更新
      const { error: se } = await supabase
        .from("orders")
        .update({ status: "準備中" })
        .eq("id", order.id)
      if (se) throw new Error("ステータス更新失敗: " + se.message)

      // 3. 不足分を発注プールへ
      let poolAdded: { supplier_name: string; added_items: number }[] = []
      let skippedNoSupplier = 0
      if (summary.short > 0) {
        const r = await poolFromOrders([order.id])
        poolAdded = r.pos.map(p => ({ supplier_name: p.supplier_name, added_items: p.added_items }))
        skippedNoSupplier = r.skippedNoSupplier
      }

      const result: ProcessResult = {
        orderId: order.id,
        clinicName,
        inStockCount: summary.inStock,
        shortCount: summary.short,
        poolAdded,
        skippedNoSupplier,
        error: null,
      }
      setResults(prev => [...prev, result])
      setShowResult(true)

      // 一覧から除外（再フェッチ）
      setOrders(prev => prev.filter(o => o.id !== order.id))
    } catch (e) {
      const result: ProcessResult = {
        orderId: order.id,
        clinicName: clinicById.get(order.clinic_id)?.name || "(不明)",
        inStockCount: 0,
        shortCount: 0,
        poolAdded: [],
        skippedNoSupplier: 0,
        error: (e as Error).message,
      }
      setResults(prev => [...prev, result])
      setShowResult(true)
    } finally {
      setProcessing(prev => { const n = new Set(prev); n.delete(order.id); return n })
    }
  }

  // 全件一括処理
  async function processAll() {
    if (orders.length === 0) return
    if (!confirm(`新着注文 ${orders.length}件 をまとめて処理します。\n在庫あり→出荷準備、在庫なし→発注プールへ自動振り分けされます。\nよろしいですか？`)) return
    setProcessingAll(true)
    for (const order of orders) {
      await processOrder(order)
    }
    setProcessingAll(false)
  }

  // 医院名表示
  function clinicLabel(clinicId: string) {
    const c = clinicById.get(clinicId)
    if (!c) return "(医院不明)"
    return c.corporate_name ? `${c.corporate_name} ${c.name}` : c.name
  }

  // 日時フォーマット
  function fmtDateTime(iso: string) {
    const d = new Date(iso)
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`
  }

  if (loading) return (
    <div style={{ textAlign: "center", padding: 60, color: "#9ca3af" }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
      <div>読み込み中…</div>
    </div>
  )

  return (
    <div style={{ maxWidth: 860 }}>

      {/* ─── ヘッダー ──────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: 0 }}>
            📥 受注処理
          </h1>
          <p style={{ fontSize: 12, color: "#6b7280", margin: "2px 0 0" }}>
            新着注文を確認し、在庫振り分け・発注プール追加を一括で行います
          </p>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/admin/orders">
            <button style={btnGray}>注文一覧</button>
          </Link>
          <Link href="/admin/shipping">
            <button style={btnBlue}>🚚 出荷準備へ</button>
          </Link>
          <Link href="/admin/purchase-orders/pool">
            <button style={btnOrange}>📦 発注プールへ</button>
          </Link>
        </div>
      </div>

      {/* ─── 件数バナー ──────────────────────────────────────── */}
      {orders.length > 0 ? (
        <div style={{
          display: "flex", alignItems: "center", gap: 16,
          background: "#fff7ed", border: "2px solid #fdba74",
          borderRadius: 12, padding: "14px 20px", marginBottom: 20,
        }}>
          <div style={{ fontSize: 32 }}>📋</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#9a3412" }}>
              新着注文 {orders.length}件
            </div>
            <div style={{ fontSize: 12, color: "#c2410c" }}>
              {orders.length}件の注文が処理待ちです
            </div>
          </div>
          <button
            onClick={processAll}
            disabled={processingAll}
            style={{
              marginLeft: "auto",
              padding: "10px 20px",
              borderRadius: 10,
              border: "none",
              background: processingAll ? "#d1d5db" : "#ea580c",
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              cursor: processingAll ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}>
            {processingAll ? "処理中…" : `⚡ ${orders.length}件まとめて処理`}
          </button>
        </div>
      ) : (
        <div style={{
          textAlign: "center", padding: "48px 24px",
          background: "#f0fdf4", border: "2px solid #86efac",
          borderRadius: 16, marginBottom: 20,
        }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#15803d" }}>新着注文はありません</div>
          <div style={{ fontSize: 12, color: "#16a34a", marginTop: 4 }}>すべての受注が処理済みです</div>
          <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/admin/shipping">
              <button style={btnBlue}>🚚 出荷準備を確認</button>
            </Link>
            <Link href="/admin/purchase-orders/pool">
              <button style={btnOrange}>📦 発注プールを確認</button>
            </Link>
          </div>
        </div>
      )}

      {/* ─── 注文カード ──────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {orders.map(order => {
          const its  = itemsByOrder.get(order.id) || []
          const summary = orderStockSummary(order.id)
          const isProcessing = processing.has(order.id)

          return (
            <div key={order.id} style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              overflow: "hidden",
              opacity: isProcessing ? 0.7 : 1,
              transition: "opacity 0.2s",
            }}>
              {/* カードヘッダー */}
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "12px 16px",
                background: "#f9fafb",
                borderBottom: "1px solid #e5e7eb",
                flexWrap: "wrap",
              }}>
                {/* 経路バッジ */}
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                  ...(order.source === "admin" ? C.yellow : C.blue),
                }}>
                  {order.source === "admin" ? "📞 電話/口頭" : "🏥 Web注文"}
                </span>

                {/* 医院名 */}
                <span style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>
                  {clinicLabel(order.clinic_id)}
                </span>

                {/* 日時 */}
                <span style={{ fontSize: 12, color: "#9ca3af" }}>
                  {fmtDateTime(order.created_at)}
                </span>

                {/* 在庫サマリバッジ */}
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  {summary.inStock > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, ...C.green }}>
                      ✅ 在庫あり {summary.inStock}品
                    </span>
                  )}
                  {summary.short > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, ...C.red }}>
                      ❌ 在庫不足 {summary.short}品
                    </span>
                  )}
                </span>
              </div>

              {/* 商品明細 */}
              <div style={{ padding: "10px 16px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <th style={{ textAlign: "left", padding: "4px 6px", fontSize: 11, color: "#9ca3af", fontWeight: 600 }}>商品名</th>
                      <th style={{ textAlign: "right", padding: "4px 6px", fontSize: 11, color: "#9ca3af", fontWeight: 600, width: 50 }}>数量</th>
                      <th style={{ textAlign: "right", padding: "4px 6px", fontSize: 11, color: "#9ca3af", fontWeight: 600, width: 70 }}>単価</th>
                      <th style={{ textAlign: "center", padding: "4px 6px", fontSize: 11, color: "#9ca3af", fontWeight: 600, width: 110 }}>在庫状況</th>
                    </tr>
                  </thead>
                  <tbody>
                    {its.map(it => {
                      const st = stockStatus(it)
                      return (
                        <tr key={it.id} style={{ borderBottom: "1px solid #f9fafb" }}>
                          <td style={{ padding: "6px 6px", color: "#111827" }}>
                            {it.product_name || "(商品名なし)"}
                          </td>
                          <td style={{ padding: "6px 6px", textAlign: "right", color: "#374151", fontWeight: 600 }}>
                            {it.quantity}
                          </td>
                          <td style={{ padding: "6px 6px", textAlign: "right", color: "#6b7280" }}>
                            {it.price > 0 ? fmtYen(it.price) : "—"}
                          </td>
                          <td style={{ padding: "6px 6px", textAlign: "center" }}>
                            {st.ok ? (
                              <span style={{
                                fontSize: 11, fontWeight: 700, padding: "2px 8px",
                                borderRadius: 999, ...C.green,
                              }}>
                                ✅ 在庫{st.stock}
                              </span>
                            ) : (
                              <span style={{
                                fontSize: 11, fontWeight: 700, padding: "2px 8px",
                                borderRadius: 999, ...C.red,
                              }}>
                                ❌ {st.short}個不足
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {its.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ padding: "12px 6px", textAlign: "center", color: "#9ca3af", fontSize: 12 }}>
                          明細なし
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {/* 備考 */}
                {order.note && (
                  <div style={{
                    marginTop: 8, padding: "6px 10px",
                    background: "#fefce8", border: "1px solid #fde68a",
                    borderRadius: 6, fontSize: 12, color: "#92400e",
                  }}>
                    💬 {order.note}
                  </div>
                )}
              </div>

              {/* カードフッター（アクション） */}
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 16px",
                background: "#fafafa",
                borderTop: "1px solid #f3f4f6",
                flexWrap: "wrap",
              }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  {summary.inStock > 0 && summary.short > 0
                    ? `在庫あり${summary.inStock}品→出荷準備  在庫なし${summary.short}品→発注プール`
                    : summary.short === 0
                    ? `全${summary.total}品：在庫あり→出荷準備`
                    : `全${summary.total}品：在庫不足→発注プール`}
                </div>
                <button
                  onClick={() => processOrder(order)}
                  disabled={isProcessing}
                  style={{
                    marginLeft: "auto",
                    padding: "8px 18px",
                    borderRadius: 8, border: "none",
                    background: isProcessing ? "#d1d5db" : "#059669",
                    color: "#fff",
                    fontSize: 13, fontWeight: 700,
                    cursor: isProcessing ? "not-allowed" : "pointer",
                    whiteSpace: "nowrap",
                  }}>
                  {isProcessing ? "処理中…" : "この注文を処理する →"}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* ─── 処理結果モーダル ────────────────────────────────── */}
      {showResult && results.length > 0 && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 9999, padding: 16,
        }}>
          <div style={{
            background: "#fff", borderRadius: 16,
            maxWidth: 520, width: "100%",
            maxHeight: "80vh", overflowY: "auto",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            {/* モーダルヘッダー */}
            <div style={{
              padding: "16px 20px 12px",
              borderBottom: "1px solid #e5e7eb",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <span style={{ fontSize: 20 }}>✅</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: "#111827" }}>
                処理完了 {results.length}件
              </span>
            </div>

            {/* 結果一覧 */}
            <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              {results.map((r, i) => (
                <div key={i} style={{
                  padding: "12px 14px",
                  background: r.error ? "#fff5f5" : "#f0fdf4",
                  border: `1px solid ${r.error ? "#fca5a5" : "#86efac"}`,
                  borderRadius: 10,
                }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#111827", marginBottom: 6 }}>
                    {r.error ? "❌" : "✅"} {r.clinicName}
                  </div>
                  {r.error ? (
                    <div style={{ fontSize: 12, color: "#dc2626" }}>エラー: {r.error}</div>
                  ) : (
                    <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.8 }}>
                      {r.inStockCount > 0 && (
                        <div>🚚 在庫あり <strong>{r.inStockCount}品</strong> → 出荷準備リストへ追加</div>
                      )}
                      {r.shortCount > 0 && r.poolAdded.length > 0 && (
                        <div>📦 在庫不足 <strong>{r.shortCount}品</strong> → 発注プールへ追加
                          {r.poolAdded.map((p, j) => (
                            <span key={j} style={{ marginLeft: 6, padding: "1px 6px", background: "#fff7ed", borderRadius: 4, fontSize: 11, color: "#9a3412" }}>
                              {p.supplier_name} {p.added_items}品
                            </span>
                          ))}
                        </div>
                      )}
                      {r.skippedNoSupplier > 0 && (
                        <div style={{ color: "#b45309" }}>
                          ⚠️ 仕入先未設定 <strong>{r.skippedNoSupplier}品</strong>（手動で発注先を設定してください）
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* モーダルフッター */}
            <div style={{
              padding: "12px 20px 16px",
              borderTop: "1px solid #e5e7eb",
              display: "flex", gap: 10, flexWrap: "wrap",
            }}>
              <Link href="/admin/shipping">
                <button style={{ ...btnBlue, padding: "9px 18px" }}>
                  🚚 出荷準備へ
                </button>
              </Link>
              <Link href="/admin/purchase-orders/pool">
                <button style={{ ...btnOrange, padding: "9px 18px" }}>
                  📦 発注プールへ
                </button>
              </Link>
              <button
                onClick={() => { setShowResult(false); setResults([]) }}
                style={{ ...btnGray, marginLeft: "auto", padding: "9px 18px" }}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── スタイル定数 ─────────────────────────────────────────
const btnGray: React.CSSProperties = {
  padding: "7px 14px", borderRadius: 8,
  border: "1px solid #d1d5db", background: "#fff",
  fontSize: 12, color: "#374151", cursor: "pointer", fontWeight: 600,
}
const btnBlue: React.CSSProperties = {
  padding: "7px 14px", borderRadius: 8,
  border: "1px solid #93c5fd", background: "#eff6ff",
  fontSize: 12, color: "#1e40af", cursor: "pointer", fontWeight: 700,
}
const btnOrange: React.CSSProperties = {
  padding: "7px 14px", borderRadius: 8,
  border: "1px solid #fdba74", background: "#fff7ed",
  fontSize: 12, color: "#9a3412", cursor: "pointer", fontWeight: 700,
}
