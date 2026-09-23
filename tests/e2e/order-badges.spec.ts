import { test, expect } from "@playwright/test"
import { adminDb, cleanupTestData, TEST_PREFIX } from "./support/db"
import { loginAsAdmin } from "./support/auth"

// 注文一覧（/admin/orders）の「業務状態バッジ」判定を検証する。
// 商品マスタに紐付いていない手入力商品（product_id なし）は、発注書のnoteに
// 埋め込んだ「明細xxxxxxxx」(order_item_id 先頭8桁)から発注状況を逆引きする
// 仕組みになっている（以前に発見・修正した不具合の再発防止も兼ねる）。
//
//  1. 手入力商品2点（X・Y）どちらも未発注 → 📦 要発注
//  2. Xだけ発注済み → 🟠 一部要発注
//  3. X・Y両方発注済み → ⏳ 入荷待ち

test.describe("注文一覧の業務状態バッジ", () => {
  test.afterEach(async () => {
    await cleanupTestData()
  })

  test("手入力商品の発注状況に応じてバッジが要発注→一部要発注→入荷待ちと変化する", async ({ page }) => {
    const { data: clinic } = await adminDb
      .from("clinics")
      .insert({ name: `${TEST_PREFIX}発注判定確認用`, clinic_code: "E2EBIZ" })
      .select("id")
      .single()
    const { data: order } = await adminDb
      .from("orders")
      .insert({ clinic_id: clinic!.id, status: "準備中", total_price: 600, source: "admin" })
      .select("id")
      .single()
    const { data: itemX } = await adminDb
      .from("order_items")
      .insert({ order_id: order!.id, product_id: null, product_name: `${TEST_PREFIX}判定用商品X`, quantity: 5, price: 100 })
      .select("id")
      .single()
    const { data: itemY } = await adminDb
      .from("order_items")
      .insert({ order_id: order!.id, product_id: null, product_name: `${TEST_PREFIX}判定用商品Y`, quantity: 2, price: 50 })
      .select("id")
      .single()

    await loginAsAdmin(page)
    await page.goto("/admin/orders")
    await page.getByRole("button", { name: "📋 一覧" }).first().click()
    await page.getByPlaceholder("納品書No・医院・商品で検索").fill(`${TEST_PREFIX}発注判定確認用`)

    const row = page.getByTestId(`order-row-${order!.id}`)

    // 1. 両方未発注 → 要発注
    await expect(row).toContainText("要発注")
    await expect(row).not.toContainText("一部要発注")
    await expect(row).not.toContainText("入荷待ち")

    // 2. Xだけ発注済みのPOを作る → 一部要発注
    const { data: poX } = await adminDb
      .from("purchase_orders")
      .insert({ po_number: `E2E-${Date.now()}-X`, status: "発注済", total_amount: 500, note: `${TEST_PREFIX}発注判定確認用` })
      .select("id")
      .single()
    await adminDb.from("purchase_order_items").insert({
      purchase_order_id: poX!.id, product_id: null,
      product_name: `${TEST_PREFIX}判定用商品X`, quantity: 5, unit_price: 100, received_quantity: 0,
      note: `[${TEST_PREFIX}発注判定確認用] 注文 ${order!.id.slice(0, 8)} 明細${itemX!.id.slice(0, 8)}`,
    })

    await page.reload()
    await page.getByRole("button", { name: "📋 一覧" }).first().click()
    await page.getByPlaceholder("納品書No・医院・商品で検索").fill(`${TEST_PREFIX}発注判定確認用`)
    await expect(row).toContainText("一部要発注")

    // 3. Yも発注済みにする → 入荷待ち
    const { data: poY } = await adminDb
      .from("purchase_orders")
      .insert({ po_number: `E2E-${Date.now()}-Y`, status: "発注済", total_amount: 100, note: `${TEST_PREFIX}発注判定確認用` })
      .select("id")
      .single()
    await adminDb.from("purchase_order_items").insert({
      purchase_order_id: poY!.id, product_id: null,
      product_name: `${TEST_PREFIX}判定用商品Y`, quantity: 2, unit_price: 50, received_quantity: 0,
      note: `[${TEST_PREFIX}発注判定確認用] 注文 ${order!.id.slice(0, 8)} 明細${itemY!.id.slice(0, 8)}`,
    })

    await page.reload()
    await page.getByRole("button", { name: "📋 一覧" }).first().click()
    await page.getByPlaceholder("納品書No・医院・商品で検索").fill(`${TEST_PREFIX}発注判定確認用`)
    await expect(row).toContainText("入荷待ち")
  })
})
