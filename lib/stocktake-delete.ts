// 棚卸を削除する（確定前のものだけ）。確定した棚卸は、在庫を書き換えて履歴を残しているので、消さない。
import { supabase } from "@/lib/supabase"
import { logOp } from "@/lib/op-log"

export async function deleteStocktake(id: string, takenOn: string): Promise<{ ok: boolean; error?: string }> {
  const { data: st, error: e0 } = await supabase.from("stocktakes").select("status").eq("id", id).single()
  if (e0 || !st) return { ok: false, error: "棚卸が見つかりません" }
  if (st.status === "確定") return { ok: false, error: "確定した棚卸は削除できません" }
  const { count } = await supabase.from("stocktake_items").select("id", { count: "exact", head: true }).eq("stocktake_id", id)
  const { error: e1 } = await supabase.from("stocktake_items").delete().eq("stocktake_id", id)
  if (e1) return { ok: false, error: "明細の削除に失敗: " + e1.message }
  const { error: e2 } = await supabase.from("stocktakes").delete().eq("id", id)
  if (e2) return { ok: false, error: "棚卸の削除に失敗: " + e2.message }
  await logOp("棚卸を削除", { entity: "stocktake", id, detail: { taken_on: takenOn, status: st.status, items: count ?? null } })
  return { ok: true }
}
