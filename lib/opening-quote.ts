// 開設見積書: 複数の個別見積（内訳）を、1つの見積書にまとめる。
// 内訳は、個別見積の「見積番号」で組み込む（個別見積の内容を、そのまま参照する）。
import { supabase } from "@/lib/supabase"

export const FIRST_MANAGE_NO = 100079   // 旧システムの続きの番号

export type OpeningQuote = {
  id: string; manage_no: number; clinic_id: string | null; title: string | null; issue_date: string | null
  delivery_date: string | null; delivery_place: string | null; inspection_period: string | null; payment_terms: string | null; expiry_text: string | null
  discount: number; note: string | null; subtotal: number; tax: number; total: number; section_count: number; status: string; order_id: string | null; created_at: string
}
export type QuoteLite = { id: string; quote_number: string; title: string | null; subtotal: number | null; total: number | null; clinic_id: string | null }
export type QuoteItem = { id: string; quote_id: string; product_id: string | null; product_name: string | null; quantity: number; price: number; list_price: number | null; cost: number | null; sort_order: number | null }
export type SectionRow = { quote_id: string; title_override: string }

export async function nextManageNo(): Promise<number> {
  const { data } = await supabase.from("opening_quotes").select("manage_no").order("manage_no", { ascending: false }).limit(1)
  const max = data && data.length > 0 ? Number(data[0].manage_no) : FIRST_MANAGE_NO - 1
  return Math.max(max + 1, FIRST_MANAGE_NO)
}

/** 見積番号（一部でも可）で、個別見積を探す */
export async function findQuotes(input: string): Promise<QuoteLite[]> {
  const k = input.trim()
  if (!k) return []
  const { data } = await supabase.from("quotes").select("id,quote_number,title,subtotal,total,clinic_id").ilike("quote_number", `%${k}%`).order("quote_number", { ascending: false }).limit(10)
  return (data as QuoteLite[]) || []
}

export async function loadQuoteItems(quoteIds: string[]): Promise<QuoteItem[]> {
  if (quoteIds.length === 0) return []
  const { data } = await supabase.from("quote_items").select("id,quote_id,product_id,product_name,quantity,price,list_price,cost,sort_order").in("quote_id", quoteIds).order("sort_order")
  return (data as QuoteItem[]) || []
}

/** 内訳1つぶんの、金額（税別）・定価合計・利益・利益率 */
export function sectionStats(items: QuoteItem[]) {
  let total = 0, list = 0, cost = 0, costed = 0
  for (const it of items) {
    const q = Number(it.quantity || 0), p = Number(it.price || 0)
    total += q * p
    list += q * Number(it.list_price || 0)
    if (Number(it.cost || 0) > 0) { cost += q * Number(it.cost); costed += q * p }
  }
  const profit = costed > 0 ? costed - cost : 0
  return { total, list, profit, rate: costed > 0 ? Math.round(profit / costed * 1000) / 10 : null as number | null }
}
