// 発注書を消すとき、「いつ・どの画面で・どの発注書を・中身は何か」を履歴に残してから消す。
// 履歴の表（po_delete_log）が無くても、消す処理は、そのまま動く。
import { supabase } from "@/lib/supabase"
import { logOp } from "@/lib/op-log"

export async function deletePoLogged(poId: string, where: string) {
  try {
    const { data: po } = await supabase.from("purchase_orders").select("po_number,status,supplier_id,total_amount").eq("id", poId).single()
    const { data: lines } = await supabase.from("purchase_order_items").select("product_name,quantity,received_quantity,note").eq("purchase_order_id", poId)
    await supabase.from("po_delete_log").insert({
      po_id: poId, po_number: po?.po_number || null, status: po?.status || null, supplier_id: po?.supplier_id || null,
      total_amount: po?.total_amount ?? null, where_deleted: where, lines: lines || [],
    })
  } catch { /* 履歴の失敗で、消す処理は止めない */ }
  await logOp("発注書を削除", { entity: "purchase_order", id: poId, detail: { where } })
  return await supabase.from("purchase_orders").delete().eq("id", poId)
}

// 発注書（または、その1行）を消す・取り消すとき、「まだ有効な注文に結びついた行」があれば、確認文に足す警告を返す（無ければ空）。
// 注文の商品は残ったまま、発注書だけが無くなる、という状態を、消す前に気づけるようにする。
const nextPrefix = (p: string) => { const a = p.split(""); for (let i = a.length - 1; i >= 0; i--) { if (a[i] === "-") continue; const v = parseInt(a[i], 16); if (v < 15) { a[i] = (v + 1).toString(16); return a.join("") } a[i] = "0" } return p }

export async function linkedOrderWarning(opts: { poId?: string; itemId?: string }): Promise<string> {
  try {
    let q = supabase.from("purchase_order_items").select("product_name,note,source_order_item_id,received_quantity")
    q = opts.itemId ? q.eq("id", opts.itemId) : q.eq("purchase_order_id", opts.poId || "")
    const { data: lines } = await q
    const alive: string[] = []
    for (const l of lines || []) {
      const full = l.source_order_item_id as string | null
      const pre = full ? full.slice(0, 8) : (String(l.note || "").match(/明細([0-9a-f]{8})/i)?.[1] || "").toLowerCase()
      if (!pre) continue
      const lo = pre + "-0000-0000-0000-000000000000", hi = nextPrefix(pre) + "-0000-0000-0000-000000000000"
      const { data: oi } = await supabase.from("order_items").select("id").gte("id", lo).lt("id", hi).limit(1)
      if (oi && oi.length > 0) alive.push(l.product_name || "商品")
    }
    if (alive.length === 0) return ""
    return `\n\n⚠ まだ有効な注文に結びついた行が ${alive.length}件 あります（${alive.slice(0, 3).join("、")}${alive.length > 3 ? " ほか" : ""}）。\n消すと、注文の商品は残ったまま、発注書だけが無くなります。`
  } catch { return "" }
}
