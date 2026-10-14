// 商品マスタCSV（アプリの「CSV出力」と同じ形式）を、本番の商品マスタに取り込む。
// 使い方: node db/tools/import_products_csv.js <新CSV> <前回のCSV> [--apply]
//  - --apply なし … 何が変わるかを数えるだけ（書き込まない）
//  - 一致の判定: 商品コード → 商品名。コードがExcelで「4.5E+12」のように壊れている行は、コードを使わず商品名で探す（コードは書き換えない）
//  - 在庫: 前回のCSVから変えた行だけ、CSVの数に合わせる（動きは stock_movements に「棚卸調整」で残す）
//  - 書き込み前に、変更対象の元の値を Downloads\商品マスタ取込_バックアップ_*.json に保存する
const fs = require('fs')
const { createClient } = require('@supabase/supabase-js')
const env = fs.readFileSync('.env.local', 'utf8')
const g = k => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1].trim().replace(/^["']|["']$/g, '')
const db = createClient('https://alcetorurdocopxatego.supabase.co', g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const [newCsv, oldCsv] = process.argv.slice(2).filter(a => !a.startsWith('--'))
const APPLY = process.argv.includes('--apply')

function parse(t) {
  t = t.replace(/^\uFEFF/, ''); const rows = []; let cur = [], f = '', q = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ',') { cur.push(f); f = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; cur.push(f); rows.push(cur); cur = []; f = '' }
    else f += c
  }
  if (f || cur.length) { cur.push(f); rows.push(cur) }
  const h = rows[0]
  return rows.slice(1).filter(r => r.length > 1).map(r => Object.fromEntries(h.map((n, i) => [n, r[i] ?? ''])))
}
const norm = s => String(s || '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g, '')
const sci = c => /^\d(\.\d+)?e\+\d+$/i.test(String(c || '').trim())
const num = v => { const x = Number(String(v ?? '').replace(/[¥,]/g, '')); return String(v ?? '').trim() === '' || !Number.isFinite(x) ? null : x }

;(async () => {
  const rows = parse(fs.readFileSync(newCsv, 'utf8'))
  const oldRows = parse(fs.readFileSync(oldCsv, 'utf8'))
  const oldByCode = new Map(oldRows.filter(r => r['商品コード'] && !sci(r['商品コード'])).map(r => [r['商品コード'], r]))
  const oldByName = new Map(oldRows.map(r => [norm(r['商品名']), r]))

  let all = [], from = 0
  for (;;) {
    const { data, error } = await db.from('products').select('*').order('id').range(from, from + 999)
    if (error) throw new Error(error.message)
    all = all.concat(data); if (data.length < 1000) break; from += 1000
  }
  const byCode = new Map(all.filter(p => p.product_code).map(p => [norm(p.product_code), p]))
  const byName = new Map(all.map(p => [norm(p.name), p]))

  const blanks = [], updates = [], creates = [], stockChanges = [], unmatched = []
  for (const r of rows) {
    const name = r['商品名'].trim(), code = r['商品コード'].trim()
    if (!name && !code) continue
    const goodCode = code && !sci(code)
    const ex = (goodCode && byCode.get(norm(code))) || byName.get(norm(name))
    const payload = {
      name: name || code,
      manufacturer: r['メーカー'] || null,
      category: r['カテゴリ'] || null,
      cost: num(r['仕入価格']),
      price: num(r['定価']),
      reorder_level: num(r['発注点']),
      location: r['棚番号'] || null,
      purchase_maker: r['ﾒｰｶｰ'] || null,
    }
    if (goodCode) payload.product_code = code
    if (!ex) {
      if (goodCode) creates.push({ ...payload, stock: 0 })
      else unmatched.push(r)
      continue
    }
    const diff = {}
    for (const [k, v] of Object.entries(payload)) {
      const cur = ex[k] ?? null
      if (v == null && cur != null && Number(cur) !== 0) { blanks.push({ name: ex.name, col: k, cur }); continue }   // CSVが空欄でも、いまの値は消さない（0→空欄は変更なし扱い）
      if (v == null && (cur == null || Number(cur) === 0)) continue
      if (String(cur ?? '') !== String(v ?? '')) diff[k] = v
    }
    if (Object.keys(diff).length) updates.push({ id: ex.id, before: Object.fromEntries(Object.keys(diff).map(k => [k, ex[k] ?? null])), diff, name: ex.name })
    // 在庫: 前回のCSVから、あなたが変えた行だけ
    const o = (goodCode && oldByCode.get(code)) || oldByName.get(norm(name)) || oldByName.get(norm(ex.name))
    const ns = num(r['在庫'])
    if (o && ns != null && num(o['在庫']) !== ns && Number(ex.stock || 0) !== ns) stockChanges.push({ id: ex.id, name: ex.name, before: Number(ex.stock || 0), after: ns })
  }

  console.log(`CSV ${rows.length}行 / 本番の商品 ${all.length}件`)
  console.log(`更新 ${updates.length}件 / 新規 ${creates.length}件 / 在庫を合わせる ${stockChanges.length}件 / 一致せず保留 ${unmatched.length}件`)
  const cols = {}; updates.forEach(u => Object.keys(u.diff).forEach(k => cols[k] = (cols[k] || 0) + 1)); console.log('更新の列別', JSON.stringify(cols))
  updates.slice(0, 40).forEach(u => console.log('  例', u.name.slice(0, 34), '| 変更後', JSON.stringify(u.diff).slice(0, 150), '| 変更前', JSON.stringify(u.before).slice(0, 150)))
  stockChanges.forEach(s => console.log('  在庫', s.name.slice(0, 30), s.before, '→', s.after))
  creates.slice(0, 3).forEach(c => console.log('  新規例', c.name.slice(0, 30), c.product_code))
  unmatched.slice(0, 5).forEach(r => console.log('  保留例', r['商品名'].slice(0, 30), r['商品コード']))
  console.log('空欄のため値を消さなかった項目', blanks.length, '件:', Array.from(new Set(blanks.map(b => b.name.slice(0, 22)))).join(' / '))
  if (!APPLY) { console.log('（確認のみ。書き込みはしていません）'); return }

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)
  const bk = `C:/Users/user/Downloads/商品マスタ取込_バックアップ_${stamp}.json`
  fs.writeFileSync(bk, JSON.stringify({ updates: updates.map(u => ({ id: u.id, before: u.before })), stock: stockChanges, createdNames: creates.map(c => c.name) }, null, 1))
  console.log('バックアップ:', bk)

  let ok = 0, ng = 0
  for (const u of updates) { const { error } = await db.from('products').update(u.diff).eq('id', u.id); if (error) { ng++; console.log('失敗', u.name, error.message) } else ok++ }
  for (let i = 0; i < creates.length; i += 200) { const { error } = await db.from('products').insert(creates.slice(i, i + 200)); if (error) { ng++; console.log('新規失敗', error.message) } else ok += Math.min(200, creates.length - i) }
  for (const s of stockChanges) {
    const { error } = await db.from('products').update({ stock: s.after }).eq('id', s.id)
    if (error) { ng++; console.log('在庫失敗', s.name, error.message); continue }
    ok++
    await db.from('stock_movements').insert({ product_id: s.id, movement_type: '棚卸調整', quantity: s.after - s.before, before_stock: s.before, after_stock: s.after, ref_type: 'master_csv', reason: '商品マスタCSV取込（在庫の修正）' })
  }
  console.log(`完了: 成功 ${ok} / 失敗 ${ng}`)
})().catch(e => { console.error('失敗:', e.message); process.exit(1) })
