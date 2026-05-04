"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import Link from "next/link"

// ── 型 ────────────────────────────────────────────────────────────────
type Order = { id: string; clinic_id: string; status: string; created_at: string; total_price: number; delivery_number?: string }
type OrderItem = { id: string; order_id: string; product_id: string; product_name: string | null; quantity: number; price: number }
type Product = { id: string; name: string }
type Clinic = { id: string; name: string }

type TabKey = "monthly" | "clinic" | "product"

// 売上対象とみなすステータス
const SALES_STATUSES = ["納品済み"]

export default function SalesPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [items, setItems] = useState<OrderItem[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>("monthly")
  const [offset, setOffset] = useState(0)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    const [o, i, p, c] = await Promise.all([
      supabase.from("orders").select("*"),
      supabase.from("order_items").select("*"),
      supabase.from("products").select("id,name"),
      supabase.from("clinics").select("id,name"),
    ])
    setOrders(o.data || [])
    setItems(i.data || [])
    setProducts(p.data || [])
    setClinics(c.data || [])
    setLoading(false)
  }

  // 6月開始、5月決算の会計年度
  const fp = useMemo(() => getFP(offset), [offset])
  const pfp = useMemo(() => getFP(offset + 1), [offset])

  const delivered = useMemo(
    () => orders.filter((o) => SALES_STATUSES.includes(o.status)),
    [orders]
  )

  const thisYear = useMemo(
    () => delivered.filter((o) => inRange(o.created_at, fp.start, fp.end)),
    [delivered, fp]
  )
  const prevYear = useMemo(
    () => delivered.filter((o) => inRange(o.created_at, pfp.start, pfp.end)),
    [delivered, pfp]
  )

  const total = sum(thisYear, (o) => o.total_price)
  const totalPrev = sum(prevYear, (o) => o.total_price)
  const yoy = totalPrev > 0 ? Math.round((total / totalPrev - 1) * 100) : null
  const avgOrder = thisYear.length > 0 ? Math.round(total / thisYear.length) : 0
  const validClinicIds = useMemo(() => new Set(clinics.map((c) => c.id)), [clinics])
  const activeClinicCount = useMemo(
    () => new Set(thisYear.filter((o) => validClinicIds.has(o.clinic_id)).map((o) => o.clinic_id)).size,
    [thisYear, validClinicIds]
  )
  const unknownClinicCount = useMemo(
    () => thisYear.filter((o) => !validClinicIds.has(o.clinic_id)).length,
    [thisYear, validClinicIds]
  )

  // 月次（6月～5月）
  const months = ["06","07","08","09","10","11","12","01","02","03","04","05"]
  const monthly = months.map((m) => ({
    month: Number(m) + "月",
    a: sum(thisYear.filter((o) => o.created_at?.slice(5, 7) === m), (o) => o.total_price),
    b: sum(prevYear.filter((o) => o.created_at?.slice(5, 7) === m), (o) => o.total_price),
  }))

  // 医院別
  const clinicName = (id: string) => clinics.find((c) => c.id === id)?.name || "(不明)"
  const byClinic = useMemo(() => {
    const map = new Map<string, { id: string; name: string; a: number; b: number; cnt: number }>()
    clinics.forEach((c) => map.set(c.id, { id: c.id, name: c.name, a: 0, b: 0, cnt: 0 }))
    thisYear.forEach((o) => {
      const e = map.get(o.clinic_id) || { id: o.clinic_id, name: clinicName(o.clinic_id), a: 0, b: 0, cnt: 0 }
      e.a += o.total_price || 0
      e.cnt += 1
      map.set(o.clinic_id, e)
    })
    prevYear.forEach((o) => {
      const e = map.get(o.clinic_id) || { id: o.clinic_id, name: clinicName(o.clinic_id), a: 0, b: 0, cnt: 0 }
      e.b += o.total_price || 0
      map.set(o.clinic_id, e)
    })
    return Array.from(map.values()).filter((c) => c.a > 0 || c.b > 0).sort((a, b) => b.a - a.a)
  }, [thisYear, prevYear, clinics])

  // 商品別（明細を期間でフィルタ）
  const productByName = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products])
  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders])
  const byProduct = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; a: number; b: number }>()
    items.forEach((it) => {
      const o = orderById.get(it.order_id)
      if (!o || !SALES_STATUSES.includes(o.status)) return
      const inThis = inRange(o.created_at, fp.start, fp.end)
      const inPrev = inRange(o.created_at, pfp.start, pfp.end)
      if (!inThis && !inPrev) return
      const name = it.product_name || productByName.get(it.product_id) || "(不明)"
      const e = map.get(name) || { name, qty: 0, a: 0, b: 0 }
      const amount = (it.price || 0) * (it.quantity || 0)
      if (inThis) { e.a += amount; e.qty += it.quantity || 0 }
      if (inPrev) { e.b += amount }
      map.set(name, e)
    })
    return Array.from(map.values()).filter((p) => p.a > 0 || p.b > 0).sort((a, b) => b.a - a.a)
  }, [items, orderById, productByName, fp, pfp])

  // CSV ダウンロード
  function downloadCSV() {
    const rows: string[][] = [
      ["日付", "納品書番号", "医院", "金額", "状態"],
      ...thisYear.map((o) => [
        o.created_at?.slice(0, 10) || "",
        o.delivery_number || "",
        clinicName(o.clinic_id),
        String(o.total_price || 0),
        o.status,
      ]),
    ]
    const csv = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `売上_${fp.label}.csv`
    a.click()
  }

  if (loading) return <main style={page}><p>読み込み中…</p></main>

  return (
    <main style={page}>
      <Link href="/admin"><button style={back}>← 戻る</button></Link>

      <div style={header}>
        <div>
          <h1 style={{ fontSize: 26, margin: 0 }}>売上管理</h1>
          <p style={{ fontSize: 12, color: "#999", margin: "4px 0 0" }}>5月決算（6月～翌5月）</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={downloadCSV} style={btnGray}>CSV</button>
          <select value={offset} onChange={(e) => setOffset(Number(e.target.value))} style={select}>
            {[0, 1, 2].map((o) => <option key={o} value={o}>{getFP(o).label}</option>)}
          </select>
        </div>
      </div>

      {/* KPI */}
      <div style={kpiGrid}>
        <Kpi label="累計売上" val={fmt(total)} sub={yoy !== null ? `前期比 ${yoy >= 0 ? "+" : ""}${yoy}%` : "前期データなし"} />
        <Kpi label="注文件数" val={`${thisYear.length}件`} sub={`前期 ${prevYear.length}件`} />
        <Kpi label="取引医院数" val={`${activeClinicCount}院`} sub={`/ 全${clinics.length}院${unknownClinicCount > 0 ? ` (他に医院不明 ${unknownClinicCount}件)` : ""}`} />
        <Kpi label="平均単価" val={fmt(avgOrder)} sub="" />
      </div>

      {/* タブ */}
      <div style={tabs}>
        {([["monthly", "月次"], ["clinic", "医院別"], ["product", "商品別"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={tab === k ? tabActive : tabBtn}>{l}</button>
        ))}
      </div>

      {/* 月次 */}
      {tab === "monthly" && (
        <table style={table}>
          <thead><tr style={tr}><th style={th}>月</th><th style={thR}>当期</th><th style={thR}>前期</th><th style={thR}>前期比</th></tr></thead>
          <tbody>
            {monthly.map((m) => (
              <tr key={m.month} style={td0(m.a === 0 && m.b === 0)}>
                <td style={td}>{m.month}</td>
                <td style={tdR}>{m.a > 0 ? fmt(m.a) : "—"}</td>
                <td style={tdRSub}>{m.b > 0 ? fmt(m.b) : "—"}</td>
                <td style={tdR}>{yoyBadge(m.a, m.b)}</td>
              </tr>
            ))}
            <tr style={trTotal}>
              <td style={tdBold}>合計</td>
              <td style={tdRBold}>{fmt(total)}</td>
              <td style={tdR}>{fmt(totalPrev)}</td>
              <td style={tdR}>{yoyBadge(total, totalPrev)}</td>
            </tr>
          </tbody>
        </table>
      )}

      {/* 医院別 */}
      {tab === "clinic" && (
        <table style={table}>
          <thead><tr style={tr}><th style={th}>医院名</th><th style={thR}>件数</th><th style={thR}>当期</th><th style={thR}>前期</th><th style={thR}>前期比</th></tr></thead>
          <tbody>
            {byClinic.length === 0 ? (
              <tr><td colSpan={5} style={empty}>データなし</td></tr>
            ) : byClinic.map((c) => (
              <tr key={c.id} style={tr}>
                <td style={tdBold}>{c.name}</td>
                <td style={tdR}>{c.cnt}件</td>
                <td style={tdRBold}>{fmt(c.a)}</td>
                <td style={tdRSub}>{c.b > 0 ? fmt(c.b) : "—"}</td>
                <td style={tdR}>{yoyBadge(c.a, c.b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 商品別 */}
      {tab === "product" && (
        <table style={table}>
          <thead><tr style={tr}><th style={th}>商品名</th><th style={thR}>販売数</th><th style={thR}>当期</th><th style={thR}>前期</th><th style={thR}>前期比</th></tr></thead>
          <tbody>
            {byProduct.length === 0 ? (
              <tr><td colSpan={5} style={empty}>データなし</td></tr>
            ) : byProduct.map((p) => (
              <tr key={p.name} style={tr}>
                <td style={td}>{p.name}</td>
                <td style={tdR}>{p.qty}</td>
                <td style={tdRBold}>{fmt(p.a)}</td>
                <td style={tdRSub}>{p.b > 0 ? fmt(p.b) : "—"}</td>
                <td style={tdR}>{yoyBadge(p.a, p.b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}

// ── 補助関数 ──────────────────────────────────────────────────────────
function Kpi({ label, val, sub }: { label: string; val: string; sub: string }) {
  return (
    <div style={kpiCard}>
      <p style={{ fontSize: 11, color: "#777", margin: 0 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, margin: "4px 0" }}>{val}</p>
      <p style={{ fontSize: 10, color: "#999", margin: 0 }}>{sub}</p>
    </div>
  )
}

function getFP(off: number) {
  const now = new Date()
  const fy = ((now.getMonth() + 1 >= 6) ? now.getFullYear() : now.getFullYear() - 1) - off
  return {
    start: `${fy}-06-01`,
    end: `${fy + 1}-05-31`,
    label: off === 0 ? `当期 ${fy}/6〜${fy + 1}/5` : off === 1 ? `前期 ${fy}/6〜${fy + 1}/5` : `前々期 ${fy}/6〜${fy + 1}/5`,
    fy,
  }
}

function inRange(d: string, start: string, end: string) {
  if (!d) return false
  const ymd = d.slice(0, 10)
  return ymd >= start && ymd <= end
}

function sum<T>(arr: T[], f: (v: T) => number) {
  return arr.reduce((s, v) => s + (f(v) || 0), 0)
}

function fmt(n: number) {
  return "¥" + Number(n || 0).toLocaleString("ja-JP")
}

function csvCell(s: string) {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function yoyBadge(a: number, b: number) {
  if (b === 0) return <span style={{ color: "#ccc", fontSize: 11 }}>—</span>
  const diff = Math.round((a / b - 1) * 100)
  return <span style={{ color: diff >= 0 ? "#111" : "#dc2626", fontSize: 11, fontWeight: 600 }}>{diff >= 0 ? "+" : ""}{diff}%</span>
}

// ── スタイル ──────────────────────────────────────────────────────────
const page: React.CSSProperties = { maxWidth: 960, margin: "0 auto", padding: 20 }
const back: React.CSSProperties = { padding: "6px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", marginBottom: 16, cursor: "pointer" }
const header: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }
const btnGray: React.CSSProperties = { padding: "6px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#f7f7f7", cursor: "pointer", fontSize: 12 }
const select: React.CSSProperties = { padding: "6px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", fontSize: 12 }
const kpiGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 16 }
const kpiCard: React.CSSProperties = { background: "#fff", border: "1px solid #eee", borderRadius: 10, padding: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }
const tabs: React.CSSProperties = { display: "flex", gap: 4, padding: 4, background: "#f3f4f6", borderRadius: 10, width: "fit-content", marginBottom: 12 }
const tabBtn: React.CSSProperties = { padding: "6px 14px", borderRadius: 7, border: "none", background: "transparent", color: "#666", fontSize: 13, cursor: "pointer", fontWeight: 500 }
const tabActive: React.CSSProperties = { ...tabBtn, background: "#fff", color: "#111", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }
const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", background: "#fff", border: "1px solid #eee", borderRadius: 10, overflow: "hidden" }
const tr: React.CSSProperties = { borderTop: "1px solid #f3f4f6" }
const trTotal: React.CSSProperties = { borderTop: "2px solid #ccc", background: "#fafafa" }
const th: React.CSSProperties = { textAlign: "left", padding: "10px 12px", fontSize: 11, color: "#999", textTransform: "uppercase", background: "#fafafa" }
const thR: React.CSSProperties = { ...th, textAlign: "right" }
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13, color: "#333" }
const tdR: React.CSSProperties = { ...td, textAlign: "right" }
const tdRSub: React.CSSProperties = { ...tdR, color: "#777" }
const tdBold: React.CSSProperties = { ...td, fontWeight: 600, color: "#111" }
const tdRBold: React.CSSProperties = { ...tdR, fontWeight: 700, color: "#111" }
const empty: React.CSSProperties = { padding: 32, textAlign: "center", color: "#999", fontSize: 13 }
const td0 = (faded: boolean): React.CSSProperties => faded ? { ...tr, opacity: 0.4 } : tr
