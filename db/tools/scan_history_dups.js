// 医院履歴の紐づけの点検（読み取りのみ）。履歴が多いのに「コードなし」の重複医院に付いている、いま使っている医院には履歴が0行、のペアを探す。
const fs = require('fs')
const { createClient } = require('@supabase/supabase-js')
const env = fs.readFileSync('.env.local', 'utf8')
const g = k => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1].trim().replace(/^["']|["']$/g, '')
const db = createClient('https://alcetorurdocopxatego.supabase.co', g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const norm = s => String(s || '').normalize('NFKC').replace(/[（）()＃#\s　・,、.]/g, '').replace(/^(医療法人|医)?/, '').replace(/^(医)/, '').replace(/個人分?|個人/g, '')
const core = s => norm(s).replace(/^[^぀-ヿ一-鿿]+/, '')
;(async () => {
  const { data: cl } = await db.from('clinics').select('id,name,clinic_code')
  const count = async (id) => (await db.from('history_lines').select('id', { count: 'exact', head: true }).eq('clinic_id', id).eq('kind', '売上')).count || 0
  const cnt = new Map()
  for (let i = 0; i < cl.length; i += 20) await Promise.all(cl.slice(i, i + 20).map(async c => cnt.set(c.id, await count(c.id))))
  const orderCnt = new Map()
  for (let i = 0; i < cl.length; i += 20) await Promise.all(cl.slice(i, i + 20).map(async c => orderCnt.set(c.id, (await db.from('orders').select('id', { count: 'exact', head: true }).eq('clinic_id', c.id)).count || 0)))
  const noCode = cl.filter(c => !c.clinic_code && cnt.get(c.id) > 0)
  console.log('コードなしで、履歴が付いている医院:', noCode.length)
  const rows = []
  for (const d of noCode) {
    const key = core(d.name)
    const cand = cl.filter(c => c.clinic_code && c.id !== d.id && !/個人/.test(c.name) && (core(c.name) === key || (key.length >= 6 && (core(c.name).includes(key) || key.includes(core(c.name))))))
    rows.push({ d, cand })
  }
  for (const { d, cand } of rows) {
    console.log(`\n■ ${d.name}  履歴(売上) ${cnt.get(d.id)}行 / 注文 ${orderCnt.get(d.id)}`)
    if (!cand.length) console.log('   → 対応する使用中の医院が見つかりません')
    cand.forEach(c => console.log(`   → [${c.clinic_code}] ${c.name}  履歴 ${cnt.get(c.id)}行 / 注文 ${orderCnt.get(c.id)}`))
  }
  // 未紐づきの取引先名（履歴が、どの医院にも付いていない）
  const names = new Map(); let from = 0
  for (;;) {
    const { data } = await db.from('history_lines').select('partner_name').is('clinic_id', null).eq('kind', '売上').order('id').range(from, from + 999)
    if (!data || !data.length) break
    data.forEach(x => names.set(x.partner_name, (names.get(x.partner_name) || 0) + 1)); if (data.length < 1000) break; from += 1000
  }
  const top = [...names].sort((a, b) => b[1] - a[1]).slice(0, 25)
  console.log(`\n未紐づきの売上履歴: ${[...names.values()].reduce((s, v) => s + v, 0)}行 / 取引先名 ${names.size}種類。多い順:`)
  top.forEach(([n, c]) => console.log(`  ${c}行  ${n}`))
})().catch(e => { console.error('失敗', e.message); process.exit(1) })
