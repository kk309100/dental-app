"use client"

// 納品書の編集（納品書一覧から）
// 直せる項目: 数量・単価・商品名・商品の紐づけ・行の追加と削除・備考。合計金額は自動で計算し直す。
// 納品済みの納品書は、数量・商品を変えた分だけ、在庫も増減する（「在庫管理しない」商品は、在庫を変えない）。在庫の動きに「出庫修正」で残る。
import { use, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"

type Order = { id: string; clinic_id: string; status: string; created_at: string; delivered_at: string | null; total_price: number; delivery_number: string | null; invoice_id: string | null; note: string | null }
type Item = { id: string; order_id: string; product_id: string | null; product_name: string | null; quantity: number; price: number; delivered_quantity?: number | null; note?: string | null }
type Line = { key: string; id: string | null; product_id: string | null; product_name: string; quantity: string; price: string; delivered: number; note: string }
type PHit = { id: string; name: string; product_code: string | null; price: number | null; stock_managed: boolean | null }

const DELIVERED = ["納品済み", "納品済"]
const kata = (s: string) => s.replace(/[ぁ-ん]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))
// 納品のときに、在庫から引いた数（入荷済み＝直送で受け取った分は、在庫を通っていない）
const deductOf = (qty: number, delivered: number) => Math.max(0, qty - Math.min(delivered, qty))

