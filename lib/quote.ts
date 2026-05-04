// 見積書まわりの共通ロジック

import { supabase } from "@/lib/supabase"

export const QUOTE_STATUSES = {
  draft: { label: "下書き", color: "#9ca3af" },
  sent: { label: "送付済", color: "#3b82f6" },
  accepted: { label: "承認", color: "#10b981" },
  converted: { label: "売上化済", color: "#8b5cf6" },
  rejected: { label: "拒否", color: "#dc2626" },
  expired: { label: "期限切れ", color: "#6b7280" },
} as const

export type QuoteStatus = keyof typeof QUOTE_STATUSES

// 見積番号採番（QUO-YYYYMM-NNN）
export async function generateQuoteNumber(issueDate: Date = new Date()): Promise<string> {
  const ym = `${issueDate.getFullYear()}${String(issueDate.getMonth() + 1).padStart(2, "0")}`
  const prefix = `QUO-${ym}-`
  const { data } = await supabase
    .from("quotes")
    .select("quote_number")
    .like("quote_number", `${prefix}%`)
  const max = (data || []).reduce((m, r: { quote_number: string }) => {
    const n = parseInt(r.quote_number.slice(prefix.length), 10)
    return Math.max(m, isNaN(n) ? 0 : n)
  }, 0)
  return prefix + String(max + 1).padStart(3, "0")
}

// 有効期限デフォルト = 発行日 + 30日
export function defaultExpiryDate(issueDate: Date): string {
  const d = new Date(issueDate)
  d.setDate(d.getDate() + 30)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
