import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"

const SUPABASE_URL         = "https://alcetorurdocopxatego.supabase.co"
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""

// サービスロールクライアント（RLS をバイパス）
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const MAX_BYTES = 8 * 1024 * 1024 // 8 MB

export async function POST(req: NextRequest) {
  if (!SUPABASE_SERVICE_KEY) {
    return NextResponse.json({ error: "サーバー設定エラー（SERVICE_ROLE_KEY未設定）" }, { status: 500 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: "フォームデータの解析に失敗しました" }, { status: 400 })
  }

  const file      = formData.get("file") as File | null
  const productId = formData.get("productId") as string | null

  if (!file || !productId) {
    return NextResponse.json({ error: "file と productId が必要です" }, { status: 400 })
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `ファイルサイズが大きすぎます（最大 ${MAX_BYTES / 1024 / 1024}MB）` }, { status: 400 })
  }

  const bytes  = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  const path   = `products/${productId}.jpg`

  // バケットが存在しない場合は作成する
  const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets()
  if (listErr) {
    console.error("listBuckets error:", listErr)
    return NextResponse.json({ error: `バケット一覧取得失敗: ${listErr.message}（SERVICE_ROLE_KEYを確認してください）` }, { status: 500 })
  }
  const bucketExists = (buckets ?? []).some((b: { name: string }) => b.name === "product-images")
  if (!bucketExists) {
    const { error: createErr } = await supabaseAdmin.storage.createBucket("product-images", { public: true })
    if (createErr) {
      console.error("createBucket error:", createErr)
      return NextResponse.json({ error: `バケット作成失敗: ${createErr.message}` }, { status: 500 })
    }
  }

  const { error: upErr } = await supabaseAdmin.storage
    .from("product-images")
    .upload(path, buffer, { upsert: true, contentType: "image/jpeg" })

  if (upErr) {
    console.error("Storage upload error:", upErr)
    return NextResponse.json({ error: `アップロード失敗: ${upErr.message}` }, { status: 500 })
  }

  const { data: { publicUrl } } = supabaseAdmin.storage
    .from("product-images")
    .getPublicUrl(path)

  return NextResponse.json({ publicUrl })
}
