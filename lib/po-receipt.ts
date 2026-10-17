// 発注書の入荷（在庫に加算される入荷）を取り消す。
// 発注書の明細の入荷数・商品の在庫・仕入納品一覧（stock_receipts）・発注書の状態を、同じ数だけ戻す。
// 取り消しの記録は、在庫の動き（stock_movements）に「入庫取消」で残る。
import { supabase } from "@/lib/supabase"

export async function cancelPoLineReceipt(poItemId: string, qty: number): Promise<{ ok: boolean; error?: string; cancelled?: number }> {
  const { data: line, error: le } = await supabase.from("purchase_order_items")
    .select("id,purchase_order_id,product_id,quantity,received_quantity").eq("id", poItemId).single()
  if (le || !line) return { ok: false, error: le?.message || "発注書の明細が見つかりません" }
  const received = Number(line.received_quantity || 0)
  const n = Math.min(Math.max(0, Math.floor(qty)), received)
  if (n <= 0) return { ok: false, error: "取り消せる入荷がありません" }

  const { data: po } = await supabase.from("purchase_orders").select("id,po_number,status").eq("id", line.purchase_order_id).single()
  const poLabel = String(po?.po_number || String(line.purchase_order_id).slice(0, 8))

  // 在庫を戻す（マイナスになるときは確認）
  if (line.product_id) {
    const { data: p } = await supabase.from("products").select("stock").eq("id", line.product_id).single()
    const before = Number(p?.stock || 0), after = before - n
    if (after < 0 && typeof window !== "undefined" && !window.confirm(`在庫が ${before} → ${after} とマイナスになります（すでに出荷・納品した分が含まれている可能性があります）。続けますか？`)) {
      return { ok: false, error: "キャンセルしました" }
    }
    const { error: ue } = await supabase.from("products").update({ stock: after }).eq("id", line.product_id)
    if (ue) return { ok: false, error: "在庫の更新に失敗: " + ue.message }
    try {
      await supabase.from("stock_movements").insert({
        product_id: line.product_id, movement_type: "入庫取消", quantity: -n, before_stock: before, after_stock: after,
        ref_type: "purchase_order_item", ref_id: poItemId, reason: `発注書 ${poLabel} の入荷取消`,
      })
    } catch { /* 記録のみ */ }

    // 仕入納品一覧の記録（新しいものから）を同じ数だけ減らす
    const { data: recs } = await supabase.from("stock_receipts").select("id,quantity,supplier_invoice_item_id")
      .eq("product_id", line.product_id).ilike("memo", `発注書 ${poLabel}%`).order("created_at", { ascending: false })
    let left = n
    for (const r of recs || []) {
      if (left <= 0) break
      if (r.supplier_invoice_item_id) continue   // 月次請求書と付け合わせ済みは触らない
      const q = Number(r.quantity || 0)
      if (q <= left) { await supabase.from("stock_receipts").delete().eq("id", r.id); left -= q }
      else { await supabase.from("stock_receipts").update({ quantity: q - left }).eq("id", r.id); left = 0 }
    }
  }

  const { error: pe } = await supabase.from("purchase_order_items").update({ received_quantity: received - n }).eq("id", poItemId)
  if (pe) return { ok: false, error: "発注書の入荷数の更新に失敗: " + pe.message }

  // 発注書の状態を判定し直す
  const { data: all } = await supabase.from("purchase_order_items").select("quantity,received_quantity").eq("purchase_order_id", line.purchase_order_id)
  if (all && po && po.status !== "取消" && po.status !== "未送付" && po.status !== "下書き") {
    const done = all.every(r => Number(r.received_quantity || 0) >= Number(r.quantity))
    const some = all.some(r => Number(r.received_quantity || 0) > 0)
    const status = done ? "入荷済" : some ? "部分入荷" : "発注済"
    if (status !== po.status) await supabase.from("purchase_orders").update({ status }).eq("id", line.purchase_order_id)
  }
  return { ok: true, cancelled: n }
}
