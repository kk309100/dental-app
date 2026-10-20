// barcode（JAN）が空の商品について、DataLandのマスター（JAN付き）から、名前の近い候補を探して、CSVにする。
// 使い方: node db/tools/jan_candidates.js   → Downloads\JAN候補一覧_YYYY-MM-DD.csv
// CSVの「採用」の列に、1〜3（採用する候補の番号）を入れて保存し、db/tools/jan_apply_candidates.js で取り込む。
const fs = require('fs')
const { createClient } = require('@supabase/supabase-js')
const rd = (f, k) => (fs.readFileSync(f, 'utf8').match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1].trim().replace(/^["']|["']$/g, '')
const db = createClient('https://alcetorurdocopxatego.supabase.co', rd('.env.local', 'SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
async function all(t, cols, qf = q => q) { let o = [], f = 0; for (;;) { const { data, error } = await qf(db.from(t).select(cols)).order('id').range(f, f + 999); if (error) throw error; o = o.concat(data); if (data.length < 1000) break; f += 1000 } return o }
const clean = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
const grams = s => { const t = clean(s); const o = new Set(); for (let i = 0; i < t.length - 1; i++) o.add(t.slice(i, i + 2)); return o }
const nums = s => new Set((String(s || '').normalize('NFKC').match(/\d+(?:\.\d+)?/g) || []))
const q = s => { s = String(s ?? ''); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }

;(async () => {
  console.log('マスター（JAN付き）を読み込み中…')
  const masters = (await all('master_products', 'id,item_code,jan,name,maker_kana,list_price')).filter(m => m.jan && String(m.jan).replace(/\D/g, '').length >= 8)
  console.log('  JAN付きのマスター', masters.length)
  const mg = masters.map(m => grams(m.name)); const mn = masters.map(m => nums(m.name))
  const index = new Map()
  mg.forEach((set, i) => set.forEach(g => { if (!index.has(g)) index.set(g, []); index.get(g).push(i) }))
  const common = new Set(); for (const [g, arr] of index) if (arr.length > 6000) common.add(g)   // ありふれた2文字は、探す手がかりにしない

  const prods = (await all('products', 'id,name,product_code,manufacturer,barcode,master_product_id,active')).filter(p => !p.barcode && p.active !== false)
  console.log('barcodeが空の商品', prods.length)
  const rows = []
  let done = 0
  for (const p of prods) {
    const pg = grams(p.name); if (pg.size < 3) continue
    const hit = new Map()
    pg.forEach(g => { if (common.has(g)) return; const arr = index.get(g); if (arr) for (const i of arr) hit.set(i, (hit.get(i) || 0) + 1) })
    const top = [...hit].sort((a, b) => b[1] - a[1]).slice(0, 40)
    const pn = nums(p.name)
    const scored = top.map(([i, c]) => {
      const inter = [...pg].filter(g => mg[i].has(g)).length
      let sc = inter / (pg.size + mg[i].size - inter)
      // 数字（サイズ・容量・型番）が合っていれば加点、食い違えば減点
      if (pn.size && mn[i].size) { const same = [...pn].filter(x => mn[i].has(x)).length; sc += (same / Math.max(pn.size, mn[i].size) - 0.5) * 0.2 }
      return { i, sc }
    }).sort((a, b) => b.sc - a.sc).slice(0, 3).filter(x => x.sc >= 0.45)
    if (scored.length) rows.push({ p, cands: scored })
    if (++done % 2000 === 0) console.log('  ', done, '/', prods.length)
  }
  rows.sort((a, b) => String(a.p.manufacturer || '').localeCompare(String(b.p.manufacturer || ''), 'ja') || b.cands[0].sc - a.cands[0].sc)
  const head = ['採用(1〜3を入力)', '商品ID', '商品名', '商品コード', 'メーカー', '信頼度']
  for (let k = 1; k <= 3; k++) head.push(`候補${k} 名前`, `候補${k} JAN`, `候補${k} 定価`, `候補${k} 近さ`)
  const lines = [head.join(',')]
  for (const { p, cands } of rows) {
    const conf = cands[0].sc >= 0.8 ? '高' : cands[0].sc >= 0.65 ? '中' : '低'
    const r = ['', p.id, p.name, p.product_code || '', p.manufacturer || '', conf]
    for (let k = 0; k < 3; k++) { const c = cands[k]; if (c) { const m = masters[c.i]; r.push(m.name, "'" + String(m.jan).replace(/\D/g, ''), m.list_price ?? '', Math.round(c.sc * 100) + '%') } else r.push('', '', '', '') }
    lines.push(r.map(q).join(','))
  }
  const out = `C:/Users/user/Downloads/JAN候補一覧_${new Date().toISOString().slice(0, 10)}.csv`
  fs.writeFileSync(out, '\ufeff' + lines.join('\r\n'))
  const cnt = { 高: 0, 中: 0, 低: 0 }; rows.forEach(r => cnt[r.cands[0].sc >= 0.8 ? '高' : r.cands[0].sc >= 0.65 ? '中' : '低']++)
  console.log(`候補のある商品 ${rows.length}件 (信頼度 高${cnt.高} / 中${cnt.中} / 低${cnt.低}) → ${out}`)
})().catch(e => { console.error('失敗', e.message || e); process.exit(1) })
