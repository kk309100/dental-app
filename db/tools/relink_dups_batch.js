// コードなしの重複医院に付いている履歴（history_lines）と注文を、使用中の医院（コードあり）に付け替える。
// 使い方: node db/tools/relink_dups_batch.js [--apply]   （--apply なしは、件数の確認のみ）
const fs = require('fs')
const { createClient } = require('@supabase/supabase-js')
const rd = (f, k) => (fs.readFileSync(f, 'utf8').match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1].trim().replace(/^["']|["']$/g, '')
const db = createClient('https://alcetorurdocopxatego.supabase.co', rd('.env.local', 'SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const APPLY = process.argv.includes('--apply')
const PAIRS = [
  { dupName: '清翔会 名古屋茶屋歯科・矯正歯科', toCode: '602' },
  { dupName: '正翔会 安城さくらい歯科・矯正歯科', toCode: '615' },
  { dupName: '北名古屋みらい歯科・矯正歯科', toCode: '607' },
]
;(async () => {
  const { data: cl } = await db.from('clinics').select('id,name,clinic_code')
  const log = []
  for (const p of PAIRS) {
    const dup = cl.find(c => c.name === p.dupName && !c.clinic_code), main = cl.find(c => String(c.clinic_code) === p.toCode)
    if (!dup || !main) { console.log('見つからない:', p.dupName, p.toCode); continue }
    const { count: hc } = await db.from('history_lines').select('id', { count: 'exact', head: true }).eq('clinic_id', dup.id)
    const { data: ords } = await db.from('orders').select('id').eq('clinic_id', dup.id)
    console.log(`${p.dupName}: 履歴 ${hc}行 / 注文 ${(ords || []).length}件 → [${p.toCode}] ${main.name}`)
    log.push({ from: dup.id, to: main.id, name: p.dupName, orders: (ords || []).map(o => o.id), history: hc })
    if (!APPLY) continue
    let moved = 0
    for (;;) {
      const { data, error } = await db.from('history_lines').select('id').eq('clinic_id', dup.id).order('id').limit(500)
      if (error) throw error; if (!data.length) break
      const { error: e } = await db.from('history_lines').update({ clinic_id: main.id }).in('id', data.map(x => x.id)); if (e) throw e
      moved += data.length
    }
    if ((ords || []).length) { const { error } = await db.from('orders').update({ clinic_id: main.id }).in('id', ords.map(o => o.id)); if (error) throw error }
    const { count } = await db.from('history_lines').select('id', { count: 'exact', head: true }).eq('clinic_id', main.id)
    console.log(`  付け替え完了: 履歴 ${moved}行 / 注文 ${(ords || []).length}件 → 移し先の履歴 ${count}行`)
  }
  if (APPLY) fs.writeFileSync('C:/Users/user/Downloads/重複医院の履歴付け替え_元に戻す用.json', JSON.stringify(log))
  if (!APPLY) console.log('（確認のみ。書き込みはしていません）')
})().catch(e => { console.error('失敗', e.message || e); process.exit(1) })
