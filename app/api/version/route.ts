import { NextResponse } from "next/server"

// デプロイのたびに変わる値を返す（Vercelがビルド時に自動で設定するコミットSHA）。
// ブラウザに開きっぱなしのタブが、新しいデプロイが出たことに気づくための目印として使う。
export async function GET() {
  const version = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "dev"
  return NextResponse.json({ version }, { headers: { "Cache-Control": "no-store" } })
}
