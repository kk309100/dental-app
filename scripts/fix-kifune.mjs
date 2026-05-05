import { createClient } from "@supabase/supabase-js"
const supabase = createClient(
  "https://alcetorurdocopxatego.supabase.co",
  "sb_publishable_VbmRpikpm6xr_lUaqo_MgQ_9swmJ_1j"
)

const orderId = "d8ee1fef-3bf9-433f-ae94-7e26f5718c92"
const clinicId = "8d446757-c2bd-45e7-89b2-c642114bf061"

const today = new Date()
const todayStr = today.toISOString().slice(0, 10)

const { data: items } = await supabase.from("order_items").select("*").eq("order_id", orderId)
const total = items.reduce((s, it) => s + Number(it.price) * Number(it.quantity), 0)
console.log(`明細 ${items.length} 件, 合計 ¥${total.toLocaleString()}`)

const { data: slip, error: slipErr } = await supabase.from("delivery_slips").insert({
  slip_number: "DS-20260505-0011",
  clinic_id: clinicId,
  delivered_on: todayStr,
  total_amount: total,
  status: "出荷済",
  shipped_at: today.toISOString(),
}).select().single()
if (slipErr) { console.log("納品書失敗:", slipErr.message); process.exit(1) }
console.log("✓ 納品書作成:", slip.slip_number)

const { error: updErr } = await supabase.from("orders").update({
  status: "納品済み",
  delivered_at: today.toISOString(),
  delivery_slip_id: slip.id,
}).eq("id", orderId)
if (updErr) console.log("注文更新（FB）:", updErr.message)
else console.log("✓ 注文を納品済みに")

for (const it of items) {
  if (!it.product_id) continue
  const { data: prod } = await supabase.from("products").select("stock").eq("id", it.product_id).single()
  if (prod) {
    const newStock = Math.max(0, Number(prod.stock || 0) - Number(it.quantity))
    await supabase.from("products").update({ stock: newStock }).eq("id", it.product_id)
  }
}
console.log("✓ 在庫減算完了")

await supabase.from("orders").update({ delivery_slip_id: null }).eq("delivery_slip_id", "50ac5fef-2d27-4e60-8352-22c77baaa950")
const { error: delErr } = await supabase.from("delivery_slips").delete().eq("id", "50ac5fef-2d27-4e60-8352-22c77baaa950")
if (delErr) console.log("古いslip削除失敗:", delErr.message)
else console.log("✓ 古い孤児納品書 (DS-20260505-0001) 削除")

console.log("完了")
