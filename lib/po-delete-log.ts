// 発注書を消すとき、「いつ・どの画面で・どの発注書を・中身は何か」を履歴に残してから消す。
// 履歴の表（po_delete_log）が無くても、消す処理は、そのまま動く。
import { supabase } from "@/lib/supabase"

export async function deletePoLogged(poId: string, where: string) {
  try {
    const { data: po } = await supabase.from("purchase_orders").select("po_number,status,supplier_id,total_amount").eq("id", poId).single()
    const { data: lines } = await supabase.from("purchase_order_items").select("product_name,quantity,received_quantity,note").eq("purchase_order_id", poId)
    await supabase.from("po_delete_log").insert({
      po_id: poId, po_number: po?.po_number || null, status: po?.status || null, supplier_id: po?.supplier_id || null,
      total_amount: po?.total_amount ?? null, where_deleted: where, lines: lines || [],
    })
  } catch { /* 履歴の失敗で、消す処理は止めない */ }
  return await supabase.from("purchase_orders").delete().eq("id", poId)
}
