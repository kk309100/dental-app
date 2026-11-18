"use client"

// 注文数と発注数が違う明細を、日付（注文日）別に見る画面。
// 「発注書に入っている明細」のうち、注文の数量と、発注書の数量の合計が、1個でも違うものを出す。
// （発注書に入っていない明細＝在庫から出荷する明細は、対象外）
import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase, fetchAllData } from "@/lib/supabase"

type Order = { id: string; delivery_number: string | null; clinic_id: string; status: string; created_at: string }
type Item = { id: string; order_id: string; product_name: string | null; quantity: number }
type PoLine = { quantity: number; received_quantity: number | null; note: string | null; source_order_item_id: string | null; purchase_order_id: string }
type PoHead = { id: string; status: string; po_number: string }
type Clinic = { id: string; name: string }

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const dateOf = (iso: string) => ymd(new Date(iso))
const DONE = ["納品済み", "納品済"]
const CANCELLED = ["キャンセル", "取消"]

export default function OrderMismatchPage() {
  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState<Order[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [poLines, setPoLines] = useState<PoLine[]>([])
  const [poHeads, setPoHeads] = useState<PoHead[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const today = new Date()
  const [from, setFrom] = useState(ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30)))
  const [to, setTo] = useState(ymd(today))
  const [kind, setKind] = useState<"all" | "more" | "less">("all")
  const [withDelivered, setWithDelivered] = useState(false)
  const [q, setQ] = useState("")

  useEffect(() => { (async () => {
    const [o, i, pl, ph, c] = await Promise.all([
      fetchAllData("orders", "id,delivery_number,clinic_id,status,created_at"),
      fetchAllData("order_items", "id,order_id,product_name,quantity"),
      fetchAllData("purchase_order_items", "purchase_order_id,quantity,received_quantity,note,source_order_item_id"),
      fetchAllData("purchase_orders", "id,status,po_number"),
      fetchAllData("clinics", "id,name"),
    ])
    setOrders((o.data as Order[]) || []); setItems((i.data as Item[]) || []); setPoLines((pl.data as PoLine[]) || [])
    setPoHeads((ph.data as PoHead[]) || []); setClinics((c.data as Clinic[]) || [])
    setLoading(false)
  })() }, [])

  const rows = useMemo(() => {
    const head = new Map(poHeads.map(h => [h.id, h]))
    const orderById = new Map(orders.map(o => [o.id, o]))
    const clinicName = new Map(clinics.map(c => [c.id, c.name]))
    // 明細ID（先頭8桁）ごとに、取消でない発注書の行を集める
    const byPre = new Map<string, { qty: number; received: number; pos: Map<string, string> }>()
    for (const l of poLines) {
      const h = head.get(l.purchase_order_id)
      if (!h || h.status === "取消") continue
      const pre = (l.source_order_item_id ? String(l.source_order_item_id).slice(0, 8) : (String(l.note || "").match(/明細([0-9a-f]{8})/i)?.[1] || "")).toLowerCase()
      if (!pre) continue
      const e = byPre.get(pre) || { qty: 0, received: 0, pos: new Map<string, string>() }
      e.qty += Number(l.quantity || 0); e.received += Number(l.received_quantity || 0); e.pos.set(h.po_number, h.status)
      byPre.set(pre, e)
    }
    const k = q.trim().toLowerCase()
    const out: { date: string; orderId: string; dn: string; clinic: string; status: string; name: string; qty: number; ordered: number; received: number; pos: string }[] = []
    for (const it of items) {
      const e = byPre.get(it.id.slice(0, 8).toLowerCase())
      if (!e) continue
      const qty = Number(it.quantity || 0)
      if (e.qty === qty) continue
      if (kind === "more" && e.qty <= qty) continue
      if (kind === "less" && e.qty >= qty) continue
      const o = orderById.get(it.order_id)
      if (!o || CANCELLED.includes(o.status)) continue
      if (!withDelivered && DONE.includes(o.status)) continue
      const date = dateOf(o.created_at)
      if (date < from || date > to) continue
      const clinic = clinicName.get(o.clinic_id) || "(医院)"
      if (k && !`${it.product_name} ${clinic} ${o.delivery_number}`.toLowerCase().includes(k)) continue
      out.push({ date, orderId: o.id, dn: o.delivery_number || o.id.slice(0, 8), clinic, status: o.status, name: it.product_name || "(商品名なし)", qty, ordered: e.qty, received: e.received, pos: Array.from(e.pos).map(([n, s]) => `${n}（${s}）`).join("、") })
    }
    out.sort((a, b) => (a.date === b.date ? a.dn.localeCompare(b.dn) : b.date.localeCompare(a.date)))
    return out
  }, [orders, items, poLines, poHeads, clinics, from, to, kind, withDelivered, q])

  const groups = useMemo(() => {
    const m = new Map<string, typeof rows>()
    for (const r of rows) m.set(r.date, [...(m.get(r.date) || []), r])
    return Array.from(m)
  }, [rows])

  const wd = (s: string) => "日月火水木金土"[new Date(s + "T00:00:00").getDay()]

  return (
    <div className="max-w-6xl mx-auto space-y-3">
      <div className="flex items-center flex-wrap gap-2">
        <Link href="/admin/orders" className="px-3 py-1.5 border border-gray-200 rounded text-sm bg-white hover:bg-gray-50">← 注文管理</Link>
        <h1 className="font-bold text-gray-900" style={{ fontSize: 20 }}>注文数と発注数が違う明細</h1>
      </div>
      <p className="text-xs text-gray-500">発注書に入っている明細のうち、注文の数量と、発注書の数量の合計が違うものを、注文日ごとに出します。発注書に入っていない明細（在庫から出荷する分）は、対象外です。</p>

      <div className="flex items-center gap-2 flex-wrap bg-gray-50 p-2 rounded-lg" style={{ border: "1px solid #e8eaed" }}>
        <span className="text-xs text-gray-600">注文日</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-2 py-1 border border-gray-200 rounded text-sm bg-white" />
        <span className="text-xs text-gray-500">〜</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-2 py-1 border border-gray-200 rounded text-sm bg-white" />
        <select value={kind} onChange={e => setKind(e.target.value as "all" | "more" | "less")} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="all">発注が多い・少ない 両方</option>
          <option value="more">発注が多い だけ</option>
          <option value="less">発注が少ない だけ</option>
        </select>
        <label className="text-xs text-gray-700 flex items-center gap-1"><input type="checkbox" checked={withDelivered} onChange={e => setWithDelivered(e.target.checked)} />納品済みの注文も含める</label>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="商品名・医院・納品書NO" className="flex-1 min-w-[160px] px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <span className="text-xs text-gray-600">{rows.length}件</span>
      </div>

      {loading ? <p className="text-gray-400 text-center py-8">読み込み中…</p> : groups.length === 0 ? (
        <p className="text-gray-400 text-center py-8">該当する明細はありません</p>
      ) : groups.map(([date, list]) => (
        <div key={date} className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-sm font-bold text-gray-800">{date}（{wd(date)}）<span className="ml-2 text-xs font-normal text-gray-500">{list.length}件</span></div>
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500">
              <th className="px-2 py-1 text-left">医院 / 納品書NO</th>
              <th className="px-2 py-1 text-left">商品名</th>
              <th className="px-2 py-1 text-right whitespace-nowrap">注文</th>
              <th className="px-2 py-1 text-right whitespace-nowrap">発注</th>
              <th className="px-2 py-1 text-right whitespace-nowrap">入荷</th>
              <th className="px-2 py-1 text-right whitespace-nowrap">差</th>
              <th className="px-2 py-1 text-left">発注書</th>
              <th className="px-2 py-1"></th>
            </tr></thead>
            <tbody>
              {list.map((r, idx) => {
                const diff = r.ordered - r.qty
                return (
                  <tr key={r.orderId + idx} className="border-t border-gray-100 align-top">
                    <td className="px-2 py-1.5"><div className="font-bold">{r.clinic}</div><div className="text-[11px] text-gray-500 font-mono">{r.dn}（{r.status}）</div></td>
                    <td className="px-2 py-1.5">{r.name}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.qty}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.ordered}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.received}</td>
                    <td className={"px-2 py-1.5 text-right tabular-nums font-bold " + (diff > 0 ? "text-red-600" : "text-amber-700")}>{diff > 0 ? "+" : ""}{diff}<span className="ml-1 text-[11px] font-normal">{diff > 0 ? "発注が多い" : "発注が少ない"}</span></td>
                    <td className="px-2 py-1.5 text-[11px] text-gray-600">{r.pos}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap"><Link href={`/admin/orders/${r.orderId}/edit`} className="text-[12px] px-2 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-50">注文を開く</Link></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
