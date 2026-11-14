// 注文の明細を消すとき、結びついた発注書の行をどうするか
// 結びつきは、発注書の行の備考にある「明細xxxxxxxx」（注文明細IDの先頭8桁）で見る。
//   下書き（発注プール）で、入荷前の行 … 行を消す（行が無くなった下書きは、発注書ごと消す）
//   送信済み（発注済・部分入荷）で、入荷前の行 … 行を消して、発注書に「変更あり」の印を付ける（仕入先へ連絡が必要）
//   入荷が始まっている／入荷済みの行 … 変えない（お知らせだけ）
import { deletePoLogged } from "@/lib/po-delete-log"
import { supabase } from "@/lib/supabase"
import { markPoChanged, recalcPoTotal } from "@/lib/po-change-log"

type Line = { id: string; poId: string; name: string; received: boolean }
type Plan = { draft: Line[]; sent: Line[]; kept: Line[]; heads: Map<string, { status: string; po_number: string }> }

const SENT = ["発注済", "部分入荷"]
// まだ仕入先に送っていない発注書（下書き・未送付）
const UNSENT = ["下書き", "未送付"]

/** 消す明細に結びついた発注書の行を調べる（まだ何も変えない） */
export async function planPoDetach(orderItemIds: string[]): Promise<Plan> {
  const lines: Line[] = []
  for (const id of orderItemIds) {
    const { data } = await supabase.from("purchase_order_items").select("id,purchase_order_id,product_name,received_quantity").ilike("note", `%明細${id.slice(0, 8)}%`)
    for (const pl of data || []) lines.push({ id: pl.id, poId: pl.purchase_order_id, name: pl.product_name || "商品", received: Number(pl.received_quantity || 0) > 0 })
  }
  const heads = new Map<string, { status: string; po_number: string }>()
  const poIds = Array.from(new Set(lines.map(l => l.poId)))
  if (poIds.length) {
    const { data: hs } = await supabase.from("purchase_orders").select("id,status,po_number").in("id", poIds)
    for (const h of hs || []) heads.set(h.id, { status: h.status, po_number: h.po_number })
  }
  const live = lines.filter(l => heads.get(l.poId)?.status !== "取消")
  const draft = live.filter(l => UNSENT.includes(heads.get(l.poId)?.status || "") && !l.received)
  const sent = live.filter(l => SENT.includes(heads.get(l.poId)?.status || "") && !l.received)
  const kept = live.filter(l => !draft.includes(l) && !sent.includes(l))
  return { draft, sent, kept, heads }
}

/** 確認のメッセージに使う、1〜3行の説明（結びついた行が無ければ空） */
export function describePoDetach(p: Plan): string {
  const m: string[] = []
  if (p.draft.length) m.push(`・まだ送っていない発注書（下書き・未送付）の ${p.draft.length}行 は、いっしょに消します`)
  if (p.sent.length) m.push(`・送信済みの発注書の ${p.sent.length}行 も消して、その発注書に「変更あり」の印を付けます（仕入先への連絡が必要です）`)
  if (p.kept.length) m.push(`・入荷が始まっている／発注書が入荷済み・取消などの ${p.kept.length}行 は、変えません`)
  return m.length ? "\n\n結びついた発注書の行:\n" + m.join("\n") : ""
}

/** 調べた内容のとおりに、発注書の行を直す。戻り値は、保存のあとに知らせる内容 */
export async function applyPoDetach(p: Plan, reason: string): Promise<string[]> {
  const notes: string[] = []
  const touched = new Set<string>()
  for (const l of [...p.draft, ...p.sent]) { await supabase.from("purchase_order_items").delete().eq("id", l.id); touched.add(l.poId) }
  for (const poId of Array.from(touched)) {
    const { count } = await supabase.from("purchase_order_items").select("id", { count: "exact", head: true }).eq("purchase_order_id", poId)
    if ((count || 0) === 0 && UNSENT.includes(p.heads.get(poId)?.status || "")) await deletePoLogged(poId, "注文の削除・明細の削除")
    else await recalcPoTotal(poId)
  }
  const changes = new Map<string, string[]>()
  for (const l of p.sent) changes.set(l.poId, [...(changes.get(l.poId) || []), `「${l.name}」を削除（${reason}）`])
  for (const [poId, texts] of Array.from(changes)) {
    await markPoChanged(poId, texts)
    notes.push(`・発注書 ${p.heads.get(poId)?.po_number || ""} に「変更あり」の印を付けました。仕入先へ連絡してください`)
  }
  for (const l of p.kept) notes.push(`・${l.name}（発注書 ${p.heads.get(l.poId)?.po_number || ""}・${p.heads.get(l.poId)?.status || ""}）… ${l.received ? "入荷が始まっているので" : "発注書の状態のため"}、発注書の行は消していません`)
  return notes
}
