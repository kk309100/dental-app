// テストシナリオ自動実行スクリプト
//   ① トランザクションデータをクリア (orders, items, POs, invoices, slips, movements)
//   ② 10医院に注文作成
//   ③ 在庫不足を集計 → 3社の仕入先に発注書3件作成
//   ④ 発注書を「入荷済」に + 在庫加算
//   ⑤ 10医院に納品書発行 + 在庫減算 + 注文を「納品済み」
//   ⑥ 医院ごとに請求書発行 + 注文に紐付け
//
// マスタ (clinics, suppliers, products, supplier_prices, clinic_prices) は触らない
//
// 実行: node scripts/seed-test-scenario.mjs

import { createClient } from "@supabase/supabase-js"

const URL = process.env.SUPABASE_URL || "https://alcetorurdocopxatego.supabase.co"
const KEY = process.env.SUPABASE_KEY || "sb_publishable_VbmRpikpm6xr_lUaqo_MgQ_9swmJ_1j"
const supabase = createClient(URL, KEY)

const log = (msg) => console.log(`[${new Date().toLocaleTimeString("ja-JP")}] ${msg}`)
const sample = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n)
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
const NULL_UUID = "00000000-0000-0000-0000-000000000000"

const today = new Date()
const todayStr = today.toISOString().slice(0, 10)
const todayCompact = todayStr.replace(/-/g, "")

// ─── Step 1: クリア ───────────────────────────
log("============================================")
log("STEP 1: トランザクションデータをクリア")
log("============================================")

const tablesToClean = [
  "delivery_slips",
  "purchase_order_items",
  "purchase_orders",
  "stock_movements",
  "order_items",
  "orders",
]

for (const t of tablesToClean) {
  const { error, count } = await supabase
    .from(t).delete({ count: "exact" }).neq("id", NULL_UUID)
  if (error) log(`  ✗ ${t}: ${error.message}`)
  else log(`  ✓ ${t}: ${count ?? "?"} 件削除`)
}

// invoice_items は存在しない可能性
try {
  const { error } = await supabase.from("invoice_items").delete().neq("id", NULL_UUID)
  if (error && !error.message.includes("does not exist")) log(`  ✗ invoice_items: ${error.message}`)
  else log(`  ✓ invoice_items 削除（または無し）`)
} catch (e) { log(`  ✓ invoice_items: ${e.message}`) }

const { error: invErr, count: invCount } = await supabase
  .from("invoices").delete({ count: "exact" }).neq("id", NULL_UUID)
if (invErr) log(`  ✗ invoices: ${invErr.message}`)
else log(`  ✓ invoices: ${invCount ?? "?"} 件削除`)

// ─── Step 2: マスタ取得 ───────────────────────
log("")
log("============================================")
log("STEP 2: マスタ取得")
log("============================================")
const [clinicsRes, suppliersRes, productsRes] = await Promise.all([
  supabase.from("clinics").select("id,name,corporate_name").limit(50000),
  supabase.from("suppliers").select("id,name").limit(50000),
  supabase.from("products").select("id,name,product_code,price,cost,stock,manufacturer").limit(50000),
])
const allClinics = clinicsRes.data || []
const allSuppliers = suppliersRes.data || []
const allProducts = (productsRes.data || []).filter(p => Number(p.price) > 0)
log(`  clinics: ${allClinics.length}, suppliers: ${allSuppliers.length}, products(price>0): ${allProducts.length}`)

if (allClinics.length < 10 || allSuppliers.length < 3 || allProducts.length < 30) {
  log("⚠ マスタが足りません（10医院/3仕入先/30商品 必要）")
  process.exit(1)
}

// ─── Step 3: 10医院に注文作成 ────────────────
log("")
log("============================================")
log("STEP 3: 10医院に注文作成")
log("============================================")
const selectedClinics = sample(allClinics, 10)
const createdOrders = []

