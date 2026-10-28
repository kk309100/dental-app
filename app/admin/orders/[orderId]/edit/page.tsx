"use client"

// 注文の編集（注文管理から。数量・商品名・単価などを直せるのは、ここだけ）
// 直せる項目: 数量・単価・商品名・商品の紐づけ・行の追加と削除・備考。合計金額は自動で計算し直す。
// 納品済みの納品書は、数量・商品を変えた分だけ、在庫も増減する（「在庫管理しない」商品は、在庫を変えない）。在庫の動きに「出庫修正」で残る。
import { use, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { forceAddOrderItemToPool } from "@/lib/po-pool"
import { markPoChanged, recalcPoTotal } from "@/lib/po-change-log"

type Order = { id: string; clinic_id: string; status: string; created_at: string; delivered_at: string | null; total_price: number; delivery_number: string | null; invoice_id: string | null; note: string | null }
type Item = { id: string; order_id: string; product_id: string | null; product_name: string | null; quantity: number; price: number; delivered_quantity?: number | null; note?: string | null; lot_number?: string | null }
type Line = { key: string; id: string | null; product_id: string | null; product_name: string; quantity: string; price: string; delivered: number; note: string; lot: string }
type PHit = { id: string; name: string; product_code: string | null; price: number | null; stock_managed: boolean | null }

const DELIVERED = ["納品済み", "納品済"]
// まだ受注処理をしていない状態（受注処理の画面に出る）。それ以外で足した商品は、保存のあとに、発注の判定をかける
const UNPROCESSED = ["注文受付", "確認中"]
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
  // 受注処理が済んだ注文に商品を足したとき、保存のあとに出す「発注の確認」
  const [postAdd, setPostAdd] = useState<{ id: string; name: string; orderQty: number; stock: number | null; qty: string }[] | null>(null)
  const [postBusy, setPostBusy] = useState(false)
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
    setLines(its.map(it => ({ key: nextKey(), id: it.id, product_id: it.product_id, product_name: it.product_name || "", quantity: String(it.quantity ?? ""), price: String(it.price ?? ""), delivered: Number(it.delivered_quantity || 0), note: it.note || "", lot: it.lot_number || "" })))
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
      const addedIds: string[] = []
      const addedInfo: { id: string; product_id: string | null; name: string; qty: number }[] = []
      const removed = original.filter(o => !keptIds.has(o.id)).map(o => o.id)

      // 削除する行に結びついた発注書の行を調べる。
      // 下書き（発注プール）の行は、いっしょに消す。送信済み（発注済・部分入荷）で、入荷前の行も消して、発注書に「変更あり」の印を付ける。入荷が始まっている行は、変えずに知らせる
      const removedPoLines: { id: string; poId: string; name: string; received: boolean }[] = []
      for (const rid of removed) {
        const { data: pls } = await supabase.from("purchase_order_items").select("id,purchase_order_id,product_name,received_quantity").ilike("note", `%明細${rid.slice(0, 8)}%`)
        for (const pl of pls || []) removedPoLines.push({ id: pl.id, poId: pl.purchase_order_id, name: pl.product_name || "商品", received: Number(pl.received_quantity || 0) > 0 })
      }
      const poHeadById = new Map<string, { status: string; po_number: string }>()
      const loadHeads = async (ids: string[]) => {
        const need = ids.filter(id => !poHeadById.has(id))
        if (!need.length) return
        const { data: hs } = await supabase.from("purchase_orders").select("id,status,po_number").in("id", need)
        for (const h of hs || []) poHeadById.set(h.id, { status: h.status, po_number: h.po_number })
      }
      await loadHeads(Array.from(new Set(removedPoLines.map(x => x.poId))))
      const SENT = ["発注済", "部分入荷"]
      const draftLines = removedPoLines.filter(x => poHeadById.get(x.poId)?.status === "下書き" && !x.received)
      const sentRemovable = removedPoLines.filter(x => SENT.includes(poHeadById.get(x.poId)?.status || "") && !x.received)
      const keptPoLines = removedPoLines.filter(x => !draftLines.includes(x) && !sentRemovable.includes(x) && poHeadById.get(x.poId)?.status !== "取消")
      if (draftLines.length || sentRemovable.length || keptPoLines.length) {
        const m = ["削除する商品に、発注書の行が結びついています。"]
        if (draftLines.length) m.push(`・下書き（発注プール）の ${draftLines.length}行 は、いっしょに消します`)
        if (sentRemovable.length) m.push(`・送信済みの発注書の ${sentRemovable.length}行 も消して、その発注書に「変更あり」の印を付けます（仕入先への連絡が必要です）`)
        if (keptPoLines.length) m.push(`・入荷が始まっている／入荷済みの ${keptPoLines.length}行 は、変えません（保存のあとに、お知らせします）`)
        if (!confirm(m.join("\n") + "\n\n保存しますか？")) { setSaving(false); return }
      }
      for (const l of clean) {
        const row = { product_id: l.product_id, product_name: l.product_name.trim() || null, quantity: Number(l.quantity), price: Number(l.price), note: l.note.trim() || null, lot_number: l.lot.trim() || null }
        if (l.id) { const { error: e } = await supabase.from("order_items").update(row).eq("id", l.id); if (e) throw new Error("明細の更新に失敗: " + e.message) }
        else { const { data: ins, error: e } = await supabase.from("order_items").insert({ ...row, order_id: orderId }).select("id").single(); if (e) throw new Error("明細の追加に失敗: " + e.message); if (ins) { addedIds.push(ins.id as string); addedInfo.push({ id: ins.id as string, product_id: l.product_id, name: l.product_name.trim() || "商品", qty: Number(l.quantity) }) } }
      }
      if (removed.length) { const { error: e } = await supabase.from("order_items").delete().in("id", removed); if (e) throw new Error("明細の削除に失敗: " + e.message) }

      // 発注書の行にも反映する。備考の「明細xxxxxxxx」で結ぶ（入荷前の行だけ）。
      // 下書き: 商品名・商品を合わせる。数量は、元の注文数と同じだったときだけ合わせる。
      // 送信済み（発注済・部分入荷）: 同じように変えて、発注書に「変更あり」と、変えた内容を残す。
      const poNotes: string[] = []
      const changeTexts = new Map<string, string[]>()   // 発注書ID → 変えた内容
      const touchedPo = new Set<string>()               // 合計を計算し直す発注書
      const addChange = (poId: string, text: string) => { changeTexts.set(poId, [...(changeTexts.get(poId) || []), text]) }

      // 削除した行
      for (const x of draftLines) { await supabase.from("purchase_order_items").delete().eq("id", x.id); touchedPo.add(x.poId) }
      for (const x of sentRemovable) {
        await supabase.from("purchase_order_items").delete().eq("id", x.id)
        touchedPo.add(x.poId)
        addChange(x.poId, "「" + x.name + "」を削除（注文の編集）")
      }
      for (const x of keptPoLines) {
        const h = poHeadById.get(x.poId)
        poNotes.push("・" + x.name + "（発注書 " + (h?.po_number || "") + "・" + (h?.status || "") + "）… 入荷が始まっているので、発注書の行は消していません")
      }

      // 変えた行
      for (const l of clean) {
        if (!l.id) continue
        const o0 = original.find(o => o.id === l.id)
        if (!o0) continue
        const newName = l.product_name.trim()
        const nameChanged = (o0.product_name || "") !== newName || (o0.product_id || null) !== (l.product_id || null)
        const qtyChanged = Number(o0.quantity) !== Number(l.quantity)
        if (!nameChanged && !qtyChanged) continue
        const { data: pls } = await supabase.from("purchase_order_items").select("id,purchase_order_id,product_name,quantity,received_quantity").ilike("note", `%明細${l.id.slice(0, 8)}%`)
        await loadHeads(Array.from(new Set((pls || []).map(p => p.purchase_order_id))))
        for (const pl of pls || []) {
          if (Number(pl.received_quantity || 0) > 0) continue
          const h = poHeadById.get(pl.purchase_order_id)
          const isDraftPo = h?.status === "下書き"
          const isSentPo = SENT.includes(h?.status || "")
          if (!isDraftPo && !isSentPo) continue
          const patchRow: Record<string, unknown> = {}
          const texts: string[] = []
          if (nameChanged) { patchRow.product_name = newName || null; patchRow.product_id = l.product_id; texts.push("商品名「" + (pl.product_name || o0.product_name || "") + "」→「" + newName + "」") }
          if (qtyChanged) {
            if (Number(pl.quantity) === Number(o0.quantity)) { patchRow.quantity = Number(l.quantity); texts.push("「" + (newName || "商品") + "」の数量 " + pl.quantity + " → " + l.quantity) }
            else poNotes.push("・" + (newName || "商品") + "（発注書 " + (h?.po_number || "") + "）… 発注書の数量が注文の数量と違うため、数量は自動では変えていません")
          }
          if (Object.keys(patchRow).length === 0) continue
          await supabase.from("purchase_order_items").update(patchRow).eq("id", pl.id)
          if (patchRow.quantity !== undefined) touchedPo.add(pl.purchase_order_id)
          if (isSentPo) for (const t of texts) addChange(pl.purchase_order_id, t)
        }
      }

      // 発注書の合計を直す（行が無くなった下書きは、発注書ごと消す）。送信済みの発注書には「変更あり」を残す
      for (const poId of Array.from(touchedPo)) {
        const { count } = await supabase.from("purchase_order_items").select("id", { count: "exact", head: true }).eq("purchase_order_id", poId)
        if ((count || 0) === 0 && poHeadById.get(poId)?.status === "下書き") await supabase.from("purchase_orders").delete().eq("id", poId)
        else await recalcPoTotal(poId)
      }
      for (const [poId, texts] of Array.from(changeTexts)) {
        await markPoChanged(poId, texts)
        const h = poHeadById.get(poId)
        poNotes.push("・発注書 " + (h?.po_number || "") + " に「変更あり」の印を付けました。仕入先へ連絡してください")
      }

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
      // 受注処理が済んでいる注文（準備中など）に足した商品は、受注処理の画面に出ない。保存のあとに、発注する数を選ぶ画面を出す（在庫があっても、発注できる）
      if (addedInfo.length > 0 && !isDelivered && !UNPROCESSED.includes(order.status)) {
        const pids = Array.from(new Set(addedInfo.map(x => x.product_id).filter(Boolean) as string[]))
        const stockById = new Map<string, { stock: number; managed: boolean }>()
        if (pids.length) {
          const { data: ps } = await supabase.from("products").select("id,stock,stock_managed").in("id", pids)
          for (const p of ps || []) stockById.set(p.id, { stock: Number(p.stock || 0), managed: p.stock_managed !== false })
        }
        const list = addedInfo.map(x => {
          const st = x.product_id ? stockById.get(x.product_id) : undefined
          const stock = st && st.managed ? st.stock : null
          const short = stock == null ? x.qty : Math.max(0, x.qty - Math.max(0, stock))
          return { id: x.id, name: x.name, orderQty: x.qty, stock, qty: String(short) }
        })
        if (poNotes.length) alert("注文を保存しました。\n発注書について、確認してください:\n" + poNotes.join("\n"))
        setPostAdd(list)
        setSaving(false)
        return
      }
      if (poNotes.length) alert("注文を保存しました。\n発注書について、確認してください:\n" + poNotes.join("\n"))
      router.push("/admin/orders")
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  async function submitPostAdd() {
    if (!postAdd) return
    setPostBusy(true)
    const errs: string[] = []
    for (const r of postAdd) {
      const q = Number(r.qty)
      if (!(q > 0)) continue
      const res = await forceAddOrderItemToPool(r.id, undefined, q)
      if (!res.ok) errs.push("・" + r.name + ": " + res.error)
    }
    setPostBusy(false)
    if (errs.length) { alert("入れられなかった商品があります:\n" + errs.join("\n")); return }
    router.push("/admin/orders")
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>
  if (!order) return <p className="text-red-600 text-center py-12">注文が見つかりません</p>

  return (
    <div className="max-w-5xl mx-auto space-y-3">
      <div className="flex items-center flex-wrap gap-2">
        <Link href="/admin/orders" className="px-3 py-1.5 border border-gray-200 rounded text-sm bg-white hover:bg-gray-50">← 注文管理</Link>
        <h1 className="font-bold text-gray-900" style={{ fontSize: 20 }}>注文の編集</h1>
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
                  <div className="flex gap-1 mt-1">
                    <input value={l.lot} onChange={e => update(l.key, { lot: e.target.value })} className="w-28 px-2 py-0.5 border border-dashed border-gray-200 rounded text-xs bg-gray-50" placeholder="LOT番号" />
                    <input lang="ja" value={l.note} onChange={e => update(l.key, { note: e.target.value })} className="flex-1 px-2 py-0.5 border border-dashed border-gray-200 rounded text-xs bg-gray-50" placeholder="この商品の備考" />
                  </div>
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
              <td className="px-2 py-2"><button onClick={() => setLines(prev => [...prev, { key: nextKey(), id: null, product_id: null, product_name: "", quantity: "1", price: "0", delivered: 0, note: "", lot: "" }])} className="text-[12px] px-3 py-1 rounded border border-gray-300 hover:bg-gray-50">＋ 行を追加</button></td>
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
        <Link href="/admin/orders" className="px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded hover:bg-gray-50">キャンセル</Link>
        <button onClick={save} disabled={saving} className="px-5 py-2 text-sm font-bold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300">{saving ? "保存中…" : "✓ 保存"}</button>
      </div>

      {postAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-xl p-4 space-y-3">
            <div className="font-bold text-gray-900">追加した商品を、発注しますか？</div>
            <p className="text-xs text-gray-600">この注文は、受注処理が済んでいるので、受注処理の画面には出ません。ここで、発注する数を決めてください（在庫があっても、発注できます）。0 にすると、発注しません。</p>
            <table className="w-full text-[13px]">
              <thead><tr className="text-[12px] text-gray-500 border-b border-gray-200"><th className="text-left px-1 py-1">商品名</th><th className="text-right px-1 py-1 w-14">注文</th><th className="text-right px-1 py-1 w-14">在庫</th><th className="text-right px-1 py-1 w-24">発注する数</th></tr></thead>
              <tbody>
                {postAdd.map(r => (
                  <tr key={r.id} className="border-b border-gray-100">
                    <td className="px-1 py-1">{r.name}</td>
                    <td className="px-1 py-1 text-right tabular-nums">{r.orderQty}</td>
                    <td className="px-1 py-1 text-right tabular-nums">{r.stock == null ? "−" : r.stock}</td>
                    <td className="px-1 py-1"><input type="number" min={0} value={r.qty} onChange={e => setPostAdd(prev => prev ? prev.map(x => x.id === r.id ? { ...x, qty: e.target.value } : x) : prev)} className="w-full px-2 py-1 border border-gray-300 rounded text-right" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-gray-500">初めに入っている数は、「注文数 − 在庫」（足りない分）です。</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => router.push("/admin/orders")} disabled={postBusy} className="px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded hover:bg-gray-50">発注しない</button>
              <button onClick={submitPostAdd} disabled={postBusy} className="px-5 py-2 text-sm font-bold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300">{postBusy ? "処理中…" : "発注プールへ入れる"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
