import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// 毎日1回、Vercel の定期実行(cron)から呼ばれ、データベースに軽くアクセスする。
// 目的: Supabase の無料プランは、一定期間アクセスがないと自動で一時停止するため、デモ環境が止まらないようにする。
export const dynamic = "force-dynamic"

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://alcetorurdocopxatego.supabase.co"
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_VbmRpikpm6xr_lUaqo_MgQ_9swmJ_1j"
  try {
    const sb = createClient(url, key, { auth: { persistSession: false } })
    const { error } = await sb.from("company_settings").select("id").limit(1)
    return NextResponse.json({ ok: !error, at: new Date().toISOString() })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
