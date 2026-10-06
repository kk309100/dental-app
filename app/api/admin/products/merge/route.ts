import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"

// 重複商品の統合: removeIds の商品を keepId に寄せる。
// 注文・発注・見積・入荷・在庫履歴などの product_id を keepId に付け替え、在庫を合算してから removeIds を削除する。
// 管理者のみ。

const SUPABASE_URL = "https://alcetorurdocopxatego.supabase.co"

// 付け替えるだけでよいテーブル（重複して困る一意制約が無い履歴系）。[テーブル, 商品IDの列]
const REPOINT_TABLES: [string, string][] = [
  ["order_items", "product_id"], ["purchase_order_items", "product_id"], ["quote_items", "product_id"],
  ["stock_receipts", "product_id"], ["stock_movements", "product_id"], ["clinic_inventory_items", "product_id"],
  ["inventory_logs", "product_id"], ["supplier_invoice_items", "matched_product_id"],
]
// 一意制約がありうるテーブル: 付け替えを試み、keep 側に同じ行が既にあって失敗したら統合元の行は捨てる
const MERGE_ROWS_TABLES: [string, string][] = [
  ["clinic_prices", "product_id"], ["clinic_product_prices", "product_id"], ["supplier_prices", "product_id"],
  ["product_suppliers", "product_id"], ["supplier_product_mappings", "product_id"], ["supplier_product_aliases", "product_id"],
  ["favorites", "product_id"], ["stocktake_items", "product_id"], ["tooth_chart_template_items", "product_id"],
]

export async function POST(request: NextRequest) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return NextResponse.json({ error: "サーバー設定エラー（環境変数未設定）" }, { status: 500 })

  const token = (request.headers.get("Authorization") ?? "").replace("Bearer ", "").trim()
  if (!token) return NextResponse.json({ error: "認証エラー（トークンなし）" }, { status: 401 })

  const admin = createClient(SUPABASE_URL, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: { user }, error: authError } = await admin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: "認証エラー（無効なトークン）" }, { status: 401 })
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin") return NextResponse.json({ error: "権限がありません" }, { status: 403 })

  let body: { keepId?: string; removeIds?: string[] }
  try { body = await request.json() } catch { return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 }) }
  const keepId = body.keepId
  const removeIds = Array.from(new Set(body.removeIds ?? [])).filter(id => id && id !== keepId)
  if (!keepId || removeIds.length === 0) return NextResponse.json({ error: "keepId と removeIds が必要です" }, { status: 400 })

  const { data: keep } = await admin.from("products").select("*").eq("id", keepId).single()
  if (!keep) return NextResponse.json({ error: "残す商品が見つかりません" }, { status: 404 })

  const merged: string[] = []
  const errors: string[] = []

  for (const rid of removeIds) {
    const { data: rem } = await admin.from("products").select("*").eq("id", rid).single()
    if (!rem) { errors.push(`${rid}: 統合元が見つかりません`); continue }
    try {
      // 1) 履歴系は付け替え（テーブルごとに並行して一括更新）
      const repointErrors = await Promise.all(REPOINT_TABLES.map(async ([t, col]) => {
        const { error } = await admin.from(t).update({ [col]: keepId }).eq(col, rid)
        return error ? `${t}: ${error.message}` : null
      }))
      const re = repointErrors.find(Boolean)
      if (re) throw new Error(re)
      // 2) 一意制約がありうるテーブルは、まず一括で付け替える。
      //    一意制約に当たって失敗したテーブルだけ、行ごとに付け替え、衝突した行(keep側に同じものがある)は捨てる
      const mergeErrors = await Promise.all(MERGE_ROWS_TABLES.map(async ([t, col]) => {
        const bulk = await admin.from(t).update({ [col]: keepId }).eq(col, rid)
        if (!bulk.error) return null
        const { data: rows, error: se } = await admin.from(t).select("id").eq(col, rid)
        if (se) return `${t}: ${se.message}`
        for (const r of rows ?? []) {
          const { error } = await admin.from(t).update({ [col]: keepId }).eq("id", r.id)
          if (error) {
            const { error: de } = await admin.from(t).delete().eq("id", r.id)
            if (de) return `${t}: ${de.message}`
          }
        }
        return null
      }))
      const me = mergeErrors.find(Boolean)
      if (me) throw new Error(me)
      // 3) 在庫を合算し、残す側が空の項目だけ統合元の値で補う
      const patch: Record<string, unknown> = { stock: Number(keep.stock || 0) + Number(rem.stock || 0) }
      for (const k of ["manufacturer", "category", "cost", "price", "reorder_level", "location", "purchase_maker", "default_supplier_id", "image_url"]) {
        if ((keep[k] === null || keep[k] === undefined || keep[k] === "") && rem[k] !== null && rem[k] !== undefined && rem[k] !== "") patch[k] = rem[k]
      }
      const { error: ue } = await admin.from("products").update(patch).eq("id", keepId)
      if (ue) throw new Error(`products更新: ${ue.message}`)
      keep.stock = patch.stock
      Object.assign(keep, patch)
      // 途中で失敗して再実行になっても在庫が二重に加算されないよう、統合元の在庫は0にしておく
      await admin.from("products").update({ stock: 0 }).eq("id", rid)
      // 4) 統合元を削除
      const { error: de } = await admin.from("products").delete().eq("id", rid)
      if (de) throw new Error(`削除: ${de.message}`)
      merged.push(rid)
    } catch (e: unknown) {
      errors.push(`${rid}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return NextResponse.json({ merged: merged.length, failed: errors.length, errors })
}
