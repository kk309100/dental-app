// JAN候補一覧CSV（db/tools/jan_candidates.js で作成）の「採用」の列に、1〜3を入れた行について、候補のJANを、商品のbarcodeに入れる。
// 使い方: node db/tools/jan_apply_candidates.js "<CSVのパス>" [--apply] [--box]
//  - barcode がすでに入っている商品は、触らない。同じJANが、ほかの商品にすでにある場合は、入れない。
//  - 書き込む前の値を Downloads に保存する。--box で、やり直し用の箱にも、同じ商品IDに入れる。
const fs = require('fs')
const { createClient } = require('@supabase/supabase-js')
const rd = (f, k) => (fs.readFileSync(f, 'utf8').match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1].trim().replace(/^["']|["']$/g, '')
const db = createClient('https://alcetorurdocopxatego.supabase.co', rd('.env.local', 'SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const file = process.argv[2], APPLY = process.argv.includes('--apply'), BOX = process.argv.includes('--box')
function parse(t) { t = t.replace(/^\uFEFF/, ''); const rows = []; let cur = [], f = '', q = false
  for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c } else if (c === '"') q = true; else if (c === ',') { cur.push(f); f = '' } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; cur.push(f); rows.push(cur); cur = []; f = '' } else f += c }
  if (f || cur.length) { cur.push(f); rows.push(cur) } return rows.filter(r => r.length > 3) }
function jan13(v) { let d = String(v || '').normalize('NFKC').replace(/\D/g, ''); if (!d) return ''; if (d.length <= 8) return d.length === 8 ? d : ''; d = d.replace(/^0+(?=\d{13}$)/, ''); if (d.length < 13) d = d.padStart(13, '0'); return d.length === 13 ? d : '' }
async function all(client, t, cols) { let o = [], f = 0; for (;;) { const { data, error } = await client.from(t).select(cols).order('id').range(f, f + 999); if (error) throw error; o = o.concat(data); if (data.length < 1000) break; f += 1000 } return o }
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]) })) }
;(async () => {
  const rows = parse(fs.readFileSync(file, 'utf8')); const head = rows[0]
  const iSel = head.findIndex(h => h.includes('採用')), iId = head.indexOf('商品ID')
  const candJanCol = k => head.indexOf(`候補${k} JAN`)
  const picks = []
  for (const r of rows.slice(1)) { const k = Number(String(r[iSel] || '').trim()); if (![1, 2, 3].includes(k)) continue; const jan = jan13(r[candJanCol(k)]); if (jan) picks.push({ id: r[iId], name: r[head.indexOf('商品名')], jan }) }
  const prods = new Map((await all(db, 'products', 'id,barcode')).map(p => [p.id, p]))
  const used = new Set([...prods.values()].map(p => jan13(p.barcode)).filter(Boolean))
  const cnt = new Map(); picks.forEach(x => cnt.set(x.jan, (cnt.get(x.jan) || 0) + 1))
  const ok = [], skip = []
  for (const x of picks) { const p = prods.get(x.id); if (!p) skip.push([x, '商品が見つかりません']); else if (p.barcode) skip.push([x, 'すでにbarcodeがあります']); else if (used.has(x.jan) || cnt.get(x.jan) > 1) skip.push([x, '同じJANが、ほかの商品にあります']); else ok.push(x) }
  console.log(`採用された行 ${picks.length}件 → 入れる ${ok.length}件 / 除く ${skip.length}件`); skip.slice(0, 8).forEach(([x, why]) => console.log('  除く:', x.name.slice(0, 26), '|', why))
  if (!APPLY) { console.log('（確認のみ。書き込みはしていません）'); return }
  fs.writeFileSync(`C:/Users/user/Downloads/JAN候補取込_変更前_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`, JSON.stringify(ok.map(x => ({ id: x.id, name: x.name, before: null, after: x.jan }))))
  let s = 0, f = 0; await pool(ok, 15, async x => { const { error } = await db.from('products').update({ barcode: x.jan }).eq('id', x.id); if (error) f++; else s++ })
  console.log(`本番: 成功 ${s} / 失敗 ${f}`)
  if (BOX) { const box = createClient(rd('.env.new', 'NEXT_PUBLIC_SUPABASE_URL'), rd('.env.new', 'SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } }); let bs = 0, bf = 0
    await pool(ok, 15, async x => { const { error } = await box.from('products').update({ barcode: x.jan }).eq('id', x.id).is('barcode', null); if (error) bf++; else bs++ }); console.log(`やり直し用: 成功 ${bs} / 失敗 ${bf}`) }
})().catch(e => { console.error('失敗', e.message || e); process.exit(1) })
