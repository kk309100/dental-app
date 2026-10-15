// すずらん歯科（医院コード18）: 履歴が、コードの無い重複医院・未紐づきの旧名称のままで、使用中の医院に出ない問題を直す（エスカ等と同じ）。
// 使い方: node db/tools/relink_suzuran.js [--apply]   （--apply なしは、件数の確認のみ）
const fs = require('fs')
const { createClient } = require('@supabase/supabase-js')
const env = fs.readFileSync('.env.local', 'utf8')
const g = k => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1].trim().replace(/^["']|["']$/g, '')
const db = createClient('https://alcetorurdocopxatego.supabase.co', g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const APPLY = process.argv.includes('--apply')
;(async () => {
  const { data: cl } = await db.from('clinics').select('id,name,clinic_code')
  const main = cl.find(x => String(x.clinic_code) === '18')
  const dup = cl.find(x => x.name === 'はなぶさ会 すずらん歯科矯正歯科')
  if (!main || !dup) throw new Error('医院が見つかりません')
  const MAP = [
    { label: '重複医院(コードなし) → コード18', q: b => b.eq('clinic_id', dup.id) },
    { label: '未紐づきの旧名称 → コード18', q: b => b.is('clinic_id', null).in('partner_name', ['医療法人 仁支会 すずらん歯科・矯正歯科', 'すずらん歯科・矯正歯科', '医)はなぶさ会 すずらん歯科・矯正歯科']) },
  ]
  const log = []
  for (const m of MAP) {
    const { count } = await m.q(db.from('history_lines').select('id', { count: 'exact', head: true }))
    console.log(m.label, count, '行')
    log.push({ label: m.label, count, to: main.id, from: dup.id })
    if (!APPLY || !count) continue
    let moved = 0
    for (;;) {
      const { data } = await m.q(db.from('history_lines').select('id')).order('id').limit(500)
      if (!data || !data.length) break
      for (let i = 0; i < data.length; i += 250) {
        const { error } = await db.from('history_lines').update({ clinic_id: main.id }).in('id', data.slice(i, i + 250).map(x => x.id))
        if (error) throw new Error(error.message)
      }
      moved += data.length
    }
    console.log('  付け替え', moved)
  }
  if (APPLY) {
    fs.writeFileSync('C:/Users/user/Downloads/すずらん履歴の付け替え_元に戻す用.json', JSON.stringify(log, null, 1))
    const { count } = await db.from('history_lines').select('id', { count: 'exact', head: true }).eq('clinic_id', main.id)
    console.log('コード18の履歴行数', count)
  }
})().catch(e => { console.error('失敗', e.message); process.exit(1) })
