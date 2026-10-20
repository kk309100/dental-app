// 請求書の削除。注文との紐づけを外し、請求書そのものを消す（元に戻せない）。
// 入金の記録がある請求書は、先に入金の記録を削除してもらうため、消さない。
import { supabase } from "@/lib/supabase"

export async function deleteInvoice(invoiceId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: inv, error: ie } = await supabase.from("invoices").select("id,status,paid_amount").eq("id", invoiceId).single()
  if (ie || !inv) return { ok: false, error: ie?.message || "請求書が見つかりません" }
  const { count: payCount } = await supabase.from("invoice_payments").select("id", { count: "exact", head: true }).eq("invoice_id", invoiceId)
  if ((payCount || 0) > 0 || Number(inv.paid_amount || 0) > 0) return { ok: false, error: "入金の記録がある請求書は、削除できません。先に、入金の記録を削除してください。" }
  const { error: oe } = await supabase.from("orders").update({ invoice_id: null }).eq("invoice_id", invoiceId)
  if (oe) return { ok: false, error: "注文の紐づけを外せませんでした: " + oe.message }
  try { await supabase.from("invoice_items").delete().eq("invoice_id", invoiceId) } catch { /* この表が無い環境では、そのまま進む */ }
  const { error: de } = await supabase.from("invoices").delete().eq("id", invoiceId)
  if (de) return { ok: false, error: "請求書の削除に失敗しました: " + de.message }
  return { ok: true }
}
