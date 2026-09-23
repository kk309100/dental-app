import { test, expect } from "@playwright/test"
import { adminDb, cleanupTestData, TEST_PREFIX } from "./support/db"
import { loginAsAdmin } from "./support/auth"

// 受注処理画面（/admin/orders/process）の基幹フローを検証する。
//  1. 出荷準備モード（既定OFF）: 在庫十分な注文を処理しても、在庫は減らさず「準備中」になるだけ
//  2. 売上処理モード（ON）: 在庫十分な注文を処理すると、在庫が減り、納品済み＋請求書が作られる
// どちらも実際のSupabaseに使い捨てのテストデータを作り、処理後にDBの結果を直接検証し、最後に必ず削除する。

test.describe("受注処理", () => {
  test.afterEach(async () => {
    await cleanupTestData()
  })

  test("出荷準備モード（既定）で処理すると、在庫は減らさず準備中になる", async ({ page }) => {
    const { data: clinic } = await adminDb
      .from("clinics")
      .insert({ name: `${TEST_PREFIX}出荷準備モード確認用`, clinic_code: "E2ESHIP" })
      .select("id")
      .single()
    const { data: product } = await adminDb
      .from("products")
      .insert({ name: `${TEST_PREFIX}出荷準備モード確認商品`, stock: 10, active: true })
      .select("id")
      .single()
    const { data: order } = await adminDb
      .from("orders")
      .insert({ clinic_id: clinic!.id, status: "注文受付", total_price: 600, source: "admin" })
      .select("id")
      .single()
    await adminDb.from("order_items").insert({
      order_id: order!.id, product_id: product!.id,
      product_name: `${TEST_PREFIX}出荷準備モード確認商品`, quantity: 3, price: 200,
    })

    await loginAsAdmin(page)
    await page.goto("/admin/orders/process")

    // sellMode は既定でOFFのはず（別テストのlocalStorageから独立した新規ブラウザコンテキスト）
    await expect(page.getByText("出荷準備モード", { exact: true })).toBeVisible()

    const card = page.getByTestId(`order-card-${order!.id}`)
    await expect(card).toContainText(`${TEST_PREFIX}出荷準備モード確認用`)
    await card.getByRole("button", { name: "この注文を処理する →" }).click()
    await expect(page.getByText("処理完了")).toBeVisible({ timeout: 10_000 })

    const { data: updatedOrder } = await adminDb.from("orders").select("status,invoice_id").eq("id", order!.id).single()
    const { data: updatedProduct } = await adminDb.from("products").select("stock").eq("id", product!.id).single()

    expect(updatedOrder?.status).toBe("準備中")
    expect(updatedOrder?.invoice_id).toBeNull()
    expect(updatedProduct?.stock).toBe(10) // 在庫は変化しない
  })

  test("売上処理モードONで処理すると、在庫が減り納品済み＋請求書になる", async ({ page }) => {
    const { data: clinic } = await adminDb
      .from("clinics")
      .insert({ name: `${TEST_PREFIX}売上処理モード確認用`, clinic_code: "E2ESELL" })
      .select("id")
      .single()
    const { data: product } = await adminDb
      .from("products")
      .insert({ name: `${TEST_PREFIX}売上処理モード確認商品`, stock: 10, active: true })
      .select("id")
      .single()
    const { data: order } = await adminDb
      .from("orders")
      .insert({ clinic_id: clinic!.id, status: "注文受付", total_price: 600, source: "admin" })
      .select("id")
      .single()
    await adminDb.from("order_items").insert({
      order_id: order!.id, product_id: product!.id,
      product_name: `${TEST_PREFIX}売上処理モード確認商品`, quantity: 3, price: 200,
    })

    await loginAsAdmin(page)
    await page.goto("/admin/orders/process")

    await page.getByTestId("sell-mode-toggle").click()
    await expect(page.getByText("売上処理モード（ON）")).toBeVisible()

    const card = page.getByTestId(`order-card-${order!.id}`)
    await expect(card).toContainText(`${TEST_PREFIX}売上処理モード確認用`)
    await card.getByRole("button", { name: "💰 売上処理する →" }).click()
    await expect(page.getByText("処理完了")).toBeVisible({ timeout: 10_000 })

    const { data: updatedOrder } = await adminDb.from("orders").select("status,invoice_id").eq("id", order!.id).single()
    const { data: updatedProduct } = await adminDb.from("products").select("stock").eq("id", product!.id).single()

    expect(updatedOrder?.status).toBe("納品済み")
    expect(updatedOrder?.invoice_id).not.toBeNull()
    expect(updatedProduct?.stock).toBe(7) // 10 - 3
  })
})
