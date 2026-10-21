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
    sales.push({ date: String(r[ix('伝票日付')]).replace(/\//g, '-'), clinic: r[ix('得意先名')], slip: r[ix('伝票№')], name, maker: r[ix('メーカー')], oldCost: Number(r[ix('原価')]), price: Number(r[ix('単価')]), qty: Number(r[ix('数量')]), amount: Number(r[ix('金額')]), g: bg(name), n: nums(name) })
  }
  console.log('売上日報の売上行', sales.length, '件')

  // 3) 照合: 売上の行ごとに、請求書の中から、商品名がいちばん近い行を探す（数字＝サイズ・容量・型番が食い違うものは除く）
  const matched = []; const usedLink = new Set()
  for (const s of sales) {
    let best = null, bs = 0
    for (const l of link) {
      if (s.n.size && l.n.size) { const same = [...s.n].filter(x => l.n.has(x)).length; if (same / Math.max(s.n.size, l.n.size) < 0.8) continue }
      const sc = jac(s.g, l.g); if (sc > bs) { bs = sc; best = l }
    }
    if (!best || bs < 0.6) continue
    if (s.price === 0 && best.unit === 0) continue   // 売値も仕入値も0円（年間購読の契約など）は、対象外
    // 同じ商品名（近さが同じ）の請求書の行が複数あるときは、売上日に、いちばん近い日付のもの（売上日以前を優先）
    const same = link.filter(l => jac(s.g, l.g) >= bs - 0.02 && (!s.n.size || !l.n.size || [...s.n].filter(x => l.n.has(x)).length / Math.max(s.n.size, l.n.size) >= 0.8))
    const before = same.filter(l => l.date <= s.date).sort((a, b) => b.date.localeCompare(a.date))
    const pick = before[0] || same.sort((a, b) => a.date.localeCompare(b.date))[0] || best
    usedLink.add(link.indexOf(pick))
    const profit = (s.price - pick.unit) * s.qty, rate = s.price > 0 ? ((s.price - pick.unit) / s.price) * 100 : -100
    matched.push({ s, l: pick, score: bs, profit, rate })
  }
  const low = matched.filter(m => m.rate < TH)
  const stamp = new Date().toISOString().slice(0, 10)
  const out = f => `C:/Users/user/Downloads/利益チェック_リンク照合_${f}_${stamp}.csv`
  const hd = ['売上日', '医院', '伝票', '商品名(売上)', '数量(売上)', '売単価', '売上金額', '旧システムの原価', '仕入日(請求書)', '商品名(請求書)', '数量(請求書)', '仕入単価(請求書)', '仕入金額(請求書)', '利益額', '利益率', '名前の近さ', '要確認', '請求書の備考']
  const rowOf = m => [m.s.date, m.s.clinic, m.s.slip, m.s.name, m.s.qty, m.s.price, m.s.amount, m.s.oldCost, m.l.date, m.l.name, m.l.qty, m.l.unit, m.l.amount, m.profit, m.rate.toFixed(1) + '%', Math.round(m.score * 100) + '%', m.score < 0.75 ? '要確認（名前の近さが低い）' : '', m.l.note]
  writeCsv(out('基準未満'), hd, low.sort((a, b) => a.rate - b.rate).map(rowOf))
  writeCsv(out('全照合'), hd, matched.map(rowOf))
  writeCsv(out('未照合'), ['仕入日', '伝票', '商品名(請求書)', '数量', '仕入単価', '仕入金額', '備考'], link.filter((_, i) => !usedLink.has(i)).map(l => [l.date, l.slip, l.name, l.qty, l.unit, l.amount, l.note]))
  console.log(`照合できた売上行 ${matched.length} 件 / 利益率 ${TH}% 未満 ${low.length} 件（うちマイナス ${low.filter(m => m.rate < 0).length} 件）/ 売上に対応が付かなかった請求書の行 ${link.length - usedLink.size} 件`)
  console.log('旧システムの原価と、請求書の仕入単価が違う行:', matched.filter(m => Math.abs(m.s.oldCost - m.l.unit) > 1).length, '件')
  low.slice(0, 12).forEach(m => console.log(`  ${m.s.date} ${m.s.name.slice(0, 22).padEnd(22)} 数${m.s.qty} 売${m.s.price} 仕入${m.l.unit} → ${m.rate.toFixed(1)}%  [${m.l.name.slice(0, 22)}] ${Math.round(m.score * 100)}%`))
})().catch(e => { console.error('失敗', e.message || e); process.exit(1) })
