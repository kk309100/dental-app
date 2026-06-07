import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"

const SUPABASE_URL = "https://alcetorurdocopxatego.supabase.co"

export async function POST(request: NextRequest) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    return NextResponse.json({ error: "サーバー設定エラー（環境変数未設定）" }, { status: 500 })
  }

  // 呼び出し元が管理者かどうかを確認
  const authHeader = request.headers.get("Authorization") ?? ""
  const token = authHeader.replace("Bearer ", "").trim()
  if (!token) return NextResponse.json({ error: "認証エラー（トークンなし）" }, { status: 401 })

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

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 })
  }

  const { clinicId, loginCode } = body

  if (!clinicId) {
    return NextResponse.json({ error: "clinicId は必須です" }, { status: 400 })
  }
  if (!loginCode || loginCode.trim().length < 6) {
    return NextResponse.json({ error: "パスワードは6文字以上にしてください" }, { status: 400 })
  }

  const code = loginCode.trim()

  // この医院にすでに auth ユーザーが紐付いているか確認
  const { data: existingProfile } = await adminClient
    .from("profiles")
    .select("id")
    .eq("clinic_id", clinicId)
    .maybeSingle()

  if (existingProfile) {
    // すでに存在する場合はパスワードだけ更新
    const { error: pwError } = await adminClient.auth.admin.updateUserById(existingProfile.id, {
      password: code,
    })
    if (pwError) return NextResponse.json({ error: pwError.message }, { status: 400 })

    await adminClient
      .from("profiles")
      .update({ login_code: code })
      .eq("id", existingProfile.id)

    return NextResponse.json({ success: true, updated: true })
  }

  // 新規 auth ユーザーを作成（メールは内部用ダミー）
  const fakeEmail = `clinic_${randomUUID()}@internal.local`
  const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
    email: fakeEmail,
    password: code,
    email_confirm: true,
  })
  if (createError || !newUser.user) {
    return NextResponse.json({ error: createError?.message ?? "ユーザー作成失敗" }, { status: 400 })
  }

  // profiles レコードを作成
  const { error: profileError } = await adminClient.from("profiles").insert({
    id: newUser.user.id,
    role: "clinic",
    clinic_id: clinicId,
    login_code: code,
  })
  if (profileError) {
    // 失敗したら auth ユーザーを削除してロールバック
    await adminClient.auth.admin.deleteUser(newUser.user.id)
    return NextResponse.json({ error: profileError.message }, { status: 400 })
  }

  return NextResponse.json({ success: true, userId: newUser.user.id })
}
