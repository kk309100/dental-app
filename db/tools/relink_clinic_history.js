// 医院履歴（history_lines）が、コードの無い重複医院に紐づいていて、いま使っている医院に出てこない問題を直す。
// 使い方: node db/tools/relink_clinic_history.js [--apply]   （--apply なしは、件数の確認のみ）
// 紐づけ先の付け替え: 重複医院(コードなし) → いま使っている医院(コードあり)。元に戻せるよう、対応を Downloads に保存する。
const fs = require('fs')
const { createClient } = require('@supabase/supabase-js')
const env = fs.readFileSync('.env.local', 'utf8')
const g = k => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1].trim().replace(/^["']|["']$/g, '')
const db = createClient('https://alcetorurdocopxatego.supabase.co', g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const APPLY = process.argv.includes('--apply')
const PAIRS = [
  { dup: '清翔会 エスカ歯科・矯正歯科', main: '医）清翔会 エスカ歯科・矯正歯科' },
  { dup: '清翔会 名古屋ルミナス歯科・矯正歯科', main: '医）清翔会 名古屋ルミナス歯科・矯正歯科' },
  { dup: '正翔会 名古屋みなみ歯科・矯正歯科', main: '医）正翔会 名古屋みなみ歯科・矯正歯科' },
]
;(async () => {
  const { data: clinics } = await db.from('clinics').select('id,name,clinic_code')
  const byName = new Map(clinics.map(c => [c.name, c]))
  const plan = []
  for (const p of PAIRS) {
    const d = byName.get(p.dup), m = byName.get(p.main)
    if (!d || !m) { console.log('見つからない:', p.dup, p.main); continue }
    const { count } = await db.from('history_lines').select('id', { count: 'exact', head: true }).eq('clinic_id', d.id)
    const { count: mc } = await db.from('history_lines').select('id', { count: 'exact', head: true }).eq('clinic_id', m.id)
    console.log(`${p.dup} (${count}行) → ${p.main} [コード${m.clinic_code}] いまの行数 ${mc}`)
    plan.push({ dupId: d.id, mainId: m.id, dupName: p.dup, mainName: p.main, count })
  }
  // 名前が近いのに、どこにも紐づいていない行（医）清翔会 ルミナス歯科・矯正歯科）
  const loose = byName.get('医）清翔会 名古屋ルミナス歯科・矯正歯科')
  const { count: lc } = await db.from('history_lines').select('id', { count: 'exact', head: true }).is('clinic_id', null).eq('partner_name', '医）清翔会 ルミナス歯科・矯正歯科')
  console.log(`未紐づき「医）清翔会 ルミナス歯科・矯正歯科」 ${lc}行 → 医）清翔会 名古屋ルミナス歯科・矯正歯科`)
  if (!APPLY) { console.log('（確認のみ。書き込みはしていません）'); return }
  fs.writeFileSync(`C:/Users/user/Downloads/医院履歴の付け替え_元に戻す用_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ plan, looseCount: lc, looseTo: loose?.id }, null, 1))
  for (const p of plan) {
    const { error } = await db.from('history_lines').update({ clinic_id: p.mainId }).eq('clinic_id', p.dupId)
    console.log(p.dupName, error ? '失敗 ' + error.message : '付け替え完了')
  }
  if (loose && lc) { const { error } = await db.from('history_lines').update({ clinic_id: loose.id }).is('clinic_id', null).eq('partner_name', '医）清翔会 ルミナス歯科・矯正歯科'); console.log('未紐づき分', error ? '失敗 ' + error.message : '完了') }
})().catch(e => { console.error('失敗', e.message); process.exit(1) })
