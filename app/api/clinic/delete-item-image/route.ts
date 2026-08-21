import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"

const SUPABASE_URL         = "https://alcetorurdocopxatego.supabase.co"
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

export async function POST(req: NextRequest) {
  if (!SUPABASE_SERVICE_KEY) {
    return NextResponse.json({ error: "サーバー設定エラー" }, { status: 500 })
  }

  const { itemId } = await req.json()
  if (!itemId) {
    return NextResponse.json({ error: "itemId が必要です" }, { status: 400 })
  }

  const path = `clinic-items/${itemId}.jpg`

  // Storageから削除（存在しなくてもエラーにしない）
  await supabaseAdmin.storage.from("clinic-item-images").remove([path])

  // DBのURLをnullに
  const { error } = await supabaseAdmin
    .from("clinic_inventory_items")
    .update({ item_image_url: null })
    .eq("id", itemId)

  if (error) {
    return NextResponse.json({ error: `DB更新失敗: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
