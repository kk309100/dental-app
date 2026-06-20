"use client"

// 年次棚卸しページ（医院側）
// 注文履歴から商品リストを自動生成し、実数を入力して報告書を印刷する

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

type OrderItem = {
  product_id: string | null
  product_name: string | null
  quantity: number
  unit_price: number | null
}

type ProductRow = {
  key: string          // product_id or product_name
  product_name: string
  total_qty: number    // 期間内の注文合計数
  counted: string      // 実在庫（入力値）
  note: string
}

function toFiscalYear(date: Date): { from: string; to: string; label: string } {
  const y = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1
  return {
    from:  `${y}-04-01`,
    to:    `${y + 1}-03-31`,
    label: `${y}年度（${y}/4/1 〜 ${y + 1}/3/31）`,
  }
}

export default function StocktakePage() {
  const router = useRouter()
  const [clinicId, setClinicId]     = useState("")
  const [clinicName, setClinicName] = useState("")
  const [loading, setLoading]       = useState(true)
  const [generating, setGenerating] = useState(false)

  const today = new Date()
  const fy    = toFiscalYear(today)
  const [dateFrom, setDateFrom] = useState(fy.from)
  const [dateTo,   setDateTo]   = useState(fy.to)
  const [takenOn,  setTakenOn]  = useState(today.toISOString().slice(0, 10))

  const [rows, setRows]       = useState<ProductRow[]>([])
  const [generated, setGenerated] = useState(false)
  const printRef = useRef<HTMLDivElement>(null)

  useEffect(() => { init() }, [])

  async function init() {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) { router.push("/login"); return }
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", userData.user.id).single()
    if (!profile) { router.push("/login"); return }
    if (profile.role === "admin") { router.push("/admin"); return }
    setClinicId(profile.clinic_id)
    const { data: clinic } = await supabase.from("clinics").select("name").eq("id", profile.clinic_id).single()
    setClinicName(clinic?.name || "")
    setLoading(false)
  }

  async function generate() {
    if (!clinicId) return
    setGenerating(true)

    // 1. 対象期間の注文を取得
    const { data: orders } = await supabase
      .from("orders")
      .select("id")
      .eq("clinic_id", clinicId)
      .gte("created_at", dateFrom + "T00:00:00")
      .lte("created_at", dateTo   + "T23:59:59")
      .not("status", "in", '("キャンセル","取消","キャンセル申請中")')

    const orderIds = (orders || []).map((o: { id: string }) => o.id)
    if (orderIds.length === 0) {
      setRows([])
      setGenerated(true)
      setGenerating(false)
      return
    }

    // 2. 注文明細を取得
    const { data: items } = await supabase
      .from("order_items")
      .select("product_id,product_name,quantity,unit_price")
      .in("order_id", orderIds)
      .limit(100000)

    // 3. product_id が紐付いている商品は棚卸し対象外フラグをチェック
    const productIds = [...new Set(
      (items || []).map((i: OrderItem) => i.product_id).filter(Boolean)
    )] as string[]

    let excludedIds = new Set<string>()
    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from("products")
        .select("id,stocktake_exclude")
        .in("id", productIds)
      ;(products || []).forEach((p: { id: string; stocktake_exclude: boolean | null }) => {
        if (p.stocktake_exclude) excludedIds.add(p.id)
      })
    }

    // 4. 商品ごとに集計（対象外を除く）
    const map = new Map<string, ProductRow>()
    ;(items as OrderItem[] || []).forEach(item => {
      if (item.product_id && excludedIds.has(item.product_id)) return
      const key  = item.product_id || item.product_name || "不明"
      const name = item.product_name || "(商品名なし)"
      const qty  = Number(item.quantity || 0)
      if (map.has(key)) {
        map.get(key)!.total_qty += qty
      } else {
        map.set(key, { key, product_name: name, total_qty: qty, counted: "", note: "" })
      }
    })

    setRows([...map.values()].sort((a, b) => a.product_name.localeCompare(b.product_name, "ja")))
    setGenerated(true)
    setGenerating(false)
  }

  function updateRow(key: string, field: "counted" | "note", value: string) {
    setRows(prev => prev.map(r => r.key === key ? { ...r, [field]: value } : r))
  }

  const countedCount = useMemo(() => rows.filter(r => r.counted !== "").length, [rows])

  function handlePrint() { window.print() }

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <p style={{ color: "#9ca3af" }}>読み込み中…</p>
    </div>
  )

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", paddingBottom: 60 }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body { background: white; }
          .print-table { page-break-inside: auto; }
          .print-table tr { page-break-inside: avoid; }
          input { border: none !important; background: transparent !important; }
        }
        .print-only { display: none; }
        input[type=number]::-webkit-inner-spin-button { opacity: 1; }
      `}</style>

      {/* ヘッダー */}
      <div className="no-print" style={{
        background: "linear-gradient(135deg, #f0fdf4 0%, #eff6ff 100%)",
        padding: "48px 20px 24px",
      }}>
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          <button onClick={() => router.push("/menu")}
            style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 13, marginBottom: 12 }}>
            ← メニューに戻る
          </button>
          <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 800, color: "#111827" }}>
            📋 年次棚卸し
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>{clinicName}</p>
        </div>
      </div>

      <div style={{ maxWidth: 700, margin: "0 auto", padding: "24px 16px" }}>

        {/* 設定パネル */}
        <div className="no-print" style={{
          background: "#fff", borderRadius: 16, padding: 20,
          boxShadow: "0 2px 12px rgba(0,0,0,0.06)", marginBottom: 20,
          border: "1px solid #e5e7eb",
        }}>
          <p style={{ margin: "0 0 14px", fontWeight: 700, fontSize: 14, color: "#374151" }}>対象期間を選択</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ border: "1.5px solid #e5e7eb", borderRadius: 8, padding: "8px 12px", fontSize: 14 }} />
            <span style={{ color: "#9ca3af" }}>〜</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ border: "1.5px solid #e5e7eb", borderRadius: 8, padding: "8px 12px", fontSize: 14 }} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {[-1, 0].map(offset => {
              const fy2 = toFiscalYear(new Date(today.getFullYear() + offset, today.getMonth(), today.getDate()))
              return (
                <button key={offset}
                  onClick={() => { setDateFrom(fy2.from); setDateTo(fy2.to) }}
                  style={{
                    fontSize: 12, padding: "5px 12px", borderRadius: 20,
                    border: "1.5px solid #e5e7eb", background: "#f9fafb",
                    cursor: "pointer", color: "#374151",
                  }}>
                  {offset === 0 ? "今年度" : "前年度"}（{fy2.label}）
                </button>
              )
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <label style={{ fontSize: 13, color: "#374151", flexShrink: 0 }}>棚卸し日：</label>
            <input type="date" value={takenOn} onChange={e => setTakenOn(e.target.value)}
              style={{ border: "1.5px solid #e5e7eb", borderRadius: 8, padding: "8px 12px", fontSize: 14 }} />
          </div>
          <button onClick={generate} disabled={generating}
            style={{
              width: "100%", padding: "13px 0", borderRadius: 12,
              background: generating ? "#d1d5db" : "#059669",
              border: "none", color: "#fff",
              fontSize: 15, fontWeight: 700, cursor: generating ? "default" : "pointer",
            }}>
            {generating ? "リスト生成中…" : "📋 棚卸しリストを生成"}
          </button>
        </div>

        {/* リスト */}
        {generated && (
          <>
            {rows.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af" }}>
                対象期間に注文履歴がありません
              </div>
            ) : (
              <>
                {/* 進捗バー */}
                <div className="no-print" style={{
                  background: "#fff", borderRadius: 12, padding: "14px 18px",
                  border: "1px solid #e5e7eb", marginBottom: 14,
                  display: "flex", alignItems: "center", gap: 14,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#374151", marginBottom: 6 }}>
                      <span>入力進捗</span>
                      <span style={{ fontWeight: 700 }}>{countedCount} / {rows.length} 品目</span>
                    </div>
                    <div style={{ height: 8, background: "#e5e7eb", borderRadius: 999 }}>
                      <div style={{
                        height: "100%", borderRadius: 999, background: "#059669",
                        width: `${rows.length > 0 ? (countedCount / rows.length) * 100 : 0}%`,
                        transition: "width 0.3s",
                      }} />
                    </div>
                  </div>
                  <button onClick={handlePrint}
                    disabled={countedCount === 0}
                    style={{
                      padding: "9px 20px", borderRadius: 10, border: "none",
                      background: countedCount > 0 ? "#2563eb" : "#d1d5db",
                      color: "#fff", fontSize: 14, fontWeight: 700,
                      cursor: countedCount > 0 ? "pointer" : "default", flexShrink: 0,
                    }}>
                    🖨 印刷
                  </button>
                </div>

                {/* 印刷用ヘッダー */}
                <div className="print-only" style={{ marginBottom: 16 }}>
                  <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 800 }}>棚卸し報告書</h2>
                  <p style={{ margin: "0 0 2px", fontSize: 13 }}>{clinicName}</p>
                  <p style={{ margin: "0 0 2px", fontSize: 13 }}>棚卸し日：{takenOn}</p>
                  <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>対象期間：{dateFrom} 〜 {dateTo}</p>
                </div>

                {/* テーブル */}
                <div ref={printRef} style={{
                  background: "#fff", borderRadius: 16, overflow: "hidden",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
                }}>
                  {/* テーブルヘッダー */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 80px 80px 1fr",
                    gap: 0,
                    padding: "10px 16px",
                    background: "#f9fafb",
                    borderBottom: "2px solid #e5e7eb",
                    fontSize: 11, fontWeight: 700, color: "#6b7280",
                  }}>
                    <div>商品名</div>
                    <div style={{ textAlign: "center" }}>期間内<br/>注文数</div>
                    <div style={{ textAlign: "center" }}>実在庫数<br/><span style={{ fontWeight: 400, color: "#9ca3af" }}>（未開封）</span></div>
                    <div>備考</div>
                  </div>

                  {rows.map((row, i) => (
                    <div key={row.key} style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 80px 80px 1fr",
                      gap: 0,
                      padding: "10px 16px",
                      borderBottom: i < rows.length - 1 ? "1px solid #f3f4f6" : "none",
                      alignItems: "center",
                      background: row.counted !== "" ? "#f0fdf4" : "transparent",
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "#111827", paddingRight: 8 }}>
                        {row.product_name}
                      </div>
                      <div style={{ textAlign: "center", fontSize: 14, fontWeight: 600, color: "#6b7280" }}>
                        {row.total_qty}
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <input
                          type="number"
                          min={0}
                          value={row.counted}
                          placeholder="—"
                          onChange={e => updateRow(row.key, "counted", e.target.value)}
                          style={{
                            width: 60, textAlign: "center", padding: "6px 4px",
                            border: "2px solid " + (row.counted !== "" ? "#059669" : "#e5e7eb"),
                            borderRadius: 8, fontSize: 14, fontWeight: 700,
                            color: "#111827", background: row.counted !== "" ? "#f0fdf4" : "#fafafa",
                          }}
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          value={row.note}
                          placeholder="備考…"
                          onChange={e => updateRow(row.key, "note", e.target.value)}
                          style={{
                            width: "100%", padding: "6px 8px",
                            border: "1.5px solid #e5e7eb", borderRadius: 8,
                            fontSize: 12, color: "#374151", background: "#fafafa",
                            boxSizing: "border-box",
                          }}
                        />
                      </div>
                    </div>
                  ))}

                  {/* 合計行 */}
                  <div style={{
                    padding: "12px 16px",
                    background: "#f9fafb", borderTop: "2px solid #e5e7eb",
                    display: "flex", justifyContent: "space-between",
                    fontSize: 13, color: "#374151",
                  }}>
                    <span>合計 {rows.length} 品目</span>
                    <span>
                      実在庫入力済み：<strong style={{ color: "#059669" }}>{countedCount}</strong> 品目
                    </span>
                  </div>
                </div>

                {/* 印刷ボタン（下） */}
                <div className="no-print" style={{ textAlign: "center", marginTop: 20 }}>
                  <button onClick={handlePrint}
                    disabled={countedCount === 0}
                    style={{
                      padding: "12px 36px", borderRadius: 12, border: "none",
                      background: countedCount > 0 ? "#2563eb" : "#d1d5db",
                      color: "#fff", fontSize: 15, fontWeight: 700,
                      cursor: countedCount > 0 ? "pointer" : "default",
                    }}>
                    🖨 棚卸し報告書を印刷
                  </button>
                  <p style={{ margin: "8px 0 0", fontSize: 12, color: "#9ca3af" }}>
                    {countedCount === 0 ? "実在庫数を1つ以上入力してください" : `${countedCount}品目を記録した報告書を印刷します`}
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
