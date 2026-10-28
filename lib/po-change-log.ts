// 発注書の「変更あり」の印
// 注文の編集で、送信済みの発注書の行を変えたときに、変えた内容を発注書に残す。
// 仕入先への再送や連絡が必要だと分かるように、発注書の一覧と詳細に出す。連絡したら、「連絡済みにする」で消す。
import { supabase } from "@/lib/supabase"

/** 発注書の合計金額を、明細から計算し直す */
export async function recalcPoTotal(poId: string): Promise<void> {
  const { data: rest } = await supabase.from("purchase_order_items").select("quantity,unit_price").eq("purchase_order_id", poId)
  const total = (rest || []).reduce((n, r) => n + Number(r.quantity) * Number(r.unit_price || 0), 0)
  await supabase.from("purchase_orders").update({ total_amount: total }).eq("id", poId)
}

/** 発注書に、変えた内容を追記して、「変更あり」の印を付ける */
export async function markPoChanged(poId: string, texts: string[]): Promise<void> {
  if (texts.length === 0) return
  const { data } = await supabase.from("purchase_orders").select("change_log").eq("id", poId).single()
  const d = new Date()
  const stamp = `${d.getMonth() + 1}/${d.getDate()}`
  const added = texts.map(t => `${stamp} ${t}`).join("\n")
  const prev = (data as { change_log?: string | null } | null)?.change_log
  await supabase.from("purchase_orders").update({ change_log: prev ? `${prev}\n${added}` : added }).eq("id", poId)
}

/** 仕入先へ連絡したので、印を消す */
export async function clearPoChanged(poId: string): Promise<void> {
  await supabase.from("purchase_orders").update({ change_log: null }).eq("id", poId)
}
