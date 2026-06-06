// 仕入納品書PDFをClaude Vision APIに送って明細を抽出する
// サーバー側のみ動作（API キーは ANTHROPIC_API_KEY env から取得）

import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const maxDuration = 60

type ParsedItem = {
  supplier_jan?: string
  supplier_product_code?: string
  supplier_product_name: string
  pack_size?: string  // 例: "20枚入" 等の人間表記
  quantity: number
  unit_price: number
  amount?: number
}

type ParsedInvoice = {
  supplier_name?: string
  invoice_number?: string
  invoice_date?: string  // YYYY-MM-DD
  subtotal?: number
  tax?: number
  total?: number
  items: ParsedItem[]
}

const SYSTEM_PROMPT = `あなたは歯科材料の仕入納品書を構造化データに変換する専門家です。
画像/PDFから情報を抽出し、必ず JSON形式 で返してください。

抽出ルール:
- supplier_name: 仕入先会社名（株式会社含む全名称）
- invoice_number: 伝票番号 / No
- invoice_date: 発行日 (YYYY-MM-DD 形式)
- subtotal: 小計（税抜）
- tax: 消費税額
- total: 合計（税込、無ければ subtotal+tax）
- items: 明細行の配列。各項目:
  - supplier_jan: JAN コード（13桁）あれば
  - supplier_product_code: 商品コード（数字混合）あれば
  - supplier_product_name: 商品名（メーカー名 + 商品名 + 規格、複数行は1行に結合）
  - pack_size: 「20枚入」「6個入」「100g」等の入数・容量表記。商品名から抽出
  - quantity: 数量（個数）
  - unit_price: 単価（税抜）
  - amount: 金額（無ければ quantity * unit_price で計算）

出力は JSON のみ。説明文・マークダウン記号 (\`\`\`) は不要。`

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY 未設定" }, { status: 500 })
  }

  try {
    const body = await req.json()
    const { pdfBase64, imageBase64, mediaType } = body

    if (!pdfBase64 && !imageBase64) {
      return NextResponse.json({ error: "pdfBase64 または imageBase64 が必要です" }, { status: 400 })
    }

    // PDF は document ブロック、画像は image ブロックで送信
    const contentBlock = pdfBase64
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } }
      : { type: "image",    source: { type: "base64", media_type: mediaType || "image/jpeg", data: imageBase64 } }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              contentBlock,
              {
                type: "text",
                text: "この仕入納品書から明細を抽出してJSONで返してください。",
              },
            ],
          },
        ],
      }),
    })

    if (!r.ok) {
      const errText = await r.text()
      console.error("Claude API error:", r.status, errText)
      // エラー詳細をフロントに返してデバッグしやすくする
      let detail = errText.slice(0, 800)
      try { detail = JSON.stringify(JSON.parse(errText), null, 2).slice(0, 800) } catch {}
      return NextResponse.json({ error: `Claude API エラー (${r.status})`, detail }, { status: 502 })
    }

    const result = await r.json()
    const text = result.content?.[0]?.text || ""

    // JSON 部分を抽出（マークダウンに包まれている場合の保険）
    let jsonText = text.trim()
    const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fence) jsonText = fence[1].trim()

    let parsed: ParsedInvoice
    try {
      parsed = JSON.parse(jsonText)
    } catch (e) {
      return NextResponse.json({ error: "JSON 解析失敗", raw: text.slice(0, 1000) }, { status: 502 })
    }

    return NextResponse.json({
      ok: true,
      data: parsed,
      usage: result.usage,
    })
  } catch (e) {
    console.error("parse-receiving error:", e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