export default function DeliveryEditPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params)
  const router = useRouter()
  const [order, setOrder] = useState<Order | null>(null)
  const [clinicName, setClinicName] = useState("")
  const [lines, setLines] = useState<Line[]>([])
  const [original, setOriginal] = useState<Item[]>([])
  const [note, setNote] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const keySeq = useRef(0)
  const nextKey = () => "k" + (++keySeq.current)

  // 商品の検索（行ごと）
  const [pickKey, setPickKey] = useState<string | null>(null)
  const [pickQ, setPickQ] = useState("")
  const [hits, setHits] = useState<PHit[]>([])
  const seq = useRef(0)

  useEffect(() => { (async () => {
    const { data: o } = await supabase.from("orders").select("*").eq("id", orderId).single()
    if (!o) { setLoading(false); return }
    setOrder(o as Order); setNote((o as Order).note || "")
    const { data: i } = await supabase.from("order_items").select("*").eq("order_id", orderId).order("id")
    const its = (i as Item[]) || []
    setOriginal(its)
    setLines(its.map(it => ({ key: nextKey(), id: it.id, product_id: it.product_id, product_name: it.product_name || "", quantity: String(it.quantity ?? ""), price: String(it.price ?? ""), delivered: Number(it.delivered_quantity || 0), note: it.note || "" })))
    if ((o as Order).clinic_id) {
      const { data: c } = await supabase.from("clinics").select("name").eq("id", (o as Order).clinic_id).single()
      setClinicName((c as { name?: string } | null)?.name || "")
    }
    setLoading(false)
  })() }, [orderId])

  useEffect(() => {
    if (!pickKey) return
    const q = pickQ.normalize("NFKC").toLowerCase().trim()
    if (!q) { setHits([]); return }
    const my = ++seq.current
    const t = setTimeout(async () => {
      let qb = supabase.from("products").select("id,name,product_code,price,stock_managed")
      for (const tk of q.split(/\s+/).filter(Boolean).map(x => x.replace(/%/g, ""))) qb = qb.ilike("search_key", `%${kata(tk)}%`)
      const r = await qb.order("name").limit(8)
      if (my === seq.current) setHits((r.data as PHit[]) || [])
    }, 200)
    return () => clearTimeout(t)
  }, [pickQ, pickKey])

  const total = useMemo(() => lines.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.quantity) || 0), 0), [lines])
  const update = (key: string, patch: Partial<Line>) => setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l))
  const isDelivered = !!order && DELIVERED.includes(order.status)

  function pickProduct(key: string, p: PHit) {
    const cur = lines.find(l => l.key === key)
    update(key, {
      product_id: p.id,
      // 「在庫管理しない」商品は、行の商品名を残す。ふつうの商品は、商品名を商品マスタの名前に合わせる
      product_name: p.stock_managed === false && cur?.product_name ? cur.product_name : p.name,
      price: cur && Number(cur.price) > 0 ? cur.price : String(p.price ?? 0),
    })
    setPickKey(null); setPickQ(""); setHits([])
  }

  async function save() {
    if (!order) return
    setError("")
    const clean = lines.filter(l => l.product_name.trim() || l.product_id)
    for (const l of clean) {
      const q = Number(l.quantity), p = Number(l.price)
      if (!Number.isFinite(q) || q <= 0) { setError(`「${l.product_name || "商品名なし"}」の数量は、1以上の数字にしてください`); return }
      if (!Number.isFinite(p) || p < 0) { setError(`「${l.product_name || "商品名なし"}」の単価は、0以上の数字にしてください`); return }
    }
    if (clean.length === 0) { setError("明細が1行もありません。納品書を消すときは、注文管理から削除してください"); return }
    if (order.invoice_id && !confirm("この納品書は、請求書に入っています。\n金額を変えても、発行済みの請求書は、自動では変わりません（請求書を取り消して、作り直してください）。\n保存しますか？")) return

    setSaving(true)
    try {
      // 在庫の増減（納品済みのときだけ）: 商品ごとに「元の引いた数 − 新しい引く数」を戻す
      const net = new Map<string, number>()
      if (isDelivered) {
        original.forEach(o => { if (o.product_id) net.set(o.product_id, (net.get(o.product_id) || 0) + deductOf(Number(o.quantity), Number(o.delivered_quantity || 0))) })
        clean.forEach(l => { if (l.product_id) net.set(l.product_id, (net.get(l.product_id) || 0) - deductOf(Number(l.quantity), l.id ? l.delivered : 0)) })
      }
      const changed = Array.from(net).filter(([, v]) => v !== 0)
      const stockPlan: { id: string; name: string; before: number; after: number; delta: number }[] = []
      if (changed.length) {
        const { data: ps } = await supabase.from("products").select("id,name,stock,stock_managed").in("id", changed.map(([id]) => id))
        for (const [pid, delta] of changed) {
          const p = (ps || []).find(x => x.id === pid)
          if (!p || p.stock_managed === false) continue
          stockPlan.push({ id: pid, name: p.name, before: Number(p.stock || 0), after: Number(p.stock || 0) + delta, delta })
        }
        const neg = stockPlan.filter(x => x.after < 0)
        if (neg.length && !confirm(`在庫がマイナスになる商品があります:\n${neg.map(x => `・${x.name}（${x.before} → ${x.after}）`).join("\n")}\n続けますか？`)) { setSaving(false); return }
      }

      // 明細: 更新・追加・削除
      const keptIds = new Set(clean.filter(l => l.id).map(l => l.id as string))
      const removed = original.filter(o => !keptIds.has(o.id)).map(o => o.id)
      for (const l of clean) {
        const row = { product_id: l.product_id, product_name: l.product_name.trim() || null, quantity: Number(l.quantity), price: Number(l.price), note: l.note.trim() || null }
        if (l.id) { const { error: e } = await supabase.from("order_items").update(row).eq("id", l.id); if (e) throw new Error("明細の更新に失敗: " + e.message) }
        else { const { error: e } = await supabase.from("order_items").insert({ ...row, order_id: orderId }); if (e) throw new Error("明細の追加に失敗: " + e.message) }
      }
      if (removed.length) { const { error: e } = await supabase.from("order_items").delete().in("id", removed); if (e) throw new Error("明細の削除に失敗: " + e.message) }

      // 合計金額・備考
      const { error: oe } = await supabase.from("orders").update({ total_price: total, note: note.trim() || null }).eq("id", orderId)
      if (oe) throw new Error("合計金額の更新に失敗: " + oe.message)

      // 在庫
      for (const s of stockPlan) {
        const { error: se } = await supabase.from("products").update({ stock: s.after }).eq("id", s.id)
        if (se) { alert(`在庫の更新に失敗しました（${s.name}）: ${se.message}`); continue }
        try {
          await supabase.from("stock_movements").insert({
            product_id: s.id, movement_type: "出庫修正", quantity: s.delta, before_stock: s.before, after_stock: s.after,
            ref_type: "order", ref_id: orderId, reason: `納品書の編集 ${order.delivery_number || ""}`.trim(),
          })
        } catch { /* 記録のみ */ }
      }
      router.push("/admin/deliveries")
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>
  if (!order) return <p className="text-red-600 text-center py-12">納品書が見つかりません</p>

  return (
    <div className="max-w-5xl mx-auto space-y-3">
      <div className="flex items-center flex-wrap gap-2">
        <Link href="/admin/deliveries" className="px-3 py-1.5 border border-gray-200 rounded text-sm bg-white hover:bg-gray-50">← 納品書一覧</Link>
        <h1 className="font-bold text-gray-900" style={{ fontSize: 20 }}>納品書の編集</h1>
        <span className="text-sm text-gray-500 font-mono">{order.delivery_number}</span>
        <span className="text-sm text-gray-700">{clinicName}</span>
        <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{order.status}</span>
      </div>

      {isDelivered && (
        <div className="text-xs bg-sky-50 border border-sky-200 text-sky-800 rounded px-3 py-2">
          納品済みの納品書です。数量や商品を変えると、変えた分だけ在庫も増減します（「在庫管理しない」商品は、在庫を変えません）。
        </div>
      )}
      {error && <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2">{error}</div>}

      <div className="bg-white rounded-lg border border-gray-200 overflow-visible">
        <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
          <thead className="bg-gray-50">
            <tr className="text-[12px] text-gray-600 border-b border-gray-200">
              <th className="px-2 py-2 text-left">商品名（納品書に印字）</th>
              <th className="px-2 py-2 text-left w-56">商品の紐づけ</th>
              <th className="px-2 py-2 text-right w-20">数量</th>
              <th className="px-2 py-2 text-right w-28">単価</th>
              <th className="px-2 py-2 text-right w-28">小計</th>
              <th className="px-2 py-2 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.key} className="border-b border-gray-100 align-top">
                <td className="px-2 py-1.5">
                  <input lang="ja" value={l.product_name} onChange={e => update(l.key, { product_name: e.target.value })} className="w-full px-2 py-1 border border-gray-200 rounded" placeholder="商品名" />
                  <input lang="ja" value={l.note} onChange={e => update(l.key, { note: e.target.value })} className="w-full mt-1 px-2 py-0.5 border border-dashed border-gray-200 rounded text-xs bg-gray-50" placeholder="この商品の備考" />
                </td>
                <td className="px-2 py-1.5 relative">
                  <div className="flex items-center gap-1">
                    <span className={"text-[12px] flex-1 " + (l.product_id ? "text-emerald-700" : "text-gray-400")}>{l.product_id ? "✓ 商品マスタに紐づいています" : "未紐づき（手入力）"}</span>
                    <button onClick={() => { setPickKey(pickKey === l.key ? null : l.key); setPickQ(""); setHits([]) }} className="text-[11px] px-2 py-0.5 rounded border border-gray-300 hover:bg-gray-50">{pickKey === l.key ? "閉じる" : "商品を選ぶ"}</button>
                    {l.product_id && <button onClick={() => update(l.key, { product_id: null })} className="text-[11px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50" title="紐づけを外す">外す</button>}
                  </div>
                  {pickKey === l.key && (
                    <div className="absolute z-20 left-2 right-2 mt-1 bg-white border border-gray-300 rounded shadow-lg p-2">
                      <input lang="ja" autoFocus value={pickQ} onChange={e => setPickQ(e.target.value)} placeholder="商品名・コードで検索" className="w-full px-2 py-1 border border-gray-200 rounded text-[13px]" />
                      <div className="max-h-52 overflow-auto mt-1">
                        {hits.map(p => (
                          <button key={p.id} onClick={() => pickProduct(l.key, p)} className="block w-full text-left px-2 py-1 text-[12px] hover:bg-blue-50 border-b border-gray-100">
                            {p.name}<span className="text-gray-400 ml-1">{p.product_code || ""}</span>{p.stock_managed === false && <span className="ml-1 text-sky-600">在庫管理なし</span>}
                          </button>
                        ))}
                        {pickQ.trim() && hits.length === 0 && <p className="text-[12px] text-gray-400 px-2 py-1">該当なし</p>}
                      </div>
                    </div>
                  )}
                </td>
                <td className="px-2 py-1.5"><input type="number" min={1} value={l.quantity} onChange={e => update(l.key, { quantity: e.target.value })} className="w-full px-2 py-1 border border-gray-200 rounded text-right" /></td>
                <td className="px-2 py-1.5"><input type="number" min={0} step="any" value={l.price} onChange={e => update(l.key, { price: e.target.value })} className="w-full px-2 py-1 border border-gray-200 rounded text-right" /></td>
                <td className="px-2 py-1.5 text-right tabular-nums font-bold pt-2.5">{fmtYen((Number(l.price) || 0) * (Number(l.quantity) || 0))}</td>
                <td className="px-2 py-1.5 text-center pt-2">
                  <button onClick={() => { if (confirm(`「${l.product_name || "この行"}」を削除しますか？`)) setLines(prev => prev.filter(x => x.key !== l.key)) }} className="text-red-500 text-lg leading-none" title="この行を削除">×</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="px-2 py-2"><button onClick={() => setLines(prev => [...prev, { key: nextKey(), id: null, product_id: null, product_name: "", quantity: "1", price: "0", delivered: 0, note: "" }])} className="text-[12px] px-3 py-1 rounded border border-gray-300 hover:bg-gray-50">＋ 行を追加</button></td>
              <td></td><td></td>
              <td className="px-2 py-2 text-right text-[12px] text-gray-600">合計（税抜）</td>
              <td className="px-2 py-2 text-right font-bold text-base tabular-nums">{fmtYen(total)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-3">
        <label className="block text-[12px] font-bold text-gray-600 mb-1">備考</label>
        <textarea lang="ja" value={note} onChange={e => setNote(e.target.value)} rows={2} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
      </div>

      <div className="flex justify-end gap-2 sticky bottom-2">
        <Link href="/admin/deliveries" className="px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded hover:bg-gray-50">キャンセル</Link>
        <button onClick={save} disabled={saving} className="px-5 py-2 text-sm font-bold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300">{saving ? "保存中…" : "✓ 保存"}</button>
      </div>
    </div>
  )
}
