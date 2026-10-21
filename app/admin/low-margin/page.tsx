"use client"

// 利益チェック: 仕入れ値（仕入の記録＝仕入請求書・仕入納品の単価）を正として、売上の利益を計算し、
// 利益がマイナス、または、利益率が基準（初期 5%）未満の売上明細を抜き出す。
// 仕入れ値の決め方（商品ごと）: 売上日以前で、いちばん新しい入荷の単価 → 無ければ、売上日より後で、いちばん古い入荷の単価 → 無ければ、商品の「仕入価格」。
import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { fetchAll, fetchAllData, fetchInChunks } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { downloadCSV, toCSV } from "@/lib/csv"

type Order = { id: string; clinic_id: string; status: string; created_at: string; delivered_at: string | null; delivery_number: string | null }
type Item = { id: string; order_id: string; product_id: string | null; product_name: string | null; quantity: number; price: number }
type Product = { id: string; name: string; cost: number | null; stock_managed: boolean | null }
type Receipt = { product_id: string; unit_price: number | null; created_at: string; supplier_id: string | null }
type Row = {
  key: string; date: string; slip: string; clinic: string; product: string; qty: number; price: number
  cost: number | null; costSource: string; profit: number | null; rate: number | null
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const DELIVERED = ["納品済み", "納品済"]

export default function LowMarginPage() {
  const today = new Date()
  const [from, setFrom] = useState(ymd(new Date(today.getFullYear(), today.getMonth(), 1)))
  const [to, setTo] = useState(ymd(today))
  const [threshold, setThreshold] = useState("5")
  const [clinicId, setClinicId] = useState("all")
  const [showUnknown, setShowUnknown] = useState(false)
  const [excludeNoStock, setExcludeNoStock] = useState(true)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [clinics, setClinics] = useState<{ id: string; name: string }[]>([])

  useEffect(() => { fetchAll("clinics", "id,name", (q: any) => q.order("id")).then((c: any[]) => setClinics(c.slice().sort((a, b) => a.name.localeCompare(b.name, "ja")))) }, [])

  async function load() {
    setLoading(true); setLoaded(false)
    // 売上日は「納品日（無ければ受注日）」。受注日が納品日より前のことがあるので、期間の前も少し広めに読む
    const back = new Date(from + "T00:00:00"); back.setDate(back.getDate() - 90)
    const { data: orders } = await fetchAllData("orders", "id,clinic_id,status,created_at,delivered_at,delivery_number", (q: any) => q.gte("created_at", ymd(back)))
    const inPeriod = (orders as Order[]).filter(o => {
      if (!DELIVERED.includes(o.status)) return false
      if (clinicId !== "all" && o.clinic_id !== clinicId) return false
      const d = String(o.delivered_at || o.created_at).slice(0, 10)
      return d >= from && d <= to
    })
    const orderById = new Map(inPeriod.map(o => [o.id, o]))
    const { data: items } = await fetchInChunks("order_items", "id,order_id,product_id,product_name,quantity,price", "order_id", inPeriod.map(o => o.id))
    const its = (items as Item[]).filter(i => orderById.has(i.order_id))
    const pids = Array.from(new Set(its.map(i => i.product_id).filter(Boolean) as string[]))
    const [{ data: prods }, { data: recs }, sups] = await Promise.all([
      fetchInChunks("products", "id,name,cost,stock_managed", "id", pids),
      fetchInChunks("stock_receipts", "product_id,unit_price,created_at,supplier_id", "product_id", pids),
      fetchAll("suppliers", "id,name"),
    ])
    const prodById = new Map((prods as Product[]).map(p => [p.id, p]))
    const supName = new Map((sups as { id: string; name: string }[]).map(s => [s.id, s.name]))
    const recByProduct = new Map<string, Receipt[]>()
    for (const r of recs as Receipt[]) { if (!(Number(r.unit_price) > 0)) continue; if (!recByProduct.has(r.product_id)) recByProduct.set(r.product_id, []); recByProduct.get(r.product_id)!.push(r) }
    recByProduct.forEach(arr => arr.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))))
    const clinicName = new Map(clinics.map(c => [c.id, c.name]))

    const out: Row[] = []
    for (const it of its) {
      const o = orderById.get(it.order_id)!
      const saleDate = String(o.delivered_at || o.created_at).slice(0, 10)
      const price = Number(it.price || 0), qty = Number(it.quantity || 0)
      const p = it.product_id ? prodById.get(it.product_id) : null
      let cost: number | null = null, source = "仕入値なし（商品が未紐づき）"
      if (p) {
        const arr = it.product_id ? recByProduct.get(it.product_id) || [] : []
        const before = arr.filter(r => String(r.created_at).slice(0, 10) <= saleDate)
        const pick = before.length ? before[before.length - 1] : arr[0]
        if (pick) { cost = Number(pick.unit_price); source = `入荷 ${String(pick.created_at).slice(0, 10)}${pick.supplier_id ? " " + (supName.get(pick.supplier_id) || "") : ""}${before.length ? "" : "（売上日より後の入荷）"}` }
        else if (Number(p.cost) > 0) { cost = Number(p.cost); source = "商品の仕入価格（入荷の記録なし）" }
        else source = "仕入値なし（入荷の記録も、仕入価格もなし）"
        if (excludeNoStock && p.stock_managed === false) continue
      }
      const profit = cost == null ? null : (price - cost) * qty
      const rate = cost == null || price <= 0 ? (cost != null && price <= 0 ? -100 : null) : ((price - cost) / price) * 100
      out.push({ key: it.id, date: saleDate, slip: o.delivery_number || o.id.slice(0, 8), clinic: clinicName.get(o.clinic_id) || "", product: it.product_name || p?.name || "(商品名なし)", qty, price, cost, costSource: source, profit, rate })
    }
    out.sort((a, b) => a.date.localeCompare(b.date) || a.slip.localeCompare(b.slip))
    setRows(out); setLoaded(true); setLoading(false)
  }

  const th = Number(threshold)
  const lowRows = useMemo(() => rows.filter(r => r.rate != null && r.rate < th), [rows, th])
  const unknownRows = useMemo(() => rows.filter(r => r.rate == null), [rows])
  const shown = showUnknown ? [...lowRows, ...unknownRows].sort((a, b) => a.date.localeCompare(b.date) || a.slip.localeCompare(b.slip)) : lowRows
  const negTotal = lowRows.filter(r => (r.profit ?? 0) < 0).reduce((s, r) => s + (r.profit ?? 0), 0)

  function exportCSV() {
    const csv = toCSV(shown.map(r => ({
      売上日: r.date, 伝票: r.slip, 医院: r.clinic, 商品名: r.product, 数量: r.qty, 売単価: r.price, 仕入値: r.cost ?? "", 利益額: r.profit ?? "",
      利益率: r.rate == null ? "" : r.rate.toFixed(1) + "%", 仕入値の出どころ: r.costSource,
    })), ["売上日", "伝票", "医院", "商品名", "数量", "売単価", "仕入値", "利益額", "利益率", "仕入値の出どころ"])
    downloadCSV(`利益チェック_${from}_${to}.csv`, csv)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center flex-wrap gap-2">
        <h1 className="font-bold text-gray-900" style={{ fontSize: 20 }}>利益チェック</h1>
        <span className="text-xs text-gray-500">仕入れ値を正として、利益がマイナス・基準未満の売上を抜き出します</span>
        <Link href="/admin/sales" className="ml-auto text-xs text-blue-600 underline">売上管理へ</Link>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-3 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-0.5"><span className="text-[11px] text-gray-500">売上日（から）</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-2 py-1 border border-gray-200 rounded" /></label>
        <label className="flex flex-col gap-0.5"><span className="text-[11px] text-gray-500">売上日（まで）</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-2 py-1 border border-gray-200 rounded" /></label>
        <label className="flex flex-col gap-0.5"><span className="text-[11px] text-gray-500">利益率の基準（％未満を抜き出す）</span>
          <input type="number" value={threshold} onChange={e => setThreshold(e.target.value)} className="px-2 py-1 border border-gray-200 rounded w-24 text-right" /></label>
        <label className="flex flex-col gap-0.5"><span className="text-[11px] text-gray-500">医院</span>
          <select value={clinicId} onChange={e => setClinicId(e.target.value)} className="px-2 py-1 border border-gray-200 rounded max-w-[220px]">
            <option value="all">すべて</option>
            {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <label className="flex items-center gap-1 text-xs text-gray-600"><input type="checkbox" checked={excludeNoStock} onChange={e => setExcludeNoStock(e.target.checked)} />「在庫管理しない」商品（パソコン関係など）を除く</label>
        <button onClick={load} disabled={loading} className="px-4 py-1.5 bg-blue-600 text-white font-bold rounded hover:bg-blue-700 disabled:bg-gray-300">{loading ? "計算中…" : "チェックする"}</button>
      </div>

      {loaded && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>売上の明細 <b>{rows.length.toLocaleString()}</b> 行のうち、<b className="text-red-600">{lowRows.length.toLocaleString()}</b> 行が、利益率 {th}% 未満</span>
            <span className="text-gray-500">（マイナス利益の合計 <b className="text-red-600">{fmtYen(negTotal)}</b>）</span>
            <span className="text-gray-400">仕入値が分からない行: {unknownRows.length}</span>
            <label className="flex items-center gap-1 text-xs text-gray-600"><input type="checkbox" checked={showUnknown} onChange={e => setShowUnknown(e.target.checked)} />仕入値が分からない行も表示</label>
            <button onClick={exportCSV} disabled={shown.length === 0} className="ml-auto px-3 py-1.5 bg-white border border-gray-200 rounded text-sm hover:bg-gray-50 disabled:opacity-40">📤 CSV出力</button>
          </div>
          <div className="bg-white rounded border border-gray-200 overflow-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
            <table className="w-full text-[12px]" style={{ borderCollapse: "collapse", minWidth: 980 }}>
              <thead className="sticky top-0 bg-gray-100">
                <tr className="text-gray-700 font-bold border-b-2 border-gray-300">
                  <th className="px-2 py-1.5 text-left">売上日</th><th className="px-2 py-1.5 text-left">伝票</th><th className="px-2 py-1.5 text-left">医院</th>
                  <th className="px-2 py-1.5 text-left">商品名</th><th className="px-2 py-1.5 text-right">数量</th><th className="px-2 py-1.5 text-right">売単価</th>
                  <th className="px-2 py-1.5 text-right">仕入値</th><th className="px-2 py-1.5 text-right">利益額</th><th className="px-2 py-1.5 text-right">利益率</th>
                  <th className="px-2 py-1.5 text-left">仕入値の出どころ</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">基準未満の売上は、ありません</td></tr>
                ) : shown.slice(0, 1500).map(r => (
                  <tr key={r.key} className="border-b border-gray-100 hover:bg-blue-50/40">
                    <td className="px-2 py-1 whitespace-nowrap">{r.date}</td>
                    <td className="px-2 py-1 font-mono text-gray-600 whitespace-nowrap">{r.slip}</td>
                    <td className="px-2 py-1">{r.clinic}</td>
                    <td className="px-2 py-1">{r.product}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.qty}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.price.toLocaleString()}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.cost == null ? "—" : r.cost.toLocaleString()}</td>
                    <td className="px-2 py-1 text-right tabular-nums font-bold" style={{ color: (r.profit ?? 0) < 0 ? "#dc2626" : undefined }}>{r.profit == null ? "—" : r.profit.toLocaleString()}</td>
                    <td className="px-2 py-1 text-right tabular-nums font-bold" style={{ color: (r.rate ?? 0) < 0 ? "#dc2626" : "#b45309" }}>{r.rate == null ? "—" : r.rate.toFixed(1) + "%"}</td>
                    <td className="px-2 py-1 text-gray-500">{r.costSource}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > 1500 && <p className="text-center text-xs text-gray-500 py-2">先頭の1,500行だけ表示しています。すべては、CSV出力で確認してください。</p>}
          </div>
        </>
      )}
    </div>
  )
}
