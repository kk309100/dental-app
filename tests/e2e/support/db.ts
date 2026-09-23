// E2Eテストからテストデータを直接作成・削除するためのSupabase(service role)クライアント。
// .env.local を dotenv 無しで読み込む（このリポジトリの他の一回限りスクリプトと同じ方式）。
import fs from "fs"
import path from "path"
import { createClient } from "@supabase/supabase-js"

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(__dirname, "../../../.env.local")
  const env: Record<string, string> = {}
  if (!fs.existsSync(envPath)) return env
  fs.readFileSync(envPath, "utf8").split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2]
  })
  return env
}

const env = loadEnvLocal()
const SUPABASE_URL = "https://alcetorurdocopxatego.supabase.co"
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY が見つかりません（.env.local を確認してください）")
}

export const adminDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// テスト用データには必ずこのプレフィックスを付け、テスト終了後に確実に一致するものだけを消す。
export const TEST_PREFIX = "【E2Eテスト】"

export async function cleanupTestData() {
  const { data: clinics } = await adminDb
    .from("clinics")
    .select("id")
    .ilike("name", `${TEST_PREFIX}%`)
  const clinicIds = (clinics || []).map((c) => c.id)

  const { data: products } = await adminDb
    .from("products")
    .select("id")
    .ilike("name", `${TEST_PREFIX}%`)
  const productIds = (products || []).map((p) => p.id)

  if (clinicIds.length > 0) {
    const { data: orders } = await adminDb
      .from("orders")
      .select("id,invoice_id")
      .in("clinic_id", clinicIds)
    const orderIds = (orders || []).map((o) => o.id)
    const invoiceIds = (orders || []).map((o) => o.invoice_id).filter(Boolean) as string[]

    if (orderIds.length > 0) {
      await adminDb.from("order_items").delete().in("order_id", orderIds)
      await adminDb.from("delivery_slip_items").delete().in(
        "delivery_slip_id",
        (await adminDb.from("delivery_slips").select("id").in("order_id", orderIds)).data?.map((d: any) => d.id) || []
      )
      await adminDb.from("delivery_slips").delete().in("order_id", orderIds)
      await adminDb.from("orders").delete().in("id", orderIds)
    }
    if (invoiceIds.length > 0) {
      await adminDb.from("invoices").delete().in("id", invoiceIds)
    }
  }

  const { data: pos } = await adminDb
    .from("purchase_orders")
    .select("id")
    .ilike("note", `${TEST_PREFIX}%`)
  const poIds = (pos || []).map((p) => p.id)
  if (poIds.length > 0) {
    await adminDb.from("purchase_order_items").delete().in("purchase_order_id", poIds)
    await adminDb.from("purchase_orders").delete().in("id", poIds)
  }

  if (productIds.length > 0) {
    await adminDb.from("stock_movements").delete().in("product_id", productIds)
    await adminDb.from("stock_receipts").delete().in("product_id", productIds)
    await adminDb.from("products").delete().in("id", productIds)
  }

  if (clinicIds.length > 0) {
    await adminDb.from("clinics").delete().in("id", clinicIds)
  }
}
