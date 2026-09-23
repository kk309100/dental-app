import { test, expect } from "@playwright/test"
import { adminDb, cleanupTestData, TEST_PREFIX } from "./support/db"
import { loginAsAdmin } from "./support/auth"

// 入荷処理画面（/admin/receiving-from-po）の基幹フローを検証する。
// 発注済みの発注書を1件用意し、その商品にチェックを入れて「入荷処理」を押すと、
//  - 商品の在庫が届いた数だけ加算される
//  - 発注書明細の received_quantity が更新される
//  - 発注書のステータスが「入荷済」になる（全量入荷のため）
// ことを、実際のSupabaseに使い捨てデータを作って検証する。

test.describe("入荷処理", () => {
  test.afterEach(async () => {
    await cleanupTestData()
  })

  test("発注済みの商品にチェックを入れて入荷処理すると、在庫加算・PO更新される", async ({ page }) => {
    const { data: product } = await adminDb
      .from("products")
      .insert({ name: `${TEST_PREFIX}入荷処理確認商品`, stock: 2, active: true })
      .select("id")
      .single()
    const poNumber = `E2E-${Date.now()}`
    const { data: po } = await adminDb
      .from("purchase_orders")
      .insert({
        po_number: poNumber,
        status: "発注済",
        total_amount: 500,
        note: `${TEST_PREFIX}入荷処理確認用`,
        ordered_at: new Date().toISOString(),
      })
      .select("id")
      .single()
    const { data: item } = await adminDb
      .from("purchase_order_items")
      .insert({
        purchase_order_id: po!.id, product_id: product!.id,
        product_name: `${TEST_PREFIX}入荷処理確認商品`,
        quantity: 5, unit_price: 100, received_quantity: 0,
      })
      .select("id")
      .single()

    await loginAsAdmin(page)
    await page.goto("/admin/receiving-from-po")

    const card = page.getByTestId(`po-card-${po!.id}`)
    await expect(card).toBeVisible()
    // 未入荷分は初期状態で自動的にチェックされている想定
    await card.getByRole("button", { name: "✅ 1品を入荷処理", exact: true }).click()

    // 入荷結果サマリー（処理完了後にだけ表示される文言）が出るまで待つ。
    // ※ poNumber 自体はカードのヘッダーに処理前から表示されているため、それだけを
    //   待っても「処理が終わった」ことの確認にならない点に注意。
    await expect(page.getByText("品を入荷処理 —")).toBeVisible({ timeout: 10_000 })

    const { data: updatedProduct } = await adminDb.from("products").select("stock").eq("id", product!.id).single()
    const { data: updatedItem } = await adminDb.from("purchase_order_items").select("received_quantity").eq("id", item!.id).single()
    const { data: updatedPo } = await adminDb.from("purchase_orders").select("status").eq("id", po!.id).single()

    expect(updatedProduct?.stock).toBe(7) // 2 + 5
    expect(updatedItem?.received_quantity).toBe(5)
    expect(updatedPo?.status).toBe("入荷済")
  })
})
