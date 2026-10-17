// やり直し用（新しい箱）: 棚卸表で名前が合わなかった商品を、商品マスタの似た名前の商品に対応づけて、在庫を表の数に合わせる。
// 対応づけ: LANCERワイヤー（上=UP、下=LW、サイズ数字）は規則で。ほかは、確実なものだけ名前を指定。
// 計算: 在庫 = いまの在庫 + （表の数 − いまの出発点の数）。使い方: node db/newbox/apply_stocktake_mapped.js [--apply]
const fs = require('fs')
const X = require('xlsx')
const { createClient } = require('@supabase/supabase-js')
const rd = (f, k) => (fs.readFileSync(f, 'utf8').match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1].trim().replace(/^["']|["']$/g, '')
const OLD_URL = 'https://alcetorurdocopxatego.supabase.co', NEW_URL = rd('.env.new', 'NEXT_PUBLIC_SUPABASE_URL')
if (!NEW_URL || new URL(NEW_URL).host === new URL(OLD_URL).host) throw new Error('書き込み先が不正です。中止します')
const old = createClient(OLD_URL, rd('.env.local', 'SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const box = createClient(NEW_URL, rd('.env.new', 'SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const APPLY = process.argv.includes('--apply')
const nk = s => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '')
async function all(db, t, cols, qf = q => q) { let o = [], f = 0; for (;;) { const { data, error } = await qf(db.from(t).select(cols)).order('id').range(f, f + 999); if (error) throw error; o = o.concat(data); if (data.length < 1000) break; f += 1000 } return o }
// 名前で指定する、確実な対応（表の商品名 → 箱の商品名）
const EXPLICIT = {
  'DACオイル 単品 200ml': 'DACオイル(単品)',
  'ルートキャナルシリンジ 2本セット': 'ルートキヤナル シリンジ 2本入 セット',
  'ルートキャナルシリンジ 3本セット': 'ルートキヤナル シリンジ 3本入セット',
  'ルシェロ フロス ミントWAX ピンク ×6個': 'ルシェロ フロス ミントワックス ピンク 30mX6個',
  'NiTi ワイヤー 014 REF207-0935': '207-0935 ニッケルチタンワイヤー コーテッド SE 下 014',
  'ミキシングチップSS用ノズル': 'ミキシングチップSSノズル 100入',
}
;(async () => {
  const w = X.readFile('C:/Users/user/Downloads/棚卸表 9月.xlsx')
  const rows = X.utils.sheet_to_json(w.Sheets[w.SheetNames[0]], { header: 1, defval: '' }).slice(4).filter(r => r[4] && r[5] !== '' && Number(r[5]) > 0)
  const prods = await all(box, 'products', 'id,name,stock')
  const mv = await all(old, 'stock_movements', 'id,product_id,after_stock,occurred_at', q => q.eq('movement_type', '棚卸調整').gte('occurred_at', '2026-09-22T00:00:00').lt('occurred_at', '2026-09-23T00:00:00'))
  const opening = new Map(); mv.sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at))).forEach(m => opening.set(m.product_id, Number(m.after_stock) || 0))
  const exact = new Set(prods.map(p => nk(p.name)))
  const explicit = new Map(Object.entries(EXPLICIT).map(([a, b]) => [nk(a), nk(b)]))
  const changes = [], skipped = []
  for (const r of rows) {
    const raw = String(r[4]), n = nk(raw), qty = Number(r[5])
    if (exact.has(n)) continue   // 名前が同じものは、先に処理済み
    let target = null
    const m = raw.normalize('NFKC').match(/LANCER (NiTi|SS) ワイヤー\s*(\d+)\s*(上|下)/)
    if (m) {
      const kind = m[1] === 'NiTi' ? 'niti' : 'ss', suf = m[3] === '上' ? 'u' : 'l'
      const c = prods.filter(p => { const nn = p.name.normalize('NFKC').toLowerCase(); return nn.includes('lancer classic ' + kind) && new RegExp('tf ' + m[2] + suf, 'i').test(nn) })
      if (m[2] === '1925' && !c.length) { const c2 = prods.filter(p => /lancer classic nt?ti .*tf 192\b/i.test(p.name.normalize('NFKC'))); if (c2.length === 1) target = c2[0] }
      if (c.length === 1) target = c[0]
    } else if (explicit.has(n)) {
      const c = prods.filter(p => nk(p.name) === explicit.get(n)); if (c.length === 1) target = c[0]
    }
    if (!target) { skipped.push([raw, qty]); continue }
    const op = opening.get(target.id) || 0, cur = Number(target.stock || 0), delta = qty - op
    if (delta !== 0) changes.push({ id: target.id, name: target.name, sheetName: raw, opening: op, sheet: qty, before: cur, after: cur + delta, delta })
  }
  console.log(`在庫を変える商品 ${changes.length}件 / 増減の合計 ${changes.reduce((s, c) => s + c.delta, 0)}`)
  changes.forEach(c => console.log(`  ${c.sheetName.slice(0, 26).padEnd(26)} → ${c.name.slice(0, 34)}  出発点${c.opening}→表${c.sheet}  在庫 ${c.before}→${c.after}`))
  console.log(`まだ対応づけていない ${skipped.length}件:`); skipped.forEach(s => console.log('  ', s[0], s[1]))
  if (!APPLY) { console.log('（確認のみ。書き込みはしていません）'); return }
  const bk = `C:/Users/user/Downloads/やり直し用在庫_変更前2_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`
  fs.writeFileSync(bk, JSON.stringify(changes, null, 1)); console.log('変更前の値を保存:', bk)
  let ok = 0
  for (const c of changes) {
    const { error } = await box.from('products').update({ stock: c.after }).eq('id', c.id)
    if (error) { console.log('失敗', c.name, error.message); continue }
    ok++
    await box.from('stock_movements').insert({ product_id: c.id, movement_type: '棚卸調整', quantity: c.delta, before_stock: c.before, after_stock: c.after, ref_type: 'stocktake_sheet', reason: '棚卸表9月に合わせて出発点を修正（名前の対応づけ）' })
  }
  console.log(`完了: ${ok}/${changes.length}`)
})().catch(e => { console.error('失敗', e.message || e); process.exit(1) })
