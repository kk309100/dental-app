// 注文の一部の明細だけを、別の注文に切り分ける（一部納品のため）。
// ・切り分けた注文は、元の注文と同じ状態（準備中など）のまま。在庫・請求・納品の処理は、ここでは行わない。
//   → このあと、出荷準備画面（/admin/shipping）で、通常どおり、納品書の発行・在庫の減算を行う。
// ・明細のIDは変えずに、order_id だけを付け替える（発注書との紐付けは、明細IDで取っているため、切れない）。
// ・選んだ明細が、注文の全部のときは、分けずに、その注文をそのまま返す。
import { supabase } from "@/lib/supabase"
import { logOp } from "@/lib/op-log"

export async function splitOrderItems(orderId: string, itemIds: string[]): Promise<{ ok: boolean; orderId?: string; split?: boolean; error?: string }> {
  if (itemIds.length === 0) return { ok: false, error: "商品が選ばれていません" }

  const { data: order, error: e0 } = await supabase.from("orders")
    .select("id,clinic_id,status,delivery_number,sales_rep,note,source").eq("id", orderId).single()
  if (e0 || !order) return { ok: false, error: "注文が見つかりません" }
  if (["納品済み", "納品済", "キャンセル"].includes(order.status)) return { ok: false, error: `「${order.status}」の注文は、納品書を作れません` }

  const { data: all, error: e1 } = await supabase.from("order_items")
    .select("id,order_id,product_id,product_name,quantity,price").eq("order_id", orderId)
  if (e1 || !all) return { ok: false, error: "明細の取得に失敗しました" }
  const picked = all.filter(it => itemIds.includes(it.id))
  if (picked.length !== itemIds.length) return { ok: false, error: "選んだ商品が、この注文にありません。画面を更新してください" }

  // 在庫が足りない商品が混じっていないか、最新の在庫で確かめる（マイナス在庫を防ぐ）
  const pids = Array.from(new Set(picked.map(it => it.product_id).filter(Boolean))) as string[]
  if (pids.length > 0) {
    const { data: prods, error: e2 } = await supabase.from("products").select("id,name,stock,stock_managed").in("id", pids)
    if (e2 || !prods) return { ok: false, error: "在庫の確認に失敗しました" }
    const byId = new Map(prods.map(p => [p.id, p]))
    const need = new Map<string, number>()
    for (const it of picked) if (it.product_id) need.set(it.product_id, (need.get(it.product_id) || 0) + Number(it.quantity || 0))
    for (const [pid, q] of need) {
      const p = byId.get(pid)
      if (p && p.stock_managed !== false && Number(p.stock || 0) < q) {
        return { ok: false, error: `「${p.name}」は、在庫が足りません（在庫 ${Number(p.stock || 0)} / 必要 ${q}）` }
      }
    }
  }

  // 全部の明細を選んだときは、分けずに、そのまま納品へ
  if (picked.length === all.length) return { ok: true, orderId, split: false }

  const sub = (xs: { quantity: number | null; price: number | null }[]) => xs.reduce((s, it) => s + Number(it.price || 0) * Number(it.quantity || 0), 0)
  const rest = all.filter(it => !itemIds.includes(it.id))

  // 切り分け先の注文番号: 元の番号 + "-A"（すでにあれば -B, -C…）
  const base = order.delivery_number || order.id.slice(0, 8)
  const { data: dup } = await supabase.from("orders").select("delivery_number").like("delivery_number", `${base}-%`)
  const used = new Set((dup || []).map(d => d.delivery_number))
  let suffix = "A"
  for (let c = 65; c <= 90; c++) { suffix = String.fromCharCode(c); if (!used.has(`${base}-${suffix}`)) break }

  const { data: created, error: e3 } = await supabase.from("orders").insert({
    clinic_id: order.clinic_id,
    status: order.status,
    total_price: sub(picked),
    delivery_number: `${base}-${suffix}`,
    sales_rep: order.sales_rep,
    source: order.source,
    note: `${order.note ? order.note + " " : ""}（一部納品：在庫あり分）`,
  }).select("id").single()
  if (e3 || !created) return { ok: false, error: "注文の切り分けに失敗しました: " + (e3?.message || "") }

  const { error: e4 } = await supabase.from("order_items").update({ order_id: created.id }).in("id", itemIds)
  if (e4) {
    await supabase.from("orders").delete().eq("id", created.id)   // 明細が動かなかったので、作った注文を取り消す
    return { ok: false, error: "明細の付け替えに失敗しました: " + e4.message }
  }
  await supabase.from("orders").update({ total_price: sub(rest) }).eq("id", orderId)

  await logOp("注文を一部納品用に分割", { entity: "order", id: orderId, detail: { new_order_id: created.id, new_delivery_number: `${base}-${suffix}`, items: itemIds.length, remaining: rest.length } })
  return { ok: true, orderId: created.id, split: true }
}
