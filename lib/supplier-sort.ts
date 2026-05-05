// 仕入先を「使用頻度順」にソートするヘルパー
// purchase_orders テーブルから supplier_id ごとの使用回数 + 最終使用日時を集計
// 発注のたびに自動で並び順が更新される（再フェッチで反映）

import { supabase } from "@/lib/supabase"

export type Supplier = {
  id: string
  name: string
  // 集計後に付与
  usage_count?: number
  last_used_at?: string | null
}

/**
 * suppliers を取得して使用頻度順にソートして返す。
 * 1. 使用回数（多い順）
 * 2. 最終使用日時（新しい順）
 * 3. 名前（あいうえお順）
 *
 * @param fields suppliers から取得する追加カラム（カンマ区切り）
 */
export async function fetchSuppliersByUsage(fields = "id,name"): Promise<Supplier[]> {
  const [{ data: sups }, { data: pos }] = await Promise.all([
    supabase.from("suppliers").select(fields),
    supabase.from("purchase_orders").select("supplier_id,created_at,ordered_at"),
  ])
  const usage = new Map<string, { count: number; lastAt: string }>()
  ;(pos || []).forEach((p: { supplier_id: string | null; created_at: string | null; ordered_at: string | null }) => {
    if (!p.supplier_id) return
    const t = p.ordered_at || p.created_at || ""
    const e = usage.get(p.supplier_id) || { count: 0, lastAt: "" }
    e.count += 1
    if (t > e.lastAt) e.lastAt = t
    usage.set(p.supplier_id, e)
  })
  const list: Supplier[] = ((sups as Supplier[]) || []).map(s => ({
    ...s,
    usage_count: usage.get(s.id)?.count || 0,
    last_used_at: usage.get(s.id)?.lastAt || null,
  }))
  // 主力仕入先のキーワード（名前に含まれていれば最上位に固定）
  const PINNED_KEYWORDS = ["リンク", "ササキ", "イシダ"]
  const isPinned = (name: string) => PINNED_KEYWORDS.some(kw => name.includes(kw))

  return list.sort((a, b) => {
    const ap = isPinned(a.name) ? 1 : 0
    const bp = isPinned(b.name) ? 1 : 0
    if (ap !== bp) return bp - ap
    // ピン留め同士は PINNED_KEYWORDS の順序で
    if (ap === 1) {
      const ai = PINNED_KEYWORDS.findIndex(kw => a.name.includes(kw))
      const bi = PINNED_KEYWORDS.findIndex(kw => b.name.includes(kw))
      if (ai !== bi) return ai - bi
    }
    if ((b.usage_count || 0) !== (a.usage_count || 0)) return (b.usage_count || 0) - (a.usage_count || 0)
    if ((b.last_used_at || "") !== (a.last_used_at || "")) return (b.last_used_at || "").localeCompare(a.last_used_at || "")
    return a.name.localeCompare(b.name, "ja")
  })
}

/**
 * select option 用ラベル。シンプルに名前だけ。
 * (使用頻度・最終使用日は内部ソートのみに使い、表示には出さない)
 */
export function supplierOptionLabel(s: Supplier): string {
  return s.name
}
