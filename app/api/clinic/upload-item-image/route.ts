import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"

const SUPABASE_URL         = "https://alcetorurdocopxatego.supabase.co"
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const MAX_BYTES = 8 * 1024 * 1024 // 8 MB

export async function POST(req: NextRequest) {
  if (!SUPABASE_SERVICE_KEY) {
    return NextResponse.json({ error: "サーバー設定エラー" }, { status: 500 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: "フォームデータの解析に失敗しました" }, { status: 400 })
  }

  const file   = formData.get("file") as File | null
  const itemId = formData.get("itemId") as string | null

  if (!file || !itemId) {
    return NextResponse.json({ error: "file と itemId が必要です" }, { status: 400 })
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `ファイルサイズが大きすぎます（最大8MB）` }, { status: 400 })
  }

  const bytes  = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  const path   = `clinic-items/${itemId}.jpg`

  // バケット確認・作成
  const { data: buckets } = await supabaseAdmin.storage.listBuckets()
  const bucketExists = (buckets ?? []).some((b: { name: string }) => b.name === "clinic-item-images")
  if (!bucketExists) {
    const { error: createErr } = await supabaseAdmin.storage.createBucket("clinic-item-images", { public: true })
    if (createErr) {
      return NextResponse.json({ error: `バケット作成失敗: ${createErr.message}` }, { status: 500 })
    }
  }

  // アップロード
  const { error: upErr } = await supabaseAdmin.storage
    .from("clinic-item-images")
    .upload(path, buffer, { upsert: true, contentType: "image/jpeg" })

  if (upErr) {
    return NextResponse.json({ error: `アップロード失敗: ${upErr.message}` }, { status: 500 })
  }

  const { data: { publicUrl } } = supabaseAdmin.storage
    .from("clinic-item-images")
    .getPublicUrl(path)

  // clinic_inventory_items に URL を保存
  const { error: updateErr } = await supabaseAdmin
    .from("clinic_inventory_items")
    .update({ item_image_url: publicUrl })
    .eq("id", itemId)

  if (updateErr) {
    return NextResponse.json({ error: `DB更新失敗: ${updateErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ publicUrl })
}
