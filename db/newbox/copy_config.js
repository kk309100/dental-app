// 本番(旧) → 新しい箱 へ、「設定データ」をコピーする。取引データ（注文・請求・入荷・在庫の動き）はコピーしない。
// 本番(.env.local)は読み取りのみ。書き込み先は .env.new（本番と同じ接続先なら中止）。何度実行しても、同じ状態になる(upsert)。
// 在庫: 9/22の棚卸（棚卸調整）の「調整後の数」を出発点にし、数えていない商品は0にする。
const fs = require('fs'), crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')
const read = (f, k) => ((fs.readFileSync(f, 'utf8').match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1] || '').trim().replace(/^["']|["']$/g, '')
const OLD_URL = 'https://alcetorurdocopxatego.supabase.co', OLD_KEY = read('.env.local', 'SUPABASE_SERVICE_ROLE_KEY')
const NEW_URL = read('.env.new', 'NEXT_PUBLIC_SUPABASE_URL'), NEW_KEY = read('.env.new', 'SUPABASE_SERVICE_ROLE_KEY')
if (!NEW_URL || !NEW_KEY || new URL(NEW_URL).host === new URL(OLD_URL).host) throw new Error('書き込み先が不正です（本番と同じ、または未設定）。中止します')
const oldDb = createClient(OLD_URL, OLD_KEY, { auth: { persistSession: false } })
const newDb = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

async function readAll(t, qf = q => q, cols = '*') {
  let o = [], f = 0
  for (;;) {
    const { data, error } = await qf(oldDb.from(t).select(cols)).order('id').range(f, f + 999)
    if (error) throw new Error(`読み取り ${t}: ${error.message}`)
    o = o.concat(data); if (data.length < 1000) break; f += 1000
  }
  return o
}
async function write(t, rows, chunk = 1000, conflict = 'id') {
  for (let i = 0; i < rows.length; i += chunk) {
    let lastErr = null
    for (let k = 0; k < 5; k++) {   // 通信が途中で切れても、自動でやり直す（upsert なので、重複しない）
      const { error } = await newDb.from(t).upsert(rows.slice(i, i + chunk), { onConflict: conflict })
      if (!error) { lastErr = null; break }
      lastErr = error
      await new Promise(r => setTimeout(r, 2000 * (k + 1)))
    }
    if (lastErr) throw new Error(`書き込み ${t}: ${lastErr.message}`)
    if (rows.length > 20000 && (i / chunk) % 40 === 0) console.log(`    ${t}: ${Math.min(i + chunk, rows.length)}/${rows.length}`)
  }
}
// 新しい箱に存在しない列は、除く（旧DBにだけある列の差を吸収）
let newCols = null
async function cols(t) {
  if (!newCols) newCols = (await fetch(NEW_URL + '/rest/v1/', { headers: { apikey: NEW_KEY, Authorization: 'Bearer ' + NEW_KEY } }).then(r => r.json())).definitions
  return Object.keys(newCols[t].properties)
}
async function copy(t, opts = {}) {
  const rows = await readAll(t, opts.qf)
  const c = new Set(await cols(t))
  const out = rows.map(r => { const o = {}; for (const k of Object.keys(r)) if (c.has(k)) o[k] = r[k]; return opts.map ? opts.map(o) : o })
  await write(t, out, opts.chunk || 1000, opts.conflict)
  console.log(`  ${t}: ${out.length}件`)
  return out
}

;(async () => {
  console.log('接続先(新):', new URL(NEW_URL).host.replace(/^[^.]+/, '〇〇〇〇'))

  console.log('1) 在庫の出発点（9/22の棚卸調整）を集計')
  const mv = await readAll('stock_movements', q => q.eq('movement_type', '棚卸調整').gte('occurred_at', '2026-09-22T00:00:00').lt('occurred_at', '2026-09-23T00:00:00'), 'id,product_id,after_stock,occurred_at')
  const opening = new Map()
  mv.sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at))).forEach(m => opening.set(m.product_id, Number(m.after_stock) || 0))
  console.log('  棚卸で数えた商品:', opening.size, '/ 在庫の合計', Array.from(opening.values()).reduce((s, v) => s + v, 0))

  console.log('2) 設定データをコピー')
  await copy('categories'); await copy('manufacturers'); await copy('company_settings', { conflict: 'id' })
  await copy('suppliers')
  await copy('clinics')
  // 商品マスターは、全件(25万件)ではなく、いま使っている商品に紐づいているものだけを入れる（ディスクと負荷を抑えるため）。
  // 全件の検索が必要になったら、あとから、少しずつ追加する。
  const prodRows = await readAll('products')
  const masterIds = Array.from(new Set(prodRows.map(p => p.master_product_id).filter(Boolean)))
  const masterRows = []
  for (let i = 0; i < masterIds.length; i += 100) {
    const { data, error } = await oldDb.from('master_products').select('*').in('id', masterIds.slice(i, i + 100))
    if (error) throw new Error(`読み取り master_products: ${error.message}`)
    masterRows.push(...data)
  }
  const mc = new Set(await cols('master_products'))
  await write('master_products', masterRows.map(r => { const o = {}; for (const k of Object.keys(r)) if (mc.has(k)) o[k] = r[k]; return o }), 200)
  console.log(`  master_products: ${masterRows.length}件（使っている商品に紐づくもののみ）`)
  const pc = new Set(await cols('products'))
  const prodOut = prodRows.map(p => { const o = {}; for (const k of Object.keys(p)) if (pc.has(k)) o[k] = p[k]; o.stock = opening.has(p.id) ? opening.get(p.id) : 0; delete o.stock_quantity; return o })
  await write('products', prodOut, 500)
  console.log(`  products: ${prodOut.length}件`)
  await copy('supplier_prices'); await copy('clinic_prices'); await copy('clinic_product_prices')
  await copy('palladium_prices'); await copy('tooth_chart_templates'); await copy('tooth_chart_template_items')
  await copy('feedback_notes'); await copy('sales_reps')

  console.log('3) 管理者アカウント')
  const email = 'aij86550@gmail.com', pwFile = 'C:/Users/user/Downloads/新しい箱_ログイン情報.txt'
  let pw = ''
  if (fs.existsSync(pwFile)) { const m = fs.readFileSync(pwFile, 'utf8').match(/パスワード: (.+)/); if (m) pw = m[1].trim() }
  if (!pw) pw = crypto.randomBytes(12).toString('base64').replace(/[+/=]/g, 'k') + '#9'
  const { data: list } = await newDb.auth.admin.listUsers({ page: 1, perPage: 200 })
  let user = (list?.users || []).find(u => u.email === email)
  if (!user) { const r = await newDb.auth.admin.createUser({ email, password: pw, email_confirm: true }); if (r.error) throw r.error; user = r.data.user }
  await newDb.from('profiles').upsert({ id: user.id, role: 'admin' })
  fs.writeFileSync(pwFile, `新しい本番データベースの管理者ログイン（他人に見せない）\nメールアドレス: ${email}\nパスワード: ${pw}\n※ 本番の画面を新しい箱に切り替えたあと、このメールアドレスとパスワードで、管理者ログインします。\n`)
  console.log('  管理者を作成。ログイン情報:', pwFile)
  console.log('完了')
})().catch(e => { console.error('失敗:', e.message); process.exit(1) })
