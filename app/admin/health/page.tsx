"use client"

// データ点検（読み取り専用）: 在庫・注文まわりの「おかしいデータ」を一覧にして早期発見する。
// 何も書き換えない。異常があれば該当の注文管理・在庫画面で対応する。

import { useEffect, useState } from "react"
import Link from "next/link"
import { supabase, fetchAll } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"

type Row = { key: string; text: string; href?: string }
type Check = { id: string; title: string; desc: string; hint: string; rows: Row[]; level: "ok" | "warn" | "info" }

const DONE = ["納品済み", "納品済"]
const CANCELLED = ["キャンセル", "取消"]
const jstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const daysAgo = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)

export default function HealthPage() {
  const [loading, setLoading] = useState(true)
  const [checks, setChecks] = useState<Check[]>([])
  const [counts, setCounts] = useState<{ table: string; label: string; count: number | null }[]>([])
  const [checkedAt, setCheckedAt] = useState("")

  useEffect(() => { run() }, [])

  async function run() {
    setLoading(true)
    const [orders, items, clinics] = await Promise.all([
      fetchAll("orders", "id,clinic_id,status,created_at,delivered_at,total_price,delivery_number", (q: any) => q.order("id")),
      fetchAll("order_items", "id,order_id,quantity,price", (q: any) => q.order("id")),
      fetchAll("clinics", "id,name", (q: any) => q.order("id")),
    ])
    const { data: neg } = await supabase.from("products").select("id,name,stock,location").lt("stock", 0).order("stock", { ascending: true }).limit(1000)
    const cn = new Map((clinics as { id: string; name: string }[]).map(c => [c.id, c.name]))
    type O = { id: string; clinic_id: string; status: string; created_at: string; delivered_at: string | null; total_price: number; delivery_number: string | null }
    const os = (orders as O[]).filter(o => !CANCELLED.includes(o.status))
    const cnt = new Map<string, number>(), sum = new Map<string, number>()
    ;(items as { order_id: string; quantity: number; price: number }[]).forEach(i => {
      cnt.set(i.order_id, (cnt.get(i.order_id) || 0) + 1)
      sum.set(i.order_id, (sum.get(i.order_id) || 0) + Number(i.price || 0) * Number(i.quantity || 0))
    })
    const label = (o: O) => `${o.delivery_number || o.id.slice(0, 8)}｜${o.status}｜${jstDate(o.created_at)}｜${cn.get(o.clinic_id) || "(医院不明)"}｜${fmtYen(Number(o.total_price || 0))}`

    const result: Check[] = []

    const negRows = ((neg || []) as { id: string; name: string; stock: number; location: string | null }[])
    result.push({
      id: "neg", title: "マイナス在庫の商品", level: negRows.length ? "warn" : "ok",
      desc: "在庫数がマイナスの商品（売りや出庫を記録したのに、入荷・棚卸の数字が入っていない状態）",
      hint: "棚卸で実際の数を入力して確定すると直ります。自社管理商品を優先してください。",
      rows: negRows.map(p => ({ key: p.id, text: `${p.location === "自社管理" ? "🏷 " : ""}${p.name}　在庫 ${p.stock}`, href: "/admin/inventory" })),
    })

    const noItems = os.filter(o => !cnt.has(o.id))
    result.push({
      id: "noitems", title: "明細の無い注文", level: noItems.length ? "warn" : "ok",
      desc: "注文はあるのに、商品の明細が1件も無い注文",
      hint: "不要な注文は注文管理から削除してください。必要な注文は明細を入れ直してください。",
      rows: noItems.map(o => ({ key: o.id, text: label(o), href: "/admin/orders" })),
    })

    const mismatch = os.filter(o => cnt.has(o.id) && Math.round(sum.get(o.id) || 0) !== Math.round(Number(o.total_price || 0)))
    result.push({
      id: "mismatch", title: "合計金額と明細の合計が合わない注文", level: mismatch.length ? "warn" : "ok",
      desc: "注文の合計金額と、明細（単価×数量）の合計が一致しない注文（明細の欠け・編集ミスの疑い）",
      hint: "注文を開いて明細と金額を確認し、必要なら編集して合計を直してください。",
      rows: mismatch.map(o => ({ key: o.id, text: `${label(o)}　明細合計 ${fmtYen(Math.round(sum.get(o.id) || 0))}`, href: "/admin/orders" })),
    })

    const stale = os.filter(o => o.status === "準備中" && daysAgo(o.created_at) >= 14)
    result.push({
      id: "stale", title: "14日以上「準備中」のままの注文", level: stale.length ? "warn" : "ok",
      desc: "作成から14日以上たっても納品されていない注文（忘れ・処理漏れの疑い）",
      hint: "納品済みにする、または不要ならキャンセルにしてください。",
      rows: stale.map(o => ({ key: o.id, text: `${label(o)}（${daysAgo(o.created_at)}日経過）`, href: "/admin/orders" })),
    })

    const waiting = os.filter(o => ["注文受付", "確認中"].includes(o.status) && daysAgo(o.created_at) >= 3)
    result.push({
      id: "waiting", title: "3日以上「注文受付／確認中」のままの注文", level: waiting.length ? "warn" : "ok",
      desc: "受注処理がされないまま3日以上たった注文",
      hint: "受注処理画面で処理するか、不要ならキャンセルにしてください。",
      rows: waiting.map(o => ({ key: o.id, text: `${label(o)}（${daysAgo(o.created_at)}日経過）`, href: "/admin/orders/process" })),
    })

    const dupMap = new Map<string, O[]>()
    os.filter(o => Number(o.total_price || 0) > 0).forEach(o => {
      const k = `${o.clinic_id}|${Number(o.total_price)}|${jstDate(o.delivered_at || o.created_at)}`
      dupMap.set(k, [...(dupMap.get(k) || []), o])
    })
    const dups = Array.from(dupMap.values()).filter(g => g.length > 1)
    result.push({
      id: "dup", title: "重複の疑い（同じ医院・同じ日・同じ金額）", level: dups.length ? "info" : "ok",
      desc: "同じ医院に同じ日付・同じ金額の注文が複数ある組み合わせ（二重登録の疑い。正しい場合もあります）",
      hint: "内容を確認し、二重なら片方をキャンセル（または削除）してください。",
      rows: dups.map(g => ({ key: g[0].id, text: g.map(o => o.delivery_number || o.id.slice(0, 8)).join(" ／ ") + `　${cn.get(g[0].clinic_id) || ""}　${fmtYen(Number(g[0].total_price))}`, href: "/admin/orders" })),
    })
    setChecks(result)

    // 1000件（サーバーの1回あたりの上限）への接近
    const tables = [
      ["orders", "注文"], ["order_items", "注文明細"], ["purchase_orders", "発注書"], ["purchase_order_items", "発注明細"],
      ["stock_receipts", "入荷記録"], ["stock_movements", "在庫履歴"], ["products", "商品"], ["stocktake_items", "棚卸明細"],
    ]
    const cs = await Promise.all(tables.map(async ([t, l]) => {
      const { count } = await supabase.from(t).select("id", { count: "exact", head: true })
      return { table: t, label: l, count: count ?? null }
    }))
    setCounts(cs)
    setCheckedAt(new Date().toLocaleString("ja-JP"))
    setLoading(false)
  }

  const warnTotal = checks.filter(c => c.level === "warn").reduce((s, c) => s + c.rows.length, 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: 0 }}>
          🩺 データ点検
          <span className="ml-2 text-xs font-normal text-gray-400">読み取り専用（データは変更しません）</span>
        </h1>
        <div className="flex items-center gap-2">
          {checkedAt && <span className="text-xs text-gray-400">点検日時 {checkedAt}</span>}
          <button onClick={run} disabled={loading} className="px-3 py-1.5 bg-white border border-gray-300 text-sm font-bold rounded hover:bg-gray-50 disabled:opacity-50">
            {loading ? "点検中…" : "↻ 再点検"}
          </button>
          <Link href="/admin" className="text-xs text-gray-500 underline">← ホーム</Link>
        </div>
      </div>

      {loading ? <p className="text-gray-400 text-center py-12">点検中…</p> : (
        <>
          <div className="rounded-lg px-4 py-3 text-sm font-bold" style={warnTotal ? { background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" } : { background: "#f0fdf4", border: "1px solid #86efac", color: "#166534" }}>
            {warnTotal ? `要確認の項目が ${warnTotal} 件あります` : "要確認の項目はありません"}
          </div>

          {checks.map(c => (
            <details key={c.id} className="bg-white rounded-lg" style={{ border: "1px solid #e8eaed" }} open={c.level === "warn" && c.rows.length > 0 && c.rows.length <= 15}>
              <summary className="px-4 py-3 cursor-pointer flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-gray-900">{c.title}</span>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={c.rows.length === 0 ? { background: "#dcfce7", color: "#166534" } : c.level === "warn" ? { background: "#fef3c7", color: "#92400e" } : { background: "#e0e7ff", color: "#3730a3" }}>
                  {c.rows.length === 0 ? "異常なし" : `${c.rows.length}件`}
                </span>
              </summary>
              <div className="px-4 pb-3 space-y-2">
                <p className="text-xs text-gray-500">{c.desc}</p>
                {c.rows.length > 0 && <p className="text-xs text-blue-700">対処: {c.hint}</p>}
                {c.rows.length > 0 && (
                  <div className="overflow-auto rounded border border-gray-200" style={{ maxHeight: 300 }}>
                    {c.rows.slice(0, 200).map(r => (
                      <div key={r.key} className="px-3 py-1.5 text-[12px] border-b border-gray-100 last:border-0 flex items-center justify-between gap-2">
                        <span>{r.text}</span>
                        {r.href && <Link href={r.href} className="text-[11px] text-blue-600 underline shrink-0">開く</Link>}
                      </div>
                    ))}
                    {c.rows.length > 200 && <div className="px-3 py-1.5 text-[11px] text-gray-400">ほか {c.rows.length - 200} 件</div>}
                  </div>
                )}
              </div>
            </details>
          ))}

          <div className="bg-white rounded-lg px-4 py-3" style={{ border: "1px solid #e8eaed" }}>
            <p className="text-sm font-bold text-gray-900 mb-1">データ件数（サーバーの1回あたりの上限 1,000 件）</p>
            <p className="text-xs text-gray-500 mb-2">上限を超えたテーブルは、全件取得の仕組みを使っていない画面で一部しか表示されなくなります。該当する画面では画面上部に警告が出ます。</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {counts.map(c => {
                const n = c.count ?? 0
                const level = n >= 1000 ? "over" : n >= 800 ? "near" : "ok"
                return (
                  <div key={c.table} className="rounded p-2 text-sm" style={{ background: level === "over" ? "#fef2f2" : level === "near" ? "#fffbeb" : "#f9fafb" }}>
                    <div className="text-xs text-gray-500">{c.label}</div>
                    <div className="font-bold tabular-nums">{n.toLocaleString()}件</div>
                    <div className="text-[11px]" style={{ color: level === "over" ? "#b91c1c" : level === "near" ? "#92400e" : "#6b7280" }}>
                      {level === "over" ? "上限超（全件取得が必須）" : level === "near" ? "上限に接近" : "余裕あり"}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
