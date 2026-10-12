// デモ環境のダミーデータ投入スクリプト（何度実行しても、同じ状態に作り直す）。
// 使い方: node db/demo/seed_demo.js   ※ .env.demo（デモ用Supabaseの接続情報）が必要
// 本番のデータは一切使わない。商品名だけ、データランドの商品マスター（実在の商品名）から選ぶ。価格・在庫・取引は架空。
const fs = require('fs'), crypto = require('crypto'), X = require('xlsx')
const { createClient } = require('@supabase/supabase-js')

const envText = fs.readFileSync('.env.demo', 'utf8')
const get = k => ((envText.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1] || '').trim().replace(/^["']|["']$/g, '')
const URL_ = get('NEXT_PUBLIC_SUPABASE_URL'), KEY = get('SUPABASE_SERVICE_ROLE_KEY')
if (!URL_ || !KEY) throw new Error('.env.demo に接続情報がありません')
if (new URL(URL_).host.startsWith('alcetorurdocopxatego')) throw new Error('本番への接続です。中止します')
const sb = createClient(URL_, KEY, { auth: { autoRefreshToken: false, persistSession: false } })

// 乱数（毎回同じ結果になるよう固定の種を使う）
let seed = 20261012
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const pick = a => a[Math.floor(rnd() * a.length)]
const uid = () => crypto.randomUUID()
const pad = (n, w) => String(n).padStart(w, '0')
const ymd = d => `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`
const iso = d => d.toISOString()

async function ins(table, rows, chunk = 500) {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await sb.from(table).insert(rows.slice(i, i + chunk))
    if (error) throw new Error(`${table}: ${error.message}`)
  }
  console.log(`  ${table}: ${rows.length}件`)
}
async function wipe(table) {
  const { error } = await sb.from(table).delete().not('id', 'is', null)
  if (error && !/does not exist/.test(error.message)) throw new Error(`wipe ${table}: ${error.message}`)
}

;(async () => {
  console.log('1) 既存のデモデータを消去')
  for (const t of ['order_items', 'purchase_order_items', 'stock_receipts', 'stock_movements', 'clinic_prices', 'supplier_prices', 'quote_items',
    'quotes', 'invoice_payments', 'orders', 'invoices', 'purchase_orders', 'stocktake_items', 'stocktakes', 'favorites', 'products', 'clinics', 'suppliers', 'master_products']) await wipe(t)

  console.log('2) 会社情報')
  await sb.from('company_settings').upsert({
    id: 1, company_name: 'デモ歯科材料株式会社', postal_code: '100-0000', address: '東京都千代田区サンプル1-2-3', phone: '03-0000-0000',
    email: 'demo@dent-hub.jp', representative: 'デモ 太郎', invoice_registration_number: 'T0000000000000',
    bank_name: 'サンプル銀行', bank_branch: '本店', bank_type: '普通', bank_number: '0000000', bank_holder: 'デモ（カ',
    invoice_footer: 'これはデモ用のダミーデータです。',
  })

  console.log('3) 仕入先')
  const supplierNames = [
    ['デモメディカル商事', 'ﾃﾞﾓﾒﾃﾞｨ'], ['サンプル歯科器材', 'ｻﾝﾌﾟﾙ'], ['テスト商会', 'ﾃｽﾄ'], ['ダミー歯科商事', 'ﾀﾞﾐｰ'],
    ['見本デンタル', 'ﾐﾎﾝ'], ['架空メディカル', 'ｶｸｳ'], ['例示器械店', 'ﾚｲｼﾞ'], ['試験歯材', 'ｼｹﾝ'],
  ]
  const suppliers = supplierNames.map(([name, short], i) => ({
    id: uid(), name, short_name: short, supplier_code: String(100 + i), maker_name: short, phone: '03-0000-' + pad(1000 + i, 4),
    lead_time_days: ri(1, 4), active: true, created_at: iso(new Date()),
  }))
  await ins('suppliers', suppliers)

  console.log('4) 医院')
  const clinicNames = ['さくら歯科クリニック', 'みなと矯正歯科', 'ひまわりファミリー歯科', 'あおぞらデンタルオフィス', 'もみじ歯科医院', 'つばき歯科・矯正歯科',
    'こもれび歯科', 'はなみずき歯科クリニック', 'ほほえみ歯科', 'すずらん歯科室', 'かもめデンタルクリニック', 'そよかぜ歯科']
  const reps = ['営業 一郎', '営業 花子', '営業 次郎']
  const clinics = clinicNames.map((name, i) => ({
    id: uid(), name: 'デモ）' + name, clinic_code: String(1001 + i), address: '東京都サンプル区' + (i + 1) + '-' + ri(1, 9) + '-' + ri(1, 9),
    phone: '03-1111-' + pad(2000 + i, 4), sales_rep: pick(reps), closing_day: pick(['月末', '20日', '25日']), payment_terms: '翌月末払い',
    payment_method: '銀行振込', active: true, created_at: iso(new Date(Date.now() - 86400000 * 200)),
  }))
  await ins('clinics', clinics)

  console.log('5) 商品（データランドの商品名から選ぶ。価格・在庫は架空）')
  const wb = X.readFile('C:/Users/user/Downloads/ﾃﾞｰﾀﾗﾝﾄﾞﾃﾞｰﾀ.xlsx')
  const all = X.utils.sheet_to_json(wb.Sheets['品目'], { header: 1 }).slice(6)
    .filter(x => x[1] && x[5] && Number(x[6]) >= 300 && Number(x[6]) <= 60000 && String(x[5]).length <= 50 && x[3] && !/諸口|月号|別冊|雑誌/.test(String(x[5])))
  // 偏りを避けるため、メーカーごとに最大5品までにして、シャッフル
  const byMaker = new Map()
  for (const x of all) { const m = String(x[3]); (byMaker.get(m) || byMaker.set(m, []).get(m)).push(x) }
  let pool = []
  for (const arr of byMaker.values()) { arr.sort(() => rnd() - 0.5); pool.push(...arr.slice(0, 5)) }
  pool.sort(() => rnd() - 0.5)
  const chosen = pool.slice(0, 320)
  const categories = ['印象材料', '歯科合着、接着材料', '他の充填用材料', '切断、切削器具', '根管治療、穿刺、穿削', '予防', 'サニタリー', '歯列矯正装置', '他の診療室用機械装置', '滅菌器、消毒器']
  const locations = ['A-1', 'A-2', 'B-1', 'B-2', 'C-1', null]
  const products = chosen.map((x, i) => {
    const price = Math.round(Number(x[6]) / 10) * 10 || Number(x[6])
    const cost = Math.round(price * (0.62 + rnd() * 0.12) / 10) * 10
    const supplier = pick(suppliers)
    return {
      id: uid(), name: String(x[5]).trim(), product_code: String(x[1]).trim(), manufacturer: String(x[3]).trim(),
      category: pick(categories), price, cost, stock: ri(0, 60), reorder_level: pick([3, 5, 10]),
      location: pick(locations), active: true, default_supplier_id: supplier.id, purchase_maker: supplier.short_name,
      barcode: 'D' + pad(i + 1, 5), created_at: iso(new Date(Date.now() - 86400000 * 150)),
    }
  })
  await ins('products', products)

  // 検索画面のデモ用に、マスターにも、一部（選んだ商品＋追加3,000件）を入れる
  const masterRows = []
  const used = new Set()
  const toMaster = x => ({ item_code: String(x[1]).trim(), jan: x[2] ? String(x[2]) : null, maker_kana: x[3] != null ? String(x[3]) : null,
    name_kana: x[4] != null ? String(x[4]) : null, name: String(x[5] ?? x[4]).trim(), list_price: Number(x[6]) || null, source: 'dataland' })
  for (const x of [...chosen, ...pool.slice(320, 3320)]) { const c = String(x[1]).trim(); if (!used.has(c)) { used.add(c); masterRows.push(toMaster(x)) } }
  await ins('master_products', masterRows, 1000)

  console.log('6) 医院別単価・仕入先別単価')
  const clinicPrices = [], supplierPrices = []
  for (const c of clinics) for (const p of products.slice(0, 40).filter(() => rnd() < 0.35)) clinicPrices.push({ id: uid(), clinic_id: c.id, product_id: p.id, unit_price: Math.round(p.price * (0.88 + rnd() * 0.1) / 10) * 10, updated_at: iso(new Date()) })
  for (const p of products) supplierPrices.push({ id: uid(), supplier_id: p.default_supplier_id, product_id: p.id, unit_price: p.cost, updated_at: iso(new Date()) })
  await ins('clinic_prices', clinicPrices)
  await ins('supplier_prices', supplierPrices)

  console.log('7) 注文（過去60日）')
  const orders = [], items = []
  const now = new Date()
  const statuses = d => d > 20 ? '納品済み' : d > 6 ? pick(['納品済み', '納品済み', '準備中']) : pick(['注文受付', '準備中', '準備中'])
  const seqByDay = new Map()
  for (let n = 0; n < 70; n++) {
    const daysAgo = ri(0, 60)
    const created = new Date(now.getTime() - daysAgo * 86400000 - ri(0, 12) * 3600000)
    const clinic = pick(clinics), status = statuses(daysAgo)
    const key = ymd(created); const seq = (seqByDay.get(key) || 0) + 1; seqByDay.set(key, seq)
    const oid = uid(), cnt = ri(2, 6)
    let total = 0
    const chosenP = new Set()
    for (let k = 0; k < cnt; k++) {
      const p = pick(products); if (chosenP.has(p.id)) continue; chosenP.add(p.id)
      const cp = clinicPrices.find(x => x.clinic_id === clinic.id && x.product_id === p.id)
      const price = cp ? cp.unit_price : p.price, qty = ri(1, 6)
      total += price * qty
      items.push({ id: uid(), order_id: oid, product_id: p.id, product_name: p.name, quantity: qty, price,
        delivered_quantity: 0, delivery_status: status === '納品済み' ? '納品済み' : null })
    }
    orders.push({ id: oid, clinic_id: clinic.id, status, created_at: iso(created).replace('Z', ''), total_price: total,
      delivery_number: `DN-${key}-${pad(seq, 4)}-${pad(ri(0, 999), 3)}`, source: pick(['admin', 'admin', 'clinic']), sales_rep: clinic.sales_rep,
      delivered_at: status === '納品済み' ? iso(new Date(created.getTime() + 86400000)) : null,
      note: rnd() < 0.15 ? pick(['至急配達', '午前中希望', '納品書を同梱']) : null })
  }
  await ins('orders', orders)
  await ins('order_items', items)

  console.log('8) 請求書（納品済みの注文を、医院ごとにまとめる）')
  const invoices = []
  const delivered = orders.filter(o => o.status === '納品済み')
  for (const c of clinics.slice(0, 6)) {
    const mine = delivered.filter(o => o.clinic_id === c.id && !o.invoice_id)
    if (mine.length === 0) continue
    const sub = mine.reduce((s, o) => s + o.total_price, 0), tax = Math.floor(sub * 0.1), id = uid()
    invoices.push({ id, clinic_id: c.id, invoice_number: `INV-${ymd(now).slice(0, 6)}-${c.clinic_code}`, issue_date: iso(now).slice(0, 10),
      due_date: iso(new Date(now.getTime() + 30 * 86400000)).slice(0, 10), subtotal: sub, tax, total: sub + tax,
      status: pick(['発行済', '入金済']), created_at: iso(now) })
    mine.forEach(o => { o.invoice_id = id })
  }
  await ins('invoices', invoices)
  for (const o of delivered.filter(o => o.invoice_id)) await sb.from('orders').update({ invoice_id: o.invoice_id }).eq('id', o.id)

  console.log('9) 発注書・入荷')
  const pos = [], poItems = [], receipts = []
  for (let n = 0; n < 12; n++) {
    const s = pick(suppliers), status = pick(['発注済', '発注済', '部分入荷', '入荷済', '入荷済'])
    const created = new Date(now.getTime() - ri(1, 45) * 86400000), poId = uid()
    let total = 0
    for (const p of products.filter(p => p.default_supplier_id === s.id).sort(() => rnd() - 0.5).slice(0, ri(3, 6))) {
      const q = ri(2, 12)
      const received = status === '入荷済み' || status === '入荷済' ? q : status === '部分入荷' ? Math.floor(q / 2) : 0
      total += p.cost * q
      poItems.push({ id: uid(), purchase_order_id: poId, product_id: p.id, product_name: p.name, quantity: q, unit_price: p.cost, received_quantity: received })
      if (received > 0) receipts.push({ id: uid(), product_id: p.id, quantity: received, supplier_id: s.id, unit_price: p.cost, product_name: p.name, created_at: iso(created).replace('Z', ''), memo: '入荷' })
    }
    pos.push({ id: poId, supplier_id: s.id, manufacturer: s.name, status, created_at: iso(created).replace('Z', ''), po_number: `PO-${ymd(created)}-${pad(n + 1, 3)}`, total_amount: total, ordered_at: iso(created) })
  }
  await ins('purchase_orders', pos)
  await ins('purchase_order_items', poItems)
  await ins('stock_receipts', receipts)

  console.log('10) 管理者ログイン')
  const email = 'demo-admin@dent-hub.jp'
  let pw = ''
  const pwFile = 'C:/Users/user/Downloads/デモ環境_ログイン情報.txt'
  if (fs.existsSync(pwFile)) { const m = fs.readFileSync(pwFile, 'utf8').match(/パスワード: (.+)/); if (m) pw = m[1].trim() }
  if (!pw) pw = crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, 'x') + '!7'
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 })
  let user = (list?.users || []).find(u => u.email === email)
  if (user) await sb.auth.admin.updateUserById(user.id, { password: pw, email_confirm: true })
  else { const r = await sb.auth.admin.createUser({ email, password: pw, email_confirm: true }); if (r.error) throw r.error; user = r.data.user }
  await sb.from('profiles').upsert({ id: user.id, role: 'admin' })
  fs.writeFileSync(pwFile, `デモ環境の管理者ログイン（他人に見せない。営業で見せるときだけ、必要な人に伝える）\nログインURL: https://demo.dent-hub.jp/login → 「管理者ログイン」\nメールアドレス: ${email}\nパスワード: ${pw}\n`)
  console.log('  ログイン情報を保存:', pwFile)
  console.log('完了')
})().catch(e => { console.error('失敗:', e.message); process.exit(1) })