let dnSeq = 1
for (const clinic of selectedClinics) {
  const itemCount = rand(3, 6)
  const items = sample(allProducts, itemCount).map(p => ({
    product_id: p.id,
    product_name: p.name,
    quantity: rand(1, 5),
    price: Number(p.price),
  }))
  const total = items.reduce((s, it) => s + it.price * it.quantity, 0)
  const dn = `DN-${todayCompact}-${String(dnSeq).padStart(4, "0")}-${rand(100, 999)}`
  dnSeq++

  const { data: order, error } = await supabase.from("orders").insert({
    clinic_id: clinic.id,
    status: "注文受付",
    total_price: total,
    delivery_number: dn,
    source: "admin",
    sales_rep: "テスト営業",
    note: "テストシナリオ自動作成",
  }).select().single()
  if (error) {
    // sales_rep / source / note 列がない時のフォールバック
    const { data: o2, error: e2 } = await supabase.from("orders").insert({
      clinic_id: clinic.id, status: "注文受付", total_price: total, delivery_number: dn,
    }).select().single()
    if (e2 || !o2) { log(`  ✗ ${clinic.name}: ${error.message}`); continue }
    createdOrders.push({ ...o2, items, clinic })
    await supabase.from("order_items").insert(items.map(it => ({ ...it, order_id: o2.id })))
    log(`  ✓ ${clinic.name}: ${dn} (${itemCount}品 ¥${total.toLocaleString()}) [新スキーマ列なし]`)
    continue
  }

  await supabase.from("order_items").insert(items.map(it => ({ ...it, order_id: order.id })))
  createdOrders.push({ ...order, items, clinic })
  log(`  ✓ ${clinic.name}: ${dn} (${itemCount}品 ¥${total.toLocaleString()})`)
}

if (createdOrders.length === 0) {
  log("⚠ 注文が1件も作成できませんでした。終了")
  process.exit(1)
}

// ─── Step 4: 在庫不足検出 → 3社へ発注書 ──────
log("")
log("============================================")
log("STEP 4: 在庫不足を3社へ発注（PO 3件作成）")
log("============================================")

// 全注文商品の必要数集計
const requiredByProduct = new Map()
for (const o of createdOrders) {
  for (const it of o.items) {
    requiredByProduct.set(it.product_id, (requiredByProduct.get(it.product_id) || 0) + it.quantity)
  }
}

// 在庫不足 + 念のため全商品も発注対象にする（テストのため）
const productsToOrder = []
for (const [pid, needed] of requiredByProduct) {
  const p = allProducts.find(x => x.id === pid)
  if (!p) continue
  const stock = Number(p.stock || 0)
  // 在庫不足 OR 残在庫が10個未満なら補充
  if (stock < needed || stock < 10) {
    productsToOrder.push({ product: p, needed: Math.max(needed - stock, 10) })
  }
}
log(`  発注対象商品: ${productsToOrder.length} 種類`)

if (productsToOrder.length === 0) {
  // 在庫十分でも、テストとしてランダムに発注書を作る
  const sampleForPO = sample(allProducts, 15)
  for (const p of sampleForPO) {
    productsToOrder.push({ product: p, needed: rand(10, 30) })
  }
  log(`  → 在庫十分なのでテスト用にランダム ${productsToOrder.length} 商品を選定`)
}

// 3社にラウンドロビン振り分け
const selectedSuppliers = sample(allSuppliers, 3)
const poBySupplier = new Map(selectedSuppliers.map(s => [s.id, []]))
productsToOrder.forEach((item, idx) => {
  const supplier = selectedSuppliers[idx % 3]
  poBySupplier.get(supplier.id).push({
    product_id: item.product.id,
    product_name: item.product.name,
    quantity: item.needed,
    unit_price: Number(item.product.cost) || Math.floor(Number(item.product.price) * 0.6),
  })
})

let poSeq = 1
const createdPOs = []
for (const [supplierId, items] of poBySupplier) {
  if (items.length === 0) continue
  const supplier = selectedSuppliers.find(s => s.id === supplierId)
  const total = items.reduce((s, it) => s + it.unit_price * it.quantity, 0)
  const poNo = `PO-${todayCompact}-${String(poSeq).padStart(3, "0")}`
  poSeq++

  const { data: po, error } = await supabase.from("purchase_orders").insert({
    po_number: poNo,
    supplier_id: supplierId,
    status: "発注済",
    ordered_at: today.toISOString(),
    total_amount: total,
    sent_method: "FAX",
    sent_at: today.toISOString(),
    note: `テストシナリオ自動作成（注文 ${createdOrders.length} 件分の在庫補充）`,
  }).select().single()
  if (error) { log(`  ✗ ${supplier.name}: ${error.message}`); continue }

  const itemsToInsert = items.map(it => ({ ...it, purchase_order_id: po.id, received_quantity: 0 }))
  const { error: ie } = await supabase.from("purchase_order_items").insert(itemsToInsert)
  if (ie) { log(`  ✗ ${supplier.name} 明細: ${ie.message}`); continue }

  createdPOs.push({ ...po, items, supplier })
  log(`  ✓ ${supplier.name}: ${poNo} (${items.length}品 ¥${total.toLocaleString()})`)
}

