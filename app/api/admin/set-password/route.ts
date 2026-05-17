import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"

const SUPABASE_URL = "https://alcetorurdocopxatego.supabase.co"
const ANON_KEY     = "sb_publishable_VbmRpikpm6xr_lUaqo_MgQ_9swmJ_1j"

export async function POST(request: NextRequest) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    return NextResponse.json({ error: "サーバー設定エラー" }, { status: 500 })
  }

  // 呼び出し元が管理者か確認
  const authHeader = request.headers.get("Authorization") ?? ""
  const token = authHeader.replace("Bearer ", "")
  if (!token) return NextResponse.json({ error: "認証エラー" }, { status: 401 })

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: "認証エラー" }, { status: 401 })

  const { data: profile } = await userClient.from("profiles").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin") return NextResponse.json({ error: "権限がありません" }, { status: 403 })

  // リクエスト本文を取得
  const { userId, newPassword, loginCode } = await request.json()
  if (!userId || !newPassword) {
    return NextResponse.json({ error: "userId と newPassword は必須です" }, { status: 400 })
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ error: "パスワードは6文字以上にしてください" }, { status: 400 })
  }

  // 管理者クライアントでパスワード変更
  const adminClient = createClient(SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { error: pwError } = await adminClient.auth.admin.updateUserById(userId, { password: newPassword })
  if (pwError) return NextResponse.json({ error: pwError.message }, { status: 400 })

  // login_code も同じ値に更新（パスワードのみログインの逆引きキー）
  const code = (loginCode ?? newPassword).trim()
  await adminClient.from("profiles").update({ login_code: code }).eq("id", userId)

  return NextResponse.json({ success: true })
}
