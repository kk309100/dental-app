import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"

// 重複商品の統合: removeIds の商品を keepId に寄せる。
// 注文・発注・見積・入荷・在庫履歴などの product_id を keepId に付け替え、在庫を合算してから removeIds を削除する。
// 管理者のみ。

const SUPABASE_URL = "https://alcetorurdocopxatego.supabase.co"

// 付け替えるだけでよいテーブル（重複して困る一意制約が無い履歴系）
const REPOINT_TABLES = [
  "order_items", "purchase_order_items", "quote_items", "stock_receipts",
  "stock_movements", "clinic_inventory_items",
]
// 一意制約がありうるテーブル: 付け替えを試み、keep 側に同じ行が既にあって失敗したら統合元の行は捨てる
const MERGE_ROWS_TABLES = ["clinic_prices", "supplier_prices", "favorites", "supplier_product_aliases", "stocktake_items"]

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
      // 1) 履歴系は付け替え
      for (const t of REPOINT_TABLES) {
        const { error } = await admin.from(t).update({ product_id: keepId }).eq("product_id", rid)
        if (error) throw new Error(`${t}: ${error.message}`)
      }
      // 2) 一意制約がありうるテーブルは行ごとに付け替え、衝突したら統合元の行を捨てる
      for (const t of MERGE_ROWS_TABLES) {
        const { data: rows, error: se } = await admin.from(t).select("id").eq("product_id", rid)
        if (se) throw new Error(`${t}: ${se.message}`)
        for (const r of rows ?? []) {
          const { error } = await admin.from(t).update({ product_id: keepId }).eq("id", r.id)
          if (error) {
            const { error: de } = await admin.from(t).delete().eq("id", r.id)
            if (de) throw new Error(`${t}: ${de.message}`)
          }
        }
      }
      // 3) 在庫を合算し、残す側が空の項目だけ統合元の値で補う
      const patch: Record<string, unknown> = { stock: Number(keep.stock || 0) + Number(rem.stock || 0) }
      for (const k of ["manufacturer", "category", "cost", "price", "reorder_level", "location", "purchase_maker", "default_supplier_id", "image_url"]) {
        if ((keep[k] === null || keep[k] === undefined || keep[k] === "") && rem[k] !== null && rem[k] !== undefined && rem[k] !== "") patch[k] = rem[k]
      }
      const { error: ue } = await admin.from("products").update(patch).eq("id", keepId)
      if (ue) throw new Error(`products更新: ${ue.message}`)
      keep.stock = patch.stock
      Object.assign(keep, patch)
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
