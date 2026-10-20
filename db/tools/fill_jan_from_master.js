// 商品の barcode 欄（JAN）を、DataLandのマスター（master_products.jan）から入れる。
//  A) すでにマスターに紐づいている商品 … barcode が空で、マスターにJANがあれば、入れる
//  B) 紐づいていない商品 … 商品名がマスターと完全に同じ（マスターで1件に決まる）なら、マスターに紐づけて、JANも入れる
// barcode がすでに入っている商品は触らない。書き込む前の値は Downloads に保存する。
// 使い方: node db/tools/fill_jan_from_master.js [--apply] [--box]   （--box: やり直し用の箱にも、同じ商品IDに、同じbarcodeを入れる）
const fs = require('fs')
const { createClient } = require('@supabase/supabase-js')
const rd = (f, k) => (fs.readFileSync(f, 'utf8').match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1].trim().replace(/^["']|["']$/g, '')
const db = createClient('https://alcetorurdocopxatego.supabase.co', rd('.env.local', 'SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const APPLY = process.argv.includes('--apply'), BOX = process.argv.includes('--box')
const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '')
// JANの形をそろえる: 数字だけにして、JAN-13（13桁）にする。先頭に0が付いた14桁は0を1つ取る。8桁以下（JAN-8）は、そのまま
function jan13(v) {
  let d = String(v || '').normalize('NFKC').replace(/\D/g, '')
  if (!d) return ''
  if (d.length <= 8) return d.length === 8 ? d : ''
  d = d.replace(/^0+(?=\d{13}$)/, '')           // 14桁以上で、先頭の0を取って13桁になるもの
  if (d.length < 13) d = d.padStart(13, '0')
  return d.length === 13 ? d : ''
}
async function all(client, t, cols, qf = q => q) { let o = [], f = 0; for (;;) { const { data, error } = await qf(client.from(t).select(cols)).order('id').range(f, f + 999); if (error) throw error; o = o.concat(data); if (data.length < 1000) break; f += 1000 } return o }
async function pool(items, n, fn) { let i = 0; const out = []; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]) } })); return out }

;(async () => {
  const prods = await all(db, 'products', 'id,name,barcode,master_product_id')
  // A) 紐づき済み
  const linkedIds = [...new Set(prods.filter(p => p.master_product_id).map(p => p.master_product_id))]
  const masterById = new Map()
  for (let i = 0; i < linkedIds.length; i += 100) { const { data } = await db.from('master_products').select('id,jan,name').in('id', linkedIds.slice(i, i + 100)); data.forEach(m => masterById.set(m.id, m)) }
  const plan = []
  for (const p of prods.filter(p => p.master_product_id && !p.barcode)) {
    const j = jan13(masterById.get(p.master_product_id)?.jan); if (j) plan.push({ id: p.id, name: p.name, before: { barcode: p.barcode ?? null, master_product_id: p.master_product_id }, patch: { barcode: j }, kind: 'A' })
  }
  // B) 名前が完全一致（マスター側で1件に決まるもの）
  const masters = await all(db, 'master_products', 'id,jan,name')
  const byName = new Map(); masters.forEach(m => { const n = norm(m.name); if (!byName.has(n)) byName.set(n, []); byName.get(n).push(m) })
  for (const p of prods.filter(p => !p.master_product_id && !p.barcode)) {
    const arr = byName.get(norm(p.name)); if (!arr || arr.length !== 1) continue
    const j = jan13(arr[0].jan); if (!j) continue
    plan.push({ id: p.id, name: p.name, before: { barcode: p.barcode ?? null, master_product_id: null }, patch: { barcode: j, master_product_id: arr[0].id }, kind: 'B' })
  }
  // 同じJANが、複数の商品に入ってしまうものは、除く（取り違えを避ける）
  const cnt = new Map(); plan.forEach(x => cnt.set(x.patch.barcode, (cnt.get(x.patch.barcode) || 0) + 1))
  const existing = new Set(prods.map(p => jan13(p.barcode)).filter(Boolean))
  const dupSkipped = plan.filter(x => cnt.get(x.patch.barcode) > 1 || existing.has(x.patch.barcode))
  const final = plan.filter(x => !(cnt.get(x.patch.barcode) > 1 || existing.has(x.patch.barcode)))
  console.log(`A(紐づき済みに、JANを入れる) ${final.filter(x => x.kind === 'A').length}件 / B(名前一致で、紐づけてJANを入れる) ${final.filter(x => x.kind === 'B').length}件 / 同じJANが重なるため除く ${dupSkipped.length}件`)
  final.slice(0, 4).forEach(x => console.log('  例', x.kind, x.name.slice(0, 26), JSON.stringify(x.patch).slice(0, 80)))
  if (!APPLY) { console.log('（確認のみ。書き込みはしていません）'); return }

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  fs.writeFileSync(`C:/Users/user/Downloads/JAN紐づけ_変更前_${stamp}.json`, JSON.stringify(final.map(x => ({ id: x.id, name: x.name, before: x.before })), null, 0))
  let ok = 0, ng = 0
  await pool(final, 15, async x => { const { error } = await db.from('products').update(x.patch).eq('id', x.id); if (error) { ng++; if (ng <= 3) console.log('失敗', x.name, error.message) } else ok++ })
  console.log(`本番: 成功 ${ok} / 失敗 ${ng}`)

  if (BOX) {
    const box = createClient(rd('.env.new', 'NEXT_PUBLIC_SUPABASE_URL'), rd('.env.new', 'SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
    const boxProds = new Map((await all(box, 'products', 'id,barcode')).map(p => [p.id, p]))
    const targets = final.filter(x => boxProds.has(x.id) && !boxProds.get(x.id).barcode)
    let bo = 0, bn = 0
    await pool(targets, 15, async x => { const { error } = await box.from('products').update({ barcode: x.patch.barcode }).eq('id', x.id); if (error) bn++; else bo++ })
    console.log(`やり直し用: 成功 ${bo} / 失敗 ${bn}（barcodeのみ。マスターへの紐づけは、箱にマスターが無いため、していません）`)
  }
})().catch(e => { console.error('失敗', e.message || e); process.exit(1) })