// ─── Step 5: 入荷シミュレート（在庫加算）────
log("")
log("============================================")
log("STEP 5: 発注書 → 入荷済 + 在庫加算")
log("============================================")
for (const po of createdPOs) {
  for (const it of po.items) {
    await supabase.from("purchase_order_items")
      .update({ received_quantity: it.quantity })
      .eq("purchase_order_id", po.id)
      .eq("product_id", it.product_id)
    const product = allProducts.find(p => p.id === it.product_id)
    if (product) {
      const newStock = Number(product.stock || 0) + it.quantity
      await supabase.from("products").update({ stock: newStock }).eq("id", it.product_id)
      product.stock = newStock
    }
  }
  await supabase.from("purchase_orders").update({ status: "入荷済" }).eq("id", po.id)
  log(`  ✓ ${po.po_number} を「入荷済」に + 在庫加算`)
}

// ─── Step 6: 10社納品 ────────────────────────
log("")
log("============================================")
log("STEP 6: 10社に納品書発行 + 在庫減算 + 注文を納品済みに")
log("============================================")
let dsSeq = 1
const createdSlips = []
for (const order of createdOrders) {
  const slipNo = `DS-${todayCompact}-${String(dsSeq).padStart(4, "0")}`
  dsSeq++

  const { data: slip, error: slipErr } = await supabase.from("delivery_slips").insert({
    slip_number: slipNo,
    clinic_id: order.clinic_id,
    delivered_on: todayStr,
    total_amount: order.total_price,
    status: "出荷済",
    shipped_at: today.toISOString(),
  }).select().single()
  if (slipErr) { log(`  ✗ ${order.clinic.name}: ${slipErr.message}`); continue }

  // 注文を納品済みに
  const updPayload = { status: "納品済み", delivered_at: today.toISOString(), delivery_slip_id: slip.id }
  const { error: updErr } = await supabase.from("orders").update(updPayload).eq("id", order.id)
  if (updErr) {
    // delivery_slip_id 列ない場合のフォールバック
    await supabase.from("orders").update({ status: "納品済み", delivered_at: today.toISOString() }).eq("id", order.id)
  }

  // 在庫減算
  for (const it of order.items) {
    const product = allProducts.find(p => p.id === it.product_id)
    if (product) {
      const newStock = Math.max(0, Number(product.stock || 0) - it.quantity)
      await supabase.from("products").update({ stock: newStock }).eq("id", it.product_id)
      product.stock = newStock
    }
  }

  createdSlips.push(slip)
  log(`  ✓ ${order.clinic.name}: 納品書 ${slipNo}`)
}

// ─── Step 7: 請求書発行 ──────────────────────
log("")
log("============================================")
log("STEP 7: 医院ごとに請求書発行")
log("============================================")
let invSeq = 1
const createdInvoices = []
const dueDate = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10)

for (const order of createdOrders) {
  const subtotal = order.total_price
  const tax = Math.floor(subtotal * 0.1)
  const total = subtotal + tax
  const invNo = `INV-${todayCompact}-${String(invSeq).padStart(4, "0")}`
  invSeq++

  const { data: inv, error } = await supabase.from("invoices").insert({
    clinic_id: order.clinic_id,
    invoice_number: invNo,
    issue_date: todayStr,
    due_date: dueDate,
    subtotal,
    tax,
    total,
    status: "issued",
    notes: "テストシナリオ自動作成",
  }).select().single()
  if (error) { log(`  ✗ ${order.clinic.name}: ${error.message}`); continue }

  await supabase.from("orders").update({ invoice_id: inv.id }).eq("id", order.id)

  createdInvoices.push(inv)
  log(`  ✓ ${order.clinic.name}: 請求書 ${invNo} (¥${total.toLocaleString()})`)
}

// ─── 完了 ──────────────────────────────
log("")
log("============================================")
log("✅ 完了!")
log("============================================")
log(`  注文:    ${createdOrders.length} 件`)
log(`  発注書:  ${createdPOs.length} 件 (入荷済)`)
log(`  納品書:  ${createdSlips.length} 件`)
log(`  請求書:  ${createdInvoices.length} 件`)
log("")
log("画面で確認:")
log("  /admin/orders        - 10件すべて納品済み")
log("  /admin/purchase-orders - 3件すべて入荷済")
log("  /admin/deliveries    - 10件納品書")
log("  /admin/invoices      - 10件請求書（発行済）")
