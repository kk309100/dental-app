import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"

const SUPABASE_URL = "https://alcetorurdocopxatego.supabase.co"

export async function POST(request: NextRequest) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    return NextResponse.json({ error: "サーバー設定エラー（環境変数未設定）" }, { status: 500 })
  }

  const authHeader = request.headers.get("Authorization") ?? ""
  const token = authHeader.replace("Bearer ", "").trim()
  if (!token) return NextResponse.json({ error: "認証エラー（トークンなし）" }, { status: 401 })

  // service role で JWT を検証し、管理者かどうか確認
  const adminClient = createClient(SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: { user }, error: authError } = await adminClient.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ error: "認証エラー（無効なトークン）" }, { status: 401 })
  }

  const { data: profile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 })
  }

  // リクエスト本文
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 })
  }

  const { userId, newPassword } = body
  if (!userId || !newPassword) {
    return NextResponse.json({ error: "userId と newPassword は必須です" }, { status: 400 })
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ error: "パスワードは6文字以上にしてください" }, { status: 400 })
  }

  // パスワード変更
  const { error: pwError } = await adminClient.auth.admin.updateUserById(userId, {
    password: newPassword,
  })
  if (pwError) {
    return NextResponse.json({ error: pwError.message }, { status: 400 })
  }

  // login_code を同じ値に更新
  await adminClient
    .from("profiles")
    .update({ login_code: newPassword.trim() })
    .eq("id", userId)

  return NextResponse.json({ success: true })
}
