// やり直し用（新しい箱）の在庫の出発点を、棚卸表（9/22）の数に合わせる。
// 考え方: 各商品について「いまの在庫 + （棚卸表の数 − いまの出発点の数）」にする。出発点より後の入荷や納品の動きは、そのまま残る。
// 使い方: node db/newbox/apply_stocktake_sheet.js "<棚卸表.xlsx>" [--apply]   （--apply なしは、確認のみ）
// 書き込み先は .env.new の箱だけ（本番と同じ接続先なら中止）。
const fs = require('fs')
const X = require('xlsx')
const { createClient } = require('@supabase/supabase-js')
const rd = (f, k) => (fs.readFileSync(f, 'utf8').match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1].trim().replace(/^["']|["']$/g, '')
const OLD_URL = 'https://alcetorurdocopxatego.supabase.co'
const NEW_URL = rd('.env.new', 'NEXT_PUBLIC_SUPABASE_URL')
if (!NEW_URL || new URL(NEW_URL).host === new URL(OLD_URL).host) throw new Error('書き込み先が不正です。中止します')
const old = createClient(OLD_URL, rd('.env.local', 'SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const box = createClient(NEW_URL, rd('.env.new', 'SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const file = process.argv[2], APPLY = process.argv.includes('--apply')
const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '')
const bg = s => { const t = norm(s).replace(/[^\p{L}\p{N}]/gu, ''); const o = new Set(); for (let i = 0; i < t.length - 1; i++) o.add(t.slice(i, i + 2)); return o }
const jac = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1) }
async function all(db, t, cols, qf = q => q) { let o = [], f = 0; for (;;) { const { data, error } = await qf(db.from(t).select(cols)).order('id').range(f, f + 999); if (error) throw error; o = o.concat(data); if (data.length < 1000) break; f += 1000 } return o }

;(async () => {
  const w = X.readFile(file)
  const sheetRows = X.utils.sheet_to_json(w.Sheets[w.SheetNames[0]], { header: 1, defval: '' }).slice(4).filter(r => r[4] && r[5] !== '')
  const sheet = new Map()
  sheetRows.forEach(r => { const n = norm(r[4]); const c = sheet.get(n); sheet.set(n, { q: (c?.q || 0) + Number(r[5] || 0), raw: r[4] }) })

  // 箱の商品と、いまの出発点（本番の9/22の棚卸調整）
  const prods = await all(box, 'products', 'id,name,stock')
  const mv = await all(old, 'stock_movements', 'id,product_id,after_stock,occurred_at', q => q.eq('movement_type', '棚卸調整').gte('occurred_at', '2026-09-22T00:00:00').lt('occurred_at', '2026-09-23T00:00:00'))
  const opening = new Map(); mv.sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at))).forEach(m => opening.set(m.product_id, Number(m.after_stock) || 0))
  const byName = new Map(); for (const p of prods) { const n = norm(p.name); if (!byName.has(n)) byName.set(n, []); byName.get(n).push(p) }

  const used = new Set(), plan = [], unmatched = []
  const pick = (cands) => cands.slice().sort((a, b) => (opening.get(b.id) || 0) - (opening.get(a.id) || 0))[0]
  const pending = []
  for (const [n, v] of sheet) {   // 1) 商品名が同じ
    const c = (byName.get(n) || []).filter(p => !used.has(p.id))
    if (c.length) { const p = pick(c); used.add(p.id); plan.push({ p, v, how: '名前が同じ' }) } else pending.push([n, v])
  }
  const openProds = prods.filter(p => opening.has(p.id) && (opening.get(p.id) || 0) > 0 && !used.has(p.id))
  for (const [n, v] of pending) {   // 2) 出発点にあって、まだ対応のない商品のうち、名前が近いもの
    let best = null, bs = 0
    for (const p of openProds) { if (used.has(p.id)) continue; const s = jac(bg(v.raw), bg(p.name)); if (s > bs) { bs = s; best = p } }
    if (best && bs >= 0.5) { used.add(best.id); plan.push({ p: best, v, how: `名前が近い(${Math.round(bs * 100)}%)` }); continue }
    let b2 = null, s2 = 0   // 3) 全商品から、かなり近いもの
    for (const p of prods) { if (used.has(p.id)) continue; const s = jac(bg(v.raw), bg(p.name)); if (s > s2) { s2 = s; b2 = p } }
    if (b2 && s2 >= 0.85) { used.add(b2.id); plan.push({ p: b2, v, how: `名前がかなり近い(${Math.round(s2 * 100)}%)` }) } else if (v.q > 0) unmatched.push(v)
  }
  const changes = []
  for (const { p, v, how } of plan) {
    const op = opening.get(p.id) || 0, cur = Number(p.stock || 0), delta = v.q - op
    if (delta !== 0) changes.push({ id: p.id, name: p.name, sheetName: v.raw, how, opening: op, sheet: v.q, before: cur, after: cur + delta, delta })
  }
  console.log(`棚卸表 ${sheet.size}商品 → 箱の商品に対応 ${plan.length}件 / 対応なし(数量>0) ${unmatched.length}件`)
  console.log(`在庫を変える商品 ${changes.length}件 / 増減の合計 ${changes.reduce((s, c) => s + c.delta, 0)}`)
  changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 12).forEach(c => console.log(`  ${c.name.slice(0, 26)} 出発点${c.opening}→表${c.sheet} (${c.how}) 在庫 ${c.before}→${c.after}`))
  unmatched.forEach(v => console.log('  対応なし:', v.raw, v.q))
  if (!APPLY) { console.log('（確認のみ。書き込みはしていません）'); return }

  const bk = `C:/Users/user/Downloads/やり直し用在庫_変更前_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`
  fs.writeFileSync(bk, JSON.stringify(changes, null, 1)); console.log('変更前の値を保存:', bk)
  let ok = 0, ng = 0
  for (const c of changes) {
    const { error } = await box.from('products').update({ stock: c.after }).eq('id', c.id)
    if (error) { ng++; console.log('失敗', c.name, error.message); continue }
    ok++
    await box.from('stock_movements').insert({ product_id: c.id, movement_type: '棚卸調整', quantity: c.delta, before_stock: c.before, after_stock: c.after, ref_type: 'stocktake_sheet', reason: '棚卸表9月に合わせて出発点を修正' })
  }
  console.log(`完了: 成功 ${ok} / 失敗 ${ng}`)
})().catch(e => { console.error('失敗', e.message || e); process.exit(1) })
