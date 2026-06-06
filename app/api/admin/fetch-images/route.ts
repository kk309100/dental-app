import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"

const SUPABASE_URL = "https://alcetorurdocopxatego.supabase.co"
const RAKUTEN_URL  = "https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706"
const BATCH_SIZE   = 25 // 25件 × 1秒 = 約25秒/バッチ

async function fetchRakutenImage(keyword: string, appId: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      format: "json",
      keyword,
      applicationId: appId,
      hits: "1",
      imageFlag: "1",
    })
    const res = await fetch(`${RAKUTEN_URL}?${params}`, {
      headers: { "User-Agent": "DentHub/1.0" },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const json = await res.json()
    const item = json?.Items?.[0]?.Item
    const url = item?.mediumImageUrls?.[0]?.imageUrl || item?.smallImageUrls?.[0]?.imageUrl
    return url ?? null
  } catch {
    return null
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function POST(request: NextRequest) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const appId      = process.env.RAKUTEN_APP_ID
  if (!serviceKey || !appId) {
    return NextResponse.json({ error: "環境変数が未設定です" }, { status: 500 })
  }

  // 管理者確認
  const authHeader = request.headers.get("Authorization") ?? ""
  const token = authHeader.replace("Bearer ", "").trim()
  if (!token) return NextResponse.json({ error: "認証エラー" }, { status: 401 })

  const adminClient = createClient(SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user }, error: authError } = await adminClient.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: "認証エラー" }, { status: 401 })

  const { data: profile } = await adminClient.from("profiles").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin") return NextResponse.json({ error: "権限がありません" }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const offset = Number(body.offset ?? 0)

  // 画像未設定の商品を取得
  const { data: products, error: fetchError } = await adminClient
    .from("products")
    .select("id, name")
    .is("image_url", null)
    .not("name", "is", null)
    .range(offset, offset + BATCH_SIZE - 1)

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  if (!products || products.length === 0) {
    const { count } = await adminClient.from("products").select("*", { count: "exact", head: true }).not("image_url", "is", null)
    return NextResponse.json({ done: true, processed: 0, withImage: count ?? 0 })
  }

  // 残件数カウント
  const { count: remaining } = await adminClient
    .from("products")
    .select("*", { count: "exact", head: true })
    .is("image_url", null)
    .not("name", "is", null)

  let processed = 0
  let found = 0

  for (const product of products) {
    const imageUrl = await fetchRakutenImage(product.name, appId)
    if (imageUrl) {
      await adminClient.from("products").update({ image_url: imageUrl }).eq("id", product.id)
      found++
    } else {
      // 見つからなかった場合も空文字でマーク（再スキャンしない）
      await adminClient.from("products").update({ image_url: "" }).eq("id", product.id)
    }
    processed++
    await sleep(1100) // レート制限: 1秒/リクエスト
  }

  const { count: withImage } = await adminClient
    .from("products")
    .select("*", { count: "exact", head: true })
    .not("image_url", "is", null)

  return NextResponse.json({
    done: (remaining ?? 0) - processed <= 0,
    processed,
    found,
    remaining: Math.max(0, (remaining ?? 0) - processed),
    withImage: withImage ?? 0,
  })
}
