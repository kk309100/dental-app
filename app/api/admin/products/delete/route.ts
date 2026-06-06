import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"

const SUPABASE_URL = "https://alcetorurdocopxatego.supabase.co"
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""

export async function POST(request: NextRequest) {
  let body: { ids?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 })
  }

  const ids = body.ids
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids が必要です" }, { status: 400 })
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const results: { id: string; ok: boolean; error?: string }[] = []

  for (const id of ids) {
    const { error } = await admin.from("products").delete().eq("id", id)
    if (error) {
      results.push({ id, ok: false, error: error.message })
    } else {
      results.push({ id, ok: true })
    }
  }

  const failed = results.filter(r => !r.ok)
  return NextResponse.json({
    deleted: results.filter(r => r.ok).length,
    failed: failed.length,
    errors: failed.map(r => `${r.id}: ${r.error}`),
  })
}
