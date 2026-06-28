"use client"

import React, { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { toCSV, downloadCSV } from "@/lib/csv"

const C = {
  primary: "#22a648",
  blue:    "#2563eb",
  border:  "#e5e7eb",
  bg:      "#f3f4f6",
  text:    "#111827",
  sub:     "#6b7280",
}

type Item = {
  id: string
  product_name: string
  maker: string | null
  barcode: string | null
  stock_quantity: number
  location: string | null
  shelf_no: string | null
}

type PriceMap = Record<string, number> // product_name or barcode → cost

export default function StocktakeReportPage() {
  const router = useRouter()
  const [items, setItems]   = useState<Item[]>([])
  const [prices, setPrices] = useState<PriceMap>({})
  const [loading, setLoading] = useState(true)
  const [clinicName, setClinicName] = useState("")

  // 在庫数0を含めるか
  const [includeZero, setIncludeZero] = useState(false)

  useEffect(() => { init() }, [])

  async function init() {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) { router.push("/login"); return }
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", userData.user.id).single()
    if (!profile) { router.push("/login"); return }
    if (profile.role === "admin") { router.push("/admin"); return }

    // 医院名取得
    if (profile.clinic_id) {
      const { data: clinic } = await supabase.from("clinics").select("name").eq("id", profile.clinic_id).single()
      setClinicName((clinic as any)?.name || "")
    }

    // 在庫品目取得
    const { data: invData } = await supabase
      .from("clinic_inventory_items")
      .select("id,product_name,maker,barcode,stock_quantity,location,shelf_no")
      .order("location").order("product_name")
    const fetched = (invData as Item[]) || []
    setItems(fetched)

    // 在庫リスト（Excel）の単価データを優先使用
    const pm: PriceMap = {}
    try {
      const res = await fetch("/price-list.json")
      if (res.ok) {
        const priceList: { name: string; price: string }[] = await res.json()
        for (const p of priceList) {
          const n = parseFloat(p.price)
          if (!isNaN(n) && n > 0) pm[p.name] = n
        }
      }
    } catch {}

    // price-list.json に無い商品はproductsテーブルのcostで補完
    const { data: prodData } = await supabase
      .from("products")
      .select("name,barcode,cost")
      .limit(50000)
    for (const p of (prodData as any[]) || []) {
      if (p.barcode && p.cost && !pm[p.barcode]) pm[p.barcode] = p.cost
      if (p.name    && p.cost && !pm[p.name])    pm[p.name]    = p.cost
    }

    // 照合：まずバーコード一致、次に商品名一致
    const initPrices: PriceMap = {}
    for (const item of fetched) {
      const byBarcode = item.barcode ? pm[item.barcode] : undefined
      const byName    = pm[item.product_name]
      const matched   = byBarcode ?? byName ?? 0
      initPrices[item.id] = matched
    }
    setPrices(initPrices)
    setLoading(false)
  }

  function setPrice(id: string, val: string) {
    const n = parseFloat(val.replace(/,/g, ""))
    setPrices(prev => ({ ...prev, [id]: isNaN(n) ? 0 : n }))
  }

  const displayItems = useMemo(() =>
    includeZero ? items : items.filter(i => i.stock_quantity > 0),
    [items, includeZero])

  // 場所ごとグループ
  const groups = useMemo(() => {
    const map: Record<string, Item[]> = {}
    const order: string[] = []
    for (const item of displayItems) {
      const key = item.location || "（場所未設定）"
      if (!map[key]) { map[key] = []; order.push(key) }
      map[key].push(item)
    }
    return order.map(loc => ({ loc, items: map[loc] }))
  }, [displayItems])

  const grandTotal = useMemo(() =>
    displayItems.reduce((sum, i) => sum + i.stock_quantity * (prices[i.id] ?? 0), 0),
    [displayItems, prices])

  const matchedCount = useMemo(() =>
    displayItems.filter(i => (prices[i.id] ?? 0) > 0).length,
    [displayItems, prices])

  function exportReport() {
    const rows = displayItems.map(i => ({
      場所:     i.location || "",
      棚番号:   i.shelf_no || "",
      商品名:   i.product_name,
      メーカー: i.maker || "",
      数量:     i.stock_quantity,
      単価:     prices[i.id] ?? 0,
      金額:     i.stock_quantity * (prices[i.id] ?? 0),
    }))
    const now = new Date()
    const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}`
    downloadCSV(`棚卸し報告書_${stamp}.csv`, toCSV(rows, ["場所","棚番号","商品名","メーカー","数量","単価","金額"]))
  }

  const today = new Date()
  const dateStr = `${today.getFullYear()}年${today.getMonth()+1}月${today.getDate()}日`

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", color: C.sub }}>読み込み中…</div>
  )

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { margin: 10mm; size: A4 portrait; }
          body { font-size: 11pt; }
          .report-table { width: 100%; border-collapse: collapse; }
          .report-table th, .report-table td { border: 1px solid #ccc; padding: 4px 7px; font-size: 9pt; }
          .report-table th { background: #f3f4f6 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .loc-header { background: #e8f5ec !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-weight: bold; }
          .subtotal-row { background: #f9fafb !important; font-weight: bold; }
          .grand-total-row { background: #e8f5ec !important; font-weight: bold; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          input { border: none !important; background: transparent !important; font-size: 9pt; }
          .price-unmatched { color: #dc2626 !important; }
        }
        @media screen {
          .report-table { width: 100%; border-collapse: collapse; font-size: 13px; }
          .report-table th { background: #f3f4f6; padding: 8px 10px; border-bottom: 2px solid #e5e7eb; text-align: left; font-size: 12px; color: #6b7280; }
          .report-table td { padding: 7px 10px; border-bottom: 1px solid #f3f4f6; }
          .loc-header td { background: #e8f5ec; font-weight: bold; color: #166534; padding: 6px 10px; }
          .subtotal-row td { background: #f9fafb; font-weight: bold; color: #374151; }
          .grand-total-row td { background: #e8f5ec; font-weight: bold; color: #111827; font-size: 15px; }
        }
        .price-input { width: 80px; text-align: right; border: 1px solid #e5e7eb; border-radius: 5px; padding: 2px 5px; font-size: 13px; }
        .price-input:focus { outline: none; border-color: #2563eb; }
        .price-unmatched .price-input { border-color: #fca5a5; background: #fff1f1; }
      `}</style>

      {/* ── ヘッダー（画面のみ） ── */}
      <div className="no-print" style={{
        background: "#fff", padding: "10px 14px", borderBottom: `1px solid ${C.border}`,
        position: "sticky", top: 0, zIndex: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <button onClick={() => router.push("/inventory/stocktake")} style={{
            background: "#e8f5ec", color: C.primary, border: "1px solid #b2dfbd",
            borderRadius: 7, padding: "5px 11px", fontSize: 12, fontWeight: "bold", cursor: "pointer",
          }}>← 棚卸し</button>
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: "bold", color: C.text, flex: 1 }}>
            📄 棚卸し報告書
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.sub, cursor: "pointer" }}>
            <input type="checkbox" checked={includeZero} onChange={e => setIncludeZero(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: C.primary }} />
            在庫0の商品も含める
          </label>
          <span style={{ fontSize: 12, color: C.sub }}>
            {matchedCount}/{displayItems.length}件 単価自動取得
            {matchedCount < displayItems.length && (
              <span style={{ color: "#dc2626" }}>（赤字は手動入力が必要）</span>
            )}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={exportReport} style={{
              padding: "7px 14px", borderRadius: 8, border: `1.5px solid ${C.blue}`,
              background: "#eff6ff", color: C.blue, fontSize: 13, fontWeight: "bold", cursor: "pointer",
            }}>📥 CSV出力</button>
            <button onClick={() => window.print()} style={{
              padding: "7px 16px", borderRadius: 8, border: "none",
              background: C.primary, color: "#fff", fontSize: 13, fontWeight: "bold", cursor: "pointer",
            }}>🖨 印刷</button>
          </div>
        </div>
      </div>

      {/* ── 報告書本体 ── */}
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 12px" }}>

        {/* タイトル */}
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: "bold", color: C.text }}>
            棚卸し報告書
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: C.sub }}>
            {clinicName && <span>{clinicName}　</span>}
            {dateStr}
          </p>
        </div>

        {/* サマリー */}
        <div className="no-print" style={{
          display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap",
        }}>
          {[
            { label: "品目数",    value: `${displayItems.length}品目` },
            { label: "総在庫数",  value: `${displayItems.reduce((s,i) => s + i.stock_quantity, 0).toLocaleString()}` },
            { label: "在庫総額",  value: `¥${grandTotal.toLocaleString()}`, big: true },
          ].map(({ label, value, big }) => (
            <div key={label} style={{
              flex: 1, minWidth: 120, background: "#fff", border: `1px solid ${C.border}`,
              borderRadius: 10, padding: "12px 16px", textAlign: "center",
            }}>
              <div style={{ fontSize: 12, color: C.sub, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: big ? 22 : 18, fontWeight: "bold", color: big ? C.primary : C.text }}>{value}</div>
            </div>
          ))}
        </div>

        {/* テーブル */}
        <table className="report-table">
          <thead>
            <tr>
              <th style={{ width: "28%" }}>商品名</th>
              <th style={{ width: "12%" }}>メーカー</th>
              <th style={{ width: "10%" }}>棚番号</th>
              <th style={{ width: "8%", textAlign: "right" }}>数量</th>
              <th style={{ width: "14%", textAlign: "right" }}>単価（円）</th>
              <th style={{ width: "14%", textAlign: "right" }}>金額（円）</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ loc, items: groupItems }) => {
              const locTotal = groupItems.reduce((s, i) => s + i.stock_quantity * (prices[i.id] ?? 0), 0)
              return (
                <React.Fragment key={loc}>
                  <tr className="loc-header">
                    <td colSpan={6}>📍 {loc}</td>
                  </tr>
                  {groupItems.map(item => {
                    const price  = prices[item.id] ?? 0
                    const amount = item.stock_quantity * price
                    const unmatched = price === 0
                    return (
                      <tr key={item.id} className={unmatched ? "price-unmatched" : ""}>
                        <td style={{ color: C.text }}>{item.product_name}</td>
                        <td style={{ color: C.sub, fontSize: 11 }}>{item.maker || "—"}</td>
                        <td style={{ color: C.sub, fontSize: 11 }}>{item.shelf_no || "—"}</td>
                        <td style={{ textAlign: "right", fontWeight: "bold" }}>
                          {item.stock_quantity}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <input
                            className="price-input"
                            type="number" min="0" step="1"
                            value={price || ""}
                            placeholder={unmatched ? "要入力" : ""}
                            onChange={e => setPrice(item.id, e.target.value)}
                          />
                        </td>
                        <td style={{ textAlign: "right", fontWeight: amount > 0 ? "bold" : "normal", color: amount > 0 ? C.text : C.sub }}>
                          {amount > 0 ? `¥${amount.toLocaleString()}` : "—"}
                        </td>
                      </tr>
                    )
                  })}
                  <tr className="subtotal-row">
                    <td colSpan={5} style={{ textAlign: "right", fontSize: 12 }}>
                      {loc} 小計
                    </td>
                    <td style={{ textAlign: "right" }}>
                      ¥{locTotal.toLocaleString()}
                    </td>
                  </tr>
                </React.Fragment>
              )
            })}
            <tr className="grand-total-row">
              <td colSpan={5} style={{ textAlign: "right" }}>合計</td>
              <td style={{ textAlign: "right", fontSize: 16 }}>
                ¥{grandTotal.toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>

        <p style={{ textAlign: "right", fontSize: 12, color: C.sub, marginTop: 12 }}>
          ※ 単価は仕入れ値を参照。赤字の項目は手動で単価を入力してください。
        </p>
      </div>
    </>
  )
}
