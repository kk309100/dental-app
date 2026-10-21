// 仕入先（リンク）の月次請求書（PDF）を正として、売上日報（CSV）の売上のうち、利益率が基準未満の行を抜き出す。
// 使い方: node db/tools/link_margin_check.js "<請求書PDF>" "<売上日報CSV>" [基準%=5]
// 出力: Downloads\利益チェック_リンク照合_日付.csv（基準未満）、〜_全照合.csv（照合できた全行）、〜_未照合.csv（請求書の行で、売上と対応が付かなかったもの）
const fs = require('fs')
const path = require('path')
const [pdfPath, csvPath, thArg] = process.argv.slice(2)
const TH = Number(thArg || 5)
const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[ぁ-ん]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60)).replace(/[\s\u3000・･\-－ー_\/（）()\[\]【】]/g, '')
const bg = s => { const t = norm(s).replace(/[^\p{L}\p{N}]/gu, ''); const o = new Set(); for (let i = 0; i < t.length - 1; i++) o.add(t.slice(i, i + 2)); return o }
const jac = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1) }
const nums = s => new Set((String(s || '').normalize('NFKC').match(/\d+(?:\.\d+)?/g) || []))
const q = s => { s = String(s ?? ''); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
const writeCsv = (file, head, rows) => fs.writeFileSync(file, '\ufeff' + [head, ...rows].map(r => r.map(q).join(',')).join('\r\n'))

;(async () => {
  const pdfjs = await import(path.resolve('C:/Users/user/pgtest/node_modules/pdfjs-dist/legacy/build/pdf.mjs').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'))
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), useSystemFonts: true }).promise
  // 1) 請求書（PDF）の行を読む: 日付 / 伝票 / 商品名 / 数量 / 単価 / 金額 / 備考
  const link = []; let curDate = '', curSlip = ''
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n); const vp = pg.getViewport({ scale: 1 }); const tc = await pg.getTextContent()
    const rows = {}; tc.items.filter(i => i.str.trim()).forEach(i => { const y = Math.round((vp.height - i.transform[5]) / 3) * 3; (rows[y] = rows[y] || []).push([i.transform[4], i.str.trim()]) })
    for (const y of Object.keys(rows).map(Number).sort((a, b) => a - b)) {
      const cells = rows[y].sort((a, b) => a[0] - b[0]).map(c => c[1])
      let t = cells.slice()
      const dm = t[0] && t[0].match(/^(\d{2})\.(\d{2})\.(\d{2})$/)
      if (dm) { curDate = `20${dm[1]}-${dm[2]}-${dm[3]}`; t = t.slice(1) }
      const sm = t[0] && t[0].match(/^(\d{10})\s*(売上|入金|値引)?$/); if (sm) { curSlip = sm[1]; t[0] = sm[2] || ''; if (!t[0]) t = t.slice(1) }
      if (t[0] !== '売上') continue
      const ti = t.findIndex(c => /^#?\d+%$/.test(c)); if (ti < 4) continue
      const amount = Number(String(t[ti - 1]).replace(/,/g, '')), unit = Number(String(t[ti - 2]).replace(/,/g, '')), qty = Number(String(t[ti - 3]).replace(/,/g, ''))
      if (![amount, unit, qty].every(Number.isFinite)) continue
      let name = t.slice(1, ti - 3).filter(c => !/^(\d{2})$/.test(c) && !/^(管理Ⅱ|一般Ⅰ|特管|管理Ⅰ|一般Ⅱ)$/.test(c)).join(' ')
      if (!name || /送料/.test(name)) continue
      link.push({ date: curDate, slip: curSlip, name, qty, unit, amount, note: t.slice(ti + 1).join(' '), g: bg(name), n: nums(name) })
    }
  }
  console.log('請求書の売上行', link.length, '件 / 金額合計', link.reduce((s, l) => s + l.amount, 0).toLocaleString())

  // 2) 売上日報（CSV）
  const txt = new TextDecoder('shift-jis').decode(fs.readFileSync(csvPath))
  const lines = txt.split(/\r?\n/).filter(Boolean)
  const parse = l => { const r = []; let c = '', qt = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (qt) { if (ch === '"') { if (l[i + 1] === '"') { c += '"'; i++ } else qt = false } else c += ch } else if (ch === '"') qt = true; else if (ch === ',') { r.push(c); c = '' } else c += ch } r.push(c); return r }
  const head = parse(lines[0]); const ix = n => head.indexOf(n)
  const sales = []
  for (const l of lines.slice(1)) {
    const r = parse(l); if (r[ix('売上区分')] !== '売上') continue
    const name = r[ix('商品名')]; if (!name || /消費税/.test(name)) continue
    sales.push({ code: String(r[ix('商品コード')] || '').trim(), date: String(r[ix('伝票日付')]).replace(/\//g, '-'), clinic: r[ix('得意先名')], slip: r[ix('伝票№')], name, maker: r[ix('メーカー')], oldCost: Number(r[ix('原価')]), price: Number(r[ix('単価')]), qty: Number(r[ix('数量')]), amount: Number(r[ix('金額')]), g: bg(name), n: nums(name) })
  }
  console.log('売上日報の売上行', sales.length, '件')

  // 3) 照合（精度を上げた版）: 商品ごと（商品コードごと）に、請求書のどの行かを1つ決める。
  //   ① コードで結ぶ（確実）: 請求書の商品名が、DataLandのマスターの商品名と完全に同じなら、マスターのJANを得て、売上の商品コード → デントハブの商品 → barcode / マスターのJAN と、同じかを見る
  //   ② 商品名で探す: サイズ・容量などの数字が合う行だけを候補にして、名前の近さを出す
  //   ③ 単価で確かめる: 請求書の仕入単価が、旧システムの原価の ±20% 以内なら、同じ商品とみなして、確度を上げる
  const { createClient } = require('@supabase/supabase-js')
  const rdEnv = (file, k) => (fs.readFileSync(file, 'utf8').match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1].trim().replace(/^["']|["']$/g, '')
  const db = createClient('https://alcetorurdocopxatego.supabase.co', rdEnv('.env.local', 'SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  const allRows = async (t, cols) => { let o = [], from = 0; for (;;) { const { data, error } = await db.from(t).select(cols).order('id').range(from, from + 999); if (error) throw error; o = o.concat(data); if (data.length < 1000) break; from += 1000 } return o }
  const jan13 = v => { let d = String(v || '').normalize('NFKC').replace(/\D/g, '').replace(/^0+/, ''); return d.length >= 8 ? d : '' }
  const masters = await allRows('master_products', 'id,jan,name')
  const masterByName = new Map(); masters.forEach(m => { const k = norm(m.name); if (!masterByName.has(k)) masterByName.set(k, []); masterByName.get(k).push(m) })
  const masterById = new Map(masters.map(m => [m.id, m]))
  const prods = await allRows('products', 'id,product_code,barcode,master_product_id')
  const janOfCode = new Map()   // 商品コード → JAN（正規化）
  for (const p of prods) { if (!p.product_code) continue; const j = jan13(p.barcode) || jan13(masterById.get(p.master_product_id)?.jan); if (j) janOfCode.set(String(p.product_code).trim(), j) }
  link.forEach(l => { const m = (masterByName.get(norm(l.name)) || []).filter(x => jan13(x.jan)); l.jan = m.length === 1 ? jan13(m[0].jan) : '' })
  const linkByJan = new Map(); link.forEach(l => { if (l.jan) { if (!linkByJan.has(l.jan)) linkByJan.set(l.jan, []); linkByJan.get(l.jan).push(l) } })
  const median = a => { const x = a.slice().sort((p, q) => p - q); return x[Math.floor(x.length / 2)] }

  const groups = new Map()   // 商品コード（無ければ商品名）→ 売上の行
  for (const s of sales) { const k = s.code || s.name; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s) }
  const numOk = (x, y) => !x.size || !y.size || [...x].filter(v => y.has(v)).length / Math.max(x.size, y.size) >= 0.8
  const linkGroupsByName = new Map(); link.forEach(l => { const k = norm(l.name); if (!linkGroupsByName.has(k)) linkGroupsByName.set(k, []); linkGroupsByName.get(k).push(l) })
  const decided = new Map()   // 商品キー → { lines(請求書の行), how, score, priceOk }
  for (const [k, rowsOfProduct] of groups) {
    const oldCost = median(rowsOfProduct.map(r => r.oldCost).filter(c => c > 0)) || 0
    const priceOk = u => oldCost > 0 && u / oldCost >= 0.8 && u / oldCost <= 1.25
    const code = rowsOfProduct[0].code
    // ① コード（JAN）で結ぶ
    const j = code && (janOfCode.get(String(code).trim()) || jan13(code))
    if (j && linkByJan.has(j)) { decided.set(k, { lines: linkByJan.get(j), how: 'コード(JAN)', score: 1, priceOk: priceOk(median(linkByJan.get(j).map(l => l.unit))) }); continue }
    // ② 商品名（数字が合う候補だけ）+ ③ 単価の近さ
    const g = rowsOfProduct[0].g, n = rowsOfProduct[0].n
    let best = null
    for (const [lk, ls] of linkGroupsByName) {
      if (!numOk(n, ls[0].n)) continue
      const sim = jac(g, ls[0].g); if (sim < 0.5) continue
      const u = median(ls.map(l => l.unit)); const pOk = priceOk(u)
      const total = sim + (pOk ? 0.3 : 0)
      if (!best || total > best.total) best = { ls, sim, pOk, total }
    }
    if (best && ((best.sim >= 0.6 && best.pOk) || best.sim >= 0.85)) decided.set(k, { lines: best.ls, how: '商品名', score: best.sim, priceOk: best.pOk })
  }
  const matched = []; const usedLink = new Set()
  for (const s of sales) {
    const d = decided.get(s.code || s.name); if (!d) continue
    const before = d.lines.filter(l => l.date <= s.date).sort((a, b) => b.date.localeCompare(a.date))
    const pick = before[0] || d.lines.slice().sort((a, b) => a.date.localeCompare(b.date))[0]
    usedLink.add(link.indexOf(pick))
    if (s.price === 0 && pick.unit === 0) continue   // 売値も仕入値も0円（年間購読の契約など）は、対象外
    const profit = (s.price - pick.unit) * s.qty, rate = s.price > 0 ? ((s.price - pick.unit) / s.price) * 100 : -100
    const conf = d.how === 'コード(JAN)' ? '高（コード一致）' : d.priceOk && d.score >= 0.7 ? '高' : d.priceOk ? '中' : '低（単価が旧原価と大きく違う）'
    matched.push({ s, l: pick, score: d.score, how: d.how, conf, profit, rate })
  }
  const low = matched.filter(m => m.rate < TH)
  const stamp = new Date().toISOString().slice(0, 10)
  const out = f => `C:/Users/user/Downloads/利益チェック_リンク照合_${f}_${stamp}.csv`
  const hd = ['売上日', '医院', '伝票', '商品名(売上)', '数量(売上)', '売単価', '売上金額', '旧システムの原価', '仕入日(請求書)', '商品名(請求書)', '数量(請求書)', '仕入単価(請求書)', '仕入金額(請求書)', '利益額', '利益率', '照合の方法', '確度', '請求書の備考']
  const rowOf = m => [m.s.date, m.s.clinic, m.s.slip, m.s.name, m.s.qty, m.s.price, m.s.amount, m.s.oldCost, m.l.date, m.l.name, m.l.qty, m.l.unit, m.l.amount, m.profit, m.rate.toFixed(1) + '%', m.how + (m.how === '商品名' ? '（近さ' + Math.round(m.score * 100) + '%）' : ''), m.conf, m.l.note]
  writeCsv(out('基準未満'), hd, low.sort((a, b) => a.rate - b.rate).map(rowOf))
  writeCsv(out('全照合'), hd, matched.map(rowOf))
  writeCsv(out('未照合'), ['仕入日', '伝票', '商品名(請求書)', '数量', '仕入単価', '仕入金額', '備考'], link.filter((_, i) => !usedLink.has(i)).map(l => [l.date, l.slip, l.name, l.qty, l.unit, l.amount, l.note]))
  // 4) 未照合の請求書の行に、売上日報の商品の候補（近い順に3つ）を付けて、確認用のCSVにする
  const candRows = []
  const groupInfo = [...groups].map(([k, rs]) => ({ k, code: rs[0].code, name: rs[0].name, g: rs[0].g, n: rs[0].n, cost: median(rs.map(r => r.oldCost).filter(c => c > 0)) || 0, qty: rs.reduce((t, r) => t + r.qty, 0) }))
  link.forEach((l, i) => {
    if (usedLink.has(i) || l.unit === 0) return
    const top = groupInfo.map(gi => ({ gi, sim: jac(l.g, gi.g) + (numOk(l.n, gi.n) ? 0.05 : -0.1) })).sort((a, b) => b.sim - a.sim).slice(0, 3).filter(x => x.sim >= 0.35)
    const r = [l.date, l.slip, l.name, l.qty, l.unit, l.amount]
    for (let k = 0; k < 3; k++) { const t = top[k]; if (t) r.push(t.gi.name, t.gi.code, t.gi.cost, Math.round(Math.min(1, t.sim) * 100) + '%', t.gi.cost > 0 ? (l.unit / t.gi.cost).toFixed(2) : '') ; else r.push('', '', '', '', '') }
    candRows.push(r)
  })
  const ch = ['仕入日', '伝票', '商品名(請求書)', '数量', '仕入単価', '仕入金額']; for (let k = 1; k <= 3; k++) ch.push('候補' + k + ' 商品名(売上日報)', '候補' + k + ' 商品コード', '候補' + k + ' 旧原価', '候補' + k + ' 近さ', '候補' + k + ' 仕入/旧原価')
  writeCsv(out('未照合_候補つき'), ch, candRows)
  console.log(`照合できた売上行 ${matched.length} 件 / 利益率 ${TH}% 未満 ${low.length} 件（うちマイナス ${low.filter(m => m.rate < 0).length} 件）/ 売上に対応が付かなかった請求書の行 ${link.length - usedLink.size} 件`)
  console.log('旧システムの原価と、請求書の仕入単価が違う行:', matched.filter(m => Math.abs(m.s.oldCost - m.l.unit) > 1).length, '件')
  low.slice(0, 12).forEach(m => console.log(`  ${m.s.date} ${m.s.name.slice(0, 22).padEnd(22)} 数${m.s.qty} 売${m.s.price} 仕入${m.l.unit} → ${m.rate.toFixed(1)}%  [${m.l.name.slice(0, 22)}] ${Math.round(m.score * 100)}%`))
})().catch(e => { console.error('失敗', e.message || e); process.exit(1) })
