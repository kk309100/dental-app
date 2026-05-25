"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import Link from "next/link"
import { downloadCSV, toCSV } from "@/lib/csv"

type Order = { id: string; clinic_id: string; status: string; created_at: string; delivered_at?: string | null; total_price: number; delivery_number?: string; sales_rep?: string | null }
type OrderItem = { id: string; order_id: string; product_id: string; product_name: string | null; quantity: number; price: number }
type Product = { id: string; name: string; cost: number | null }
type Clinic = { id: string; name: string; sales_rep?: string | null }

type TabKey = "monthly" | "clinic" | "product" | "rep" | "profit" | "abc"

// 「納品済」「納品済み」両方を売上対象として扱う（DB の表記ゆれを吸収）
const SALES_STATUSES = ["納品済み", "納品済"]
const FY_START_KEY = "dental-app:fy_start_month"

export default function SalesPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [items, setItems] = useState<OrderItem[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>("monthly")
  const [offset, setOffset] = useState(0)
  const [fyStartMonth, setFyStartMonth] = useState(6) // 6 = June
  const [taxIncluded, setTaxIncluded] = useState(true)

  useEffect(() => {
    if (typeof window === "undefined") return
    const saved = localStorage.getItem(FY_START_KEY)
    if (saved) setFyStartMonth(Number(saved))
  }, [])

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    const [o, i, p, c] = await Promise.all([
      supabase.from("orders").select("id,clinic_id,status,created_at,delivered_at,total_price,delivery_number,sales_rep").limit(50000),
      supabase.from("order_items").select("id,order_id,product_id,product_name,quantity,price").limit(50000),
      supabase.from("products").select("id,name,cost").limit(50000),
      supabase.from("clinics").select("id,name,sales_rep").limit(50000),
    ])
    setOrders((o.data as Order[]) || [])
    setItems((i.data as OrderItem[]) || [])
    setProducts((p.data as Product[]) || [])
    setClinics((c.data as Clinic[]) || [])
    setLoading(false)
  }

  function changeFyStart(m: number) {
    setFyStartMonth(m)
    if (typeof window !== "undefined") localStorage.setItem(FY_START_KEY, String(m))
  }

  // 会計年度の期間計算（fyStartMonth ベース）
  const fp = useMemo(() => getFP(offset, fyStartMonth), [offset, fyStartMonth])
  const pfp = useMemo(() => getFP(offset + 1, fyStartMonth), [offset, fyStartMonth])

  const delivered = useMemo(
    () => orders.filter((o) => SALES_STATUSES.includes(o.status)),
    [orders]
  )

  // 売上日: delivered_at 優先、なければ created_at
  const salesDate = (o: Order) => (o.delivered_at || o.created_at).slice(0, 10)
  const adjust = (n: number) => taxIncluded ? n : Math.round(n / 1.10)

  const thisYear = useMemo(
    () => delivered.filter((o) => inRange(salesDate(o), fp.start, fp.end)),
    [delivered, fp]
  )
  const prevYear = useMemo(
    () => delivered.filter((o) => inRange(salesDate(o), pfp.start, pfp.end)),
    [delivered, pfp]
  )

  const total = sum(thisYear, (o) => adjust(o.total_price))
  const totalPrev = sum(prevYear, (o) => adjust(o.total_price))
  const yoy = totalPrev > 0 ? Math.round((total / totalPrev - 1) * 100) : null
  const avgOrder = thisYear.length > 0 ? Math.round(total / thisYear.length) : 0

  const validClinicIds = useMemo(() => new Set(clinics.map((c) => c.id)), [clinics])
  const activeClinicCount = useMemo(
    () => new Set(thisYear.filter((o) => validClinicIds.has(o.clinic_id)).map((o) => o.clinic_id)).size,
    [thisYear, validClinicIds]
  )

  // 月次（fyStartMonth から12カ月）
  const monthList = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const m = ((fyStartMonth - 1 + i) % 12) + 1
    return String(m).padStart(2, "0")
  }), [fyStartMonth])

  const monthly = monthList.map((m) => ({
    month: Number(m) + "月",
    monthKey: m,
    a: sum(thisYear.filter((o) => salesDate(o).slice(5, 7) === m), (o) => adjust(o.total_price)),
    b: sum(prevYear.filter((o) => salesDate(o).slice(5, 7) === m), (o) => adjust(o.total_price)),
    cnt: thisYear.filter((o) => salesDate(o).slice(5, 7) === m).length,
  }))

  // 医院別
  const clinicById = useMemo(() => new Map(clinics.map(c => [c.id, c])), [clinics])
  const clinicName = (id: string) => clinicById.get(id)?.name || "(削除済み)"
  const byClinic = useMemo(() => {
    const map = new Map<string, { id: string; name: string; rep?: string | null; a: number; b: number; cnt: number }>()
    clinics.forEach((c) => map.set(c.id, { id: c.id, name: c.name, rep: c.sales_rep, a: 0, b: 0, cnt: 0 }))
    thisYear.forEach((o) => {
      const e = map.get(o.clinic_id) || { id: o.clinic_id, name: clinicName(o.clinic_id), a: 0, b: 0, cnt: 0 }
      e.a += adjust(o.total_price || 0); e.cnt += 1
      map.set(o.clinic_id, e)
    })
    prevYear.forEach((o) => {
      const e = map.get(o.clinic_id) || { id: o.clinic_id, name: clinicName(o.clinic_id), a: 0, b: 0, cnt: 0 }
      e.b += adjust(o.total_price || 0)
      map.set(o.clinic_id, e)
    })
    return Array.from(map.values()).filter((c) => c.a > 0 || c.b > 0).sort((a, b) => b.a - a.a)
  }, [thisYear, prevYear, clinics])

  // 商品別 + 粗利
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders])
  const byProduct = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; a: number; b: number; cost: number; profit: number }>()
    items.forEach((it) => {
      const o = orderById.get(it.order_id)
      if (!o || !SALES_STATUSES.includes(o.status)) return
      const sd = salesDate(o)
      const inThis = inRange(sd, fp.start, fp.end)
      const inPrev = inRange(sd, pfp.start, pfp.end)
      if (!inThis && !inPrev) return
      const product = it.product_id ? productById.get(it.product_id) : null
      const name = it.product_name || product?.name || "(不明)"
      const cost = Number(product?.cost || 0)
      const e = map.get(name) || { name, qty: 0, a: 0, b: 0, cost: 0, profit: 0 }
      const amount = adjust((it.price || 0) * (it.quantity || 0))
      const totalCost = cost * (it.quantity || 0)
      if (inThis) { e.a += amount; e.qty += it.quantity || 0; e.cost += totalCost; e.profit += amount - totalCost }
      if (inPrev) { e.b += amount }
      map.set(name, e)
    })
    return Array.from(map.values()).filter((p) => p.a > 0 || p.b > 0).sort((a, b) => b.a - a.a)
  }, [items, orderById, productById, fp, pfp, taxIncluded])

  // 営業マン別（orders.sales_rep 優先、なければ clinics.sales_rep）
  const byRep = useMemo(() => {
    const map = new Map<string, { name: string; a: number; b: number; cnt: number; clinicCount: Set<string> }>()
    thisYear.forEach((o) => {
      const rep = o.sales_rep || clinicById.get(o.clinic_id)?.sales_rep || "(未設定)"
      const e = map.get(rep) || { name: rep, a: 0, b: 0, cnt: 0, clinicCount: new Set() }
      e.a += adjust(o.total_price || 0); e.cnt += 1; e.clinicCount.add(o.clinic_id)
      map.set(rep, e)
    })
    prevYear.forEach((o) => {
      const rep = o.sales_rep || clinicById.get(o.clinic_id)?.sales_rep || "(未設定)"
      const e = map.get(rep) || { name: rep, a: 0, b: 0, cnt: 0, clinicCount: new Set() }
      e.b += adjust(o.total_price || 0)
      map.set(rep, e)
    })
    return Array.from(map.values()).map(e => ({ ...e, clinicCount: e.clinicCount.size })).filter(e => e.a > 0 || e.b > 0).sort((a, b) => b.a - a.a)
  }, [thisYear, prevYear, clinicById])

  // 粗利集計
  const totalGross = useMemo(() => byProduct.reduce((s, p) => s + p.a, 0), [byProduct])
  const totalCost = useMemo(() => byProduct.reduce((s, p) => s + p.cost, 0), [byProduct])
  const totalProfit = useMemo(() => byProduct.reduce((s, p) => s + p.profit, 0), [byProduct])
  const profitMargin = totalGross > 0 ? Math.round((totalProfit / totalGross) * 100) : 0

  // ABC分析（商品別 + 医院別）
  function abcClassify<T extends { name: string; a: number }>(arr: T[]) {
    const total = arr.reduce((s, x) => s + x.a, 0)
    let cum = 0
    return arr.map(x => {
      cum += x.a
      const ratio = total > 0 ? x.a / total : 0
      const cumRatio = total > 0 ? cum / total : 0
      const cls = cumRatio <= 0.7 ? "A" : cumRatio <= 0.9 ? "B" : "C"
      return { ...x, ratio, cumRatio, cls }
    })
  }
  const abcProducts = useMemo(() => abcClassify(byProduct), [byProduct])
  const abcClinics = useMemo(() => abcClassify(byClinic), [byClinic])

  function exportSalesCSV() {
    const csv = toCSV(
      thisYear.map((o) => ({
        日付: salesDate(o),
        納品書番号: o.delivery_number || "",
        医院名: clinicName(o.clinic_id),
        営業担当: o.sales_rep || clinicById.get(o.clinic_id)?.sales_rep || "",
        金額: adjust(o.total_price || 0),
        税区分: taxIncluded ? "税込" : "税抜",
        状態: o.status,
      })),
      ["日付", "納品書番号", "医院名", "営業担当", "金額", "税区分", "状態"]
    )
    downloadCSV(`売上_${fp.label}.csv`, csv)
  }

  // 弥生会計向け仕訳CSV（売上計上の借方/貸方フォーマット）
  function exportYayoiCSV() {
    // 日付,借方科目,借方金額,貸方科目,貸方金額,摘要
    const rows = thisYear.map((o) => {
      const date = salesDate(o).replace(/-/g, "/")
      const amount = adjust(o.total_price || 0)
      const memo = `${clinicName(o.clinic_id)} ${o.delivery_number || ""}`.trim()
      return { 日付: date, 借方科目: "売掛金", 借方金額: amount, 貸方科目: "売上高", 貸方金額: amount, 摘要: memo }
    })
    const csv = toCSV(rows, ["日付", "借方科目", "借方金額", "貸方科目", "貸方金額", "摘要"])
    downloadCSV(`仕訳_弥生_${fp.label}.csv`, csv)
  }

  if (loading) return <main style={page}><p>読み込み中…</p></main>

  return (
    <main style={page}>
      <Link href="/admin"><button style={back}>← 戻る</button></Link>

      <div style={header}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: 0 }}>売上管理</h1>
          <p style={{ fontSize: 12, color: "#999", margin: "4px 0 0" }}>
            会計年度: {fyStartMonth}月開始 ・ 売上計上: {SALES_STATUSES.join("/")} ステータス時 ・ 売上日: 納品日(無ければ受注日)
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select value={fyStartMonth} onChange={(e) => changeFyStart(Number(e.target.value))} style={select} title="決算開始月">
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}月開始</option>)}
          </select>
          <select value={taxIncluded ? "1" : "0"} onChange={(e) => setTaxIncluded(e.target.value === "1")} style={select}>
            <option value="1">税込</option>
            <option value="0">税抜</option>
          </select>
          <select value={offset} onChange={(e) => setOffset(Number(e.target.value))} style={select}>
            {[0, 1, 2, 3].map((o) => <option key={o} value={o}>{getFP(o, fyStartMonth).label}</option>)}
          </select>
          <button onClick={exportSalesCSV} style={btnGray}>📤 CSV</button>
          <button onClick={exportYayoiCSV} style={btnGray}>📤 弥生仕訳</button>
        </div>
      </div>

      {/* KPI */}
      <div style={kpiGrid}>
        <Kpi label="売上" val={fmt(total)} sub={yoy !== null ? `前期比 ${yoy >= 0 ? "+" : ""}${yoy}%` : "前期データなし"} />
        <Kpi label="注文件数" val={`${thisYear.length}件`} sub={`前期 ${prevYear.length}件`} />
        <Kpi label="取引医院数" val={`${activeClinicCount}院`} sub={`/ 全${clinics.length}院`} />
        <Kpi label="平均単価" val={fmt(avgOrder)} sub="" />
        <Kpi label="粗利" val={fmt(totalProfit)} sub={`粗利率 ${profitMargin}%`} />
      </div>

      <div style={tabs}>
        {([["monthly", "📅 月次"], ["clinic", "🏥 医院別"], ["product", "📦 商品別"], ["rep", "👤 営業マン別"], ["profit", "💰 粗利分析"], ["abc", "📊 ABC分析"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={tab === k ? tabActive : tabBtn}>{l}</button>
        ))}
      </div>

      {tab === "monthly" && (
        <table style={table}>
          <thead><tr style={tr}><th style={th}>月</th><th style={thR}>件数</th><th style={thR}>当期</th><th style={thR}>前期</th><th style={thR}>前期比</th></tr></thead>
          <tbody>
            {monthly.map((m) => (
              <tr key={m.month} style={td0(m.a === 0 && m.b === 0)}>
                <td style={td}>{m.month}</td>
                <td style={tdR}>{m.cnt > 0 ? `${m.cnt}件` : "—"}</td>
                <td style={tdR}>{m.a > 0 ? fmt(m.a) : "—"}</td>
                <td style={tdRSub}>{m.b > 0 ? fmt(m.b) : "—"}</td>
                <td style={tdR}>{yoyBadge(m.a, m.b)}</td>
              </tr>
            ))}
            <tr style={trTotal}>
              <td style={tdBold}>合計</td>
              <td style={tdR}>{thisYear.length}件</td>
              <td style={tdRBold}>{fmt(total)}</td>
              <td style={tdR}>{fmt(totalPrev)}</td>
              <td style={tdR}>{yoyBadge(total, totalPrev)}</td>
            </tr>
          </tbody>
        </table>
      )}

      {tab === "clinic" && (
        <table style={table}>
          <thead><tr style={tr}><th style={th}>医院名</th><th style={th}>担当</th><th style={thR}>件数</th><th style={thR}>当期</th><th style={thR}>前期</th><th style={thR}>前期比</th></tr></thead>
          <tbody>
            {byClinic.length === 0 ? (
              <tr><td colSpan={6} style={empty}>データなし</td></tr>
            ) : byClinic.map((c) => {
              const isNew = c.b === 0 && c.a > 0
              const isLost = c.a === 0 && c.b > 0
              return (
                <tr key={c.id} style={tr}>
                  <td style={tdBold}>
                    {c.name}
                    {isNew && <span style={badgeNew}>NEW</span>}
                    {isLost && <span style={badgeLost}>離脱</span>}
                  </td>
                  <td style={tdSub}>{c.rep || "—"}</td>
                  <td style={tdR}>{c.cnt}件</td>
                  <td style={tdRBold}>{fmt(c.a)}</td>
                  <td style={tdRSub}>{c.b > 0 ? fmt(c.b) : "—"}</td>
                  <td style={tdR}>{isNew ? <span style={{ ...badgeNew, marginLeft: 0 }}>NEW</span> : yoyBadge(c.a, c.b)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {tab === "product" && (
        <table style={table}>
          <thead><tr style={tr}><th style={th}>商品名</th><th style={thR}>販売数</th><th style={thR}>当期売上</th><th style={thR}>原価</th><th style={thR}>粗利</th><th style={thR}>粗利率</th></tr></thead>
          <tbody>
            {byProduct.length === 0 ? (
              <tr><td colSpan={6} style={empty}>データなし</td></tr>
            ) : byProduct.map((p) => {
              const margin = p.a > 0 ? Math.round((p.profit / p.a) * 100) : 0
              return (
                <tr key={p.name} style={tr}>
                  <td style={td}>{p.name}</td>
                  <td style={tdR}>{p.qty}</td>
                  <td style={tdRBold}>{fmt(p.a)}</td>
                  <td style={tdRSub}>{p.cost > 0 ? fmt(p.cost) : "—"}</td>
                  <td style={tdR}><span style={{ color: p.profit >= 0 ? "#10b981" : "#dc2626", fontWeight: 700 }}>{fmt(p.profit)}</span></td>
                  <td style={tdR}><span style={{ color: margin >= 30 ? "#10b981" : margin >= 15 ? "#f59e0b" : "#dc2626", fontWeight: 600, fontSize: 13 }}>{p.cost > 0 ? `${margin}%` : "—"}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {tab === "rep" && (
        <table style={table}>
          <thead><tr style={tr}><th style={th}>営業マン</th><th style={thR}>担当医院数</th><th style={thR}>件数</th><th style={thR}>当期</th><th style={thR}>前期</th><th style={thR}>前期比</th></tr></thead>
          <tbody>
            {byRep.length === 0 ? (
              <tr><td colSpan={6} style={empty}>データなし</td></tr>
            ) : byRep.map(r => (
              <tr key={r.name} style={tr}>
                <td style={tdBold}>{r.name}</td>
                <td style={tdR}>{r.clinicCount}院</td>
                <td style={tdR}>{r.cnt}件</td>
                <td style={tdRBold}>{fmt(r.a)}</td>
                <td style={tdRSub}>{r.b > 0 ? fmt(r.b) : "—"}</td>
                <td style={tdR}>{yoyBadge(r.a, r.b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === "profit" && (
        <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 10, padding: 20 }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700 }}>粗利分析サマリ</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <Kpi label="売上合計" val={fmt(totalGross)} sub="" />
            <Kpi label="原価合計" val={fmt(totalCost)} sub="" />
            <Kpi label="粗利" val={fmt(totalProfit)} sub={`${profitMargin}%`} />
          </div>
          <p style={{ marginTop: 16, fontSize: 12, color: "#777" }}>
            ※ 原価は商品マスタの cost 値を使用。仕入価格が登録されていない商品の粗利は売上額そのまま（原価0扱い）になります。<br />
            ※ パラジウム等の特殊商品は仕入価格が日替わりするため、別途 stock_receipts や palladium_prices を参照する詳細粗利は今後対応予定。
          </p>
          <h3 style={{ margin: "20px 0 10px", fontSize: 14 }}>赤字商品（粗利マイナス）</h3>
          {byProduct.filter(p => p.cost > 0 && p.profit < 0).length === 0 ? (
            <p style={{ fontSize: 12, color: "#999" }}>赤字商品なし 🎉</p>
          ) : (
            <table style={{ ...table, marginTop: 0 }}>
              <thead><tr style={tr}><th style={th}>商品名</th><th style={thR}>販売数</th><th style={thR}>売上</th><th style={thR}>原価</th><th style={thR}>赤字額</th></tr></thead>
              <tbody>
                {byProduct.filter(p => p.cost > 0 && p.profit < 0).slice(0, 20).map(p => (
                  <tr key={p.name} style={tr}>
                    <td style={td}>{p.name}</td>
                    <td style={tdR}>{p.qty}</td>
                    <td style={tdR}>{fmt(p.a)}</td>
                    <td style={tdR}>{fmt(p.cost)}</td>
                    <td style={tdR}><span style={{ color: "#dc2626", fontWeight: 700 }}>{fmt(p.profit)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "abc" && (
        <div className="space-y-3">
          <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 10, padding: 16 }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>📦 商品ABC分析</h2>
            <p style={{ fontSize: 13, color: "#777", margin: "0 0 12px" }}>
              累積売上比率で分類: <span style={{ color: "#dc2626", fontWeight: 700 }}>A=70%</span>{"<"}
              <span style={{ color: "#f59e0b", fontWeight: 700 }}>B=90%</span>{"<"}
              <span style={{ color: "#9ca3af", fontWeight: 700 }}>C=残り</span>
              ・パレート: A商品に集中投資、C商品は廃番候補
            </p>
            <table style={table}>
              <thead><tr style={tr}>
                <th style={{ ...th, width: 50, textAlign: "center" }}>分類</th>
                <th style={th}>商品名</th>
                <th style={thR}>売上</th>
                <th style={thR}>構成比</th>
                <th style={thR}>累積比</th>
              </tr></thead>
              <tbody>
                {abcProducts.length === 0 ? (
                  <tr><td colSpan={5} style={empty}>データなし</td></tr>
                ) : abcProducts.slice(0, 100).map(p => (
                  <tr key={p.name} style={tr}>
                    <td style={{ ...td, textAlign: "center" }}>
                      <span style={{ display: "inline-block", width: 20, padding: "2px 6px", borderRadius: 4, background: p.cls === "A" ? "#fee2e2" : p.cls === "B" ? "#fef3c7" : "#f3f4f6", color: p.cls === "A" ? "#dc2626" : p.cls === "B" ? "#92400e" : "#6b7280", fontSize: 12, fontWeight: 700 }}>{p.cls}</span>
                    </td>
                    <td style={td}>{p.name}</td>
                    <td style={tdRBold}>{fmt(p.a)}</td>
                    <td style={tdR}>{(p.ratio * 100).toFixed(1)}%</td>
                    <td style={tdRSub}>{(p.cumRatio * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 10, padding: 16 }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>🏥 医院ABC分析</h2>
            <p style={{ fontSize: 13, color: "#777", margin: "0 0 12px" }}>A=主要顧客、C=取引縮小傾向</p>
            <table style={table}>
              <thead><tr style={tr}>
                <th style={{ ...th, width: 50, textAlign: "center" }}>分類</th>
                <th style={th}>医院名</th>
                <th style={thR}>売上</th>
                <th style={thR}>構成比</th>
                <th style={thR}>累積比</th>
              </tr></thead>
              <tbody>
                {abcClinics.length === 0 ? (
                  <tr><td colSpan={5} style={empty}>データなし</td></tr>
                ) : abcClinics.slice(0, 100).map(c => (
                  <tr key={c.id} style={tr}>
                    <td style={{ ...td, textAlign: "center" }}>
                      <span style={{ display: "inline-block", width: 20, padding: "2px 6px", borderRadius: 4, background: c.cls === "A" ? "#fee2e2" : c.cls === "B" ? "#fef3c7" : "#f3f4f6", color: c.cls === "A" ? "#dc2626" : c.cls === "B" ? "#92400e" : "#6b7280", fontSize: 12, fontWeight: 700 }}>{c.cls}</span>
                    </td>
                    <td style={tdBold}>{c.name}</td>
                    <td style={tdRBold}>{fmt(c.a)}</td>
                    <td style={tdR}>{(c.ratio * 100).toFixed(1)}%</td>
                    <td style={tdRSub}>{(c.cumRatio * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  )
}

function Kpi({ label, val, sub }: { label: string; val: string; sub: string }) {
  return (
    <div style={kpiCard}>
      <p style={{ fontSize: 13, color: "#777", margin: 0 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, margin: "4px 0" }}>{val}</p>
      <p style={{ fontSize: 10, color: "#999", margin: 0 }}>{sub}</p>
    </div>
  )
}

function getFP(off: number, fyStartMonth: number) {
  const now = new Date()
  const isAfterFyStart = (now.getMonth() + 1) >= fyStartMonth
  const fy = (isAfterFyStart ? now.getFullYear() : now.getFullYear() - 1) - off
  const startM = String(fyStartMonth).padStart(2, "0")
  const endY = fyStartMonth === 1 ? fy : fy + 1
  const endM = String(((fyStartMonth - 2 + 12) % 12) + 1).padStart(2, "0")
  // 終了月の月末を計算
  const endDate = new Date(endY, Number(endM), 0).getDate()
  return {
    start: `${fy}-${startM}-01`,
    end: `${endY}-${endM}-${endDate}`,
    label: off === 0 ? `当期 ${fy}/${fyStartMonth}〜${endY}/${Number(endM)}` : off === 1 ? `前期 ${fy}/${fyStartMonth}〜${endY}/${Number(endM)}` : `前${off}期 ${fy}/${fyStartMonth}〜${endY}/${Number(endM)}`,
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

function yoyBadge(a: number, b: number) {
  if (b === 0 && a > 0) return <span style={{ color: "#10b981", fontSize: 13, fontWeight: 700 }}>NEW</span>
  if (b === 0) return <span style={{ color: "#ccc", fontSize: 13 }}>—</span>
  const diff = Math.round((a / b - 1) * 100)
  return <span style={{ color: diff >= 0 ? "#10b981" : "#dc2626", fontSize: 13, fontWeight: 600 }}>{diff >= 0 ? "+" : ""}{diff}%</span>
}

const page: React.CSSProperties = { maxWidth: 1100, margin: "0 auto", padding: 20 }
const back: React.CSSProperties = { padding: "6px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", marginBottom: 16, cursor: "pointer" }
const header: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }
const btnGray: React.CSSProperties = { padding: "6px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#f7f7f7", cursor: "pointer", fontSize: 12 }
const select: React.CSSProperties = { padding: "6px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", fontSize: 12 }
const kpiGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 16 }
const kpiCard: React.CSSProperties = { background: "#fff", border: "1px solid #eee", borderRadius: 10, padding: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }
const tabs: React.CSSProperties = { display: "flex", gap: 4, padding: 4, background: "#f3f4f6", borderRadius: 10, width: "fit-content", marginBottom: 12, flexWrap: "wrap" }
const tabBtn: React.CSSProperties = { padding: "6px 14px", borderRadius: 7, border: "none", background: "transparent", color: "#666", fontSize: 13, cursor: "pointer", fontWeight: 500 }
const tabActive: React.CSSProperties = { ...tabBtn, background: "#fff", color: "#111", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }
const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", background: "#fff", border: "1px solid #eee", borderRadius: 10, overflow: "hidden" }
const tr: React.CSSProperties = { borderTop: "1px solid #f3f4f6" }
const trTotal: React.CSSProperties = { borderTop: "2px solid #ccc", background: "#fafafa" }
const th: React.CSSProperties = { textAlign: "left", padding: "10px 12px", fontSize: 12, color: "#999", textTransform: "uppercase", background: "#fafafa" }
const thR: React.CSSProperties = { ...th, textAlign: "right" }
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13, color: "#333" }
const tdR: React.CSSProperties = { ...td, textAlign: "right" }
const tdSub: React.CSSProperties = { ...td, color: "#777", fontSize: 13 }
const tdRSub: React.CSSProperties = { ...tdR, color: "#777" }
const tdBold: React.CSSProperties = { ...td, fontWeight: 600, color: "#111" }
const tdRBold: React.CSSProperties = { ...tdR, fontWeight: 700, color: "#111" }
const empty: React.CSSProperties = { padding: 32, textAlign: "center", color: "#999", fontSize: 13 }
const td0 = (faded: boolean): React.CSSProperties => faded ? { ...tr, opacity: 0.4 } : tr
const badgeNew: React.CSSProperties = { marginLeft: 8, padding: "1px 6px", background: "#dcfce7", color: "#15803d", fontSize: 9, fontWeight: 700, borderRadius: 99 }
const badgeLost: React.CSSProperties = { marginLeft: 8, padding: "1px 6px", background: "#fee2e2", color: "#b91c1c", fontSize: 9, fontWeight: 700, borderRadius: 99 }
