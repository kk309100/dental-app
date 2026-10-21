// 注文管理（直送の入荷済み数 = order_items.delivered_quantity）と、発注書の入荷数（purchase_order_items.received_quantity）の食い違いをそろえる。
// 対象: 未納品の注文の商品で、直送の入荷済み数 > 発注書の入荷数 のもの。発注書の入荷数を、直送の入荷済み数に合わせる（発注数を超えない）。
// 使い方: node db/tools/reconcile_po_received.js [--apply]   （--apply なしは、一覧の確認のみ）
const fs = require('fs')
const { createClient } = require('@supabase/supabase-js')
const rd = (f, k) => (fs.readFileSync(f, 'utf8').match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1].trim().replace(/^["']|["']$/g, '')
const db = createClient('https://alcetorurdocopxatego.supabase.co', rd('.env.local', 'SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const APPLY = process.argv.includes('--apply')
async function all(t, cols) { let o = [], f = 0; for (;;) { const { data, error } = await db.from(t).select(cols).order('id').range(f, f + 999); if (error) throw error; o = o.concat(data); if (data.length < 1000) break; f += 1000 } return o }
;(async () => {
  const pos = await all('purchase_orders', 'id,po_number,status')
  const live = new Map(pos.filter(p => p.status !== '取消').map(p => [p.id, p]))
  const pit = (await all('purchase_order_items', 'id,purchase_order_id,product_name,quantity,received_quantity,note')).filter(x => live.has(x.purchase_order_id))
  const orders = new Map((await all('orders', 'id,status,delivery_number')).map(o => [o.id, o]))
  const oitems = await all('order_items', 'id,order_id,product_name,quantity,delivered_quantity')
  const byPrefix = new Map(oitems.map(o => [o.id.slice(0, 8).toLowerCase(), o]))
  const groups = new Map()   // 注文明細の先頭8桁 → その発注書明細（複数のことがある）
  pit.forEach(x => { const m = String(x.note || '').match(/明細([0-9a-f]{8})/i); if (m) { const k = m[1].toLowerCase(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x) } })
  const plan = []
  for (const [k, lines] of groups) {
    const it = byPrefix.get(k); if (!it) continue
    const o = orders.get(it.order_id); if (!o || ['納品済み', '納品済', 'キャンセル', '取消'].includes(o.status)) continue
    const deliv = Number(it.delivered_quantity || 0), ordered = lines.reduce((s, l) => s + Number(l.quantity || 0), 0), recv = lines.reduce((s, l) => s + Number(l.received_quantity || 0), 0)
    if (!(deliv > recv)) continue
    let need = Math.min(ordered, deliv) - recv; if (need <= 0) continue
    for (const l of lines.slice().sort((a, b) => (Number(a.received_quantity || 0) - Number(a.quantity)) - (Number(b.received_quantity || 0) - Number(b.quantity)))) {
      const room = Number(l.quantity) - Number(l.received_quantity || 0); const step = Math.min(room, need); if (step <= 0) continue
      plan.push({ id: l.id, poId: l.purchase_order_id, po: live.get(l.purchase_order_id).po_number, order: o.delivery_number, name: String(it.product_name || '').slice(0, 24), before: Number(l.received_quantity || 0), after: Number(l.received_quantity || 0) + step, ordered: Number(l.quantity) })
      need -= step; if (need <= 0) break
    }
  }
  console.log(`直す発注書の明細 ${plan.length}件`)
  plan.forEach(p => console.log(`  ${p.order}  ${p.name.padEnd(24)} 発注書${p.po}  入荷 ${p.before} → ${p.after}（発注${p.ordered}）`))
  if (!APPLY) { console.log('（確認のみ。書き込みはしていません）'); return }
  fs.writeFileSync(`C:/Users/user/Downloads/発注書の入荷数_変更前_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`, JSON.stringify(plan, null, 1))
  let ok = 0; for (const p of plan) { const { error } = await db.from('purchase_order_items').update({ received_quantity: p.after }).eq('id', p.id); if (error) console.log('失敗', p.name, error.message); else ok++ }
  // 発注書の状態を判定し直す
  const touched = [...new Set(plan.map(p => p.poId))]; let changed = 0
  for (const poId of touched) {
    const { data: ls } = await db.from('purchase_order_items').select('quantity,received_quantity').eq('purchase_order_id', poId)
    const po = live.get(poId); if (!ls || ['未送付', '下書き'].includes(po.status)) continue
    const done = ls.every(r => Number(r.received_quantity || 0) >= Number(r.quantity)), some = ls.some(r => Number(r.received_quantity || 0) > 0)
    const status = done ? '入荷済' : some ? '部分入荷' : '発注済'
    if (status !== po.status) { const { error } = await db.from('purchase_orders').update({ status }).eq('id', poId); if (!error) { changed++; console.log(`  発注書 ${po.po_number}: ${po.status} → ${status}`) } }
  }
  console.log(`完了: 入荷数を直した ${ok}件 / 状態が変わった発注書 ${changed}件`)
})().catch(e => { console.error('失敗', e.message || e); process.exit(1) })
