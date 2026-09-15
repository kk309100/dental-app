// 月次まとめ請求書PDFを Claude Vision API で構造化データに変換
// /api/parse-receiving は「都度の納品書」用、こちらは「月次まとめ請求書」用
//
// 月次請求書は:
//   - ページが多い (10〜100ページ程度)
//   - 明細が多い (50〜500行程度)
//   - 各明細に納品日・伝票No・商品コード・数量・金額が並ぶ
//   - 集計表（カテゴリ別小計）も付いていることが多い
//
// 実測: 13ページ/168明細のPDFで処理に約300秒かかり、Vercelのプラン上限
// （実測で約300秒。コード側の maxDuration をそれ以上に設定しても勝てない）
// で504になることを確認済み。そのため呼び出し側（lib/parse-supplier-invoice-client.ts）
// でPDFを数ページ単位に分割してこのAPIを複数回呼ぶ方式に変更した。
// このAPI自体は「渡された分だけ」を読み取ればよいので変更していない。

import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const maxDuration = 280  // Vercel側の実際の上限（約300秒）に収まるよう設定

type ParsedItem = {
  delivery_date?: string         // YYYY-MM-DD（納品日）
  delivery_number?: string       // 仕入先側の伝票/納品書No
  supplier_product_code?: string // 仕入先側の商品コード
  jan_code?: string              // JAN（13桁）
  product_name: string           // 商品名
  manufacturer?: string          // メーカー
  pack_size?: string             // 入数（"20枚入"等）
  quantity: number
  unit_price: number
  amount: number
  tax_rate?: number              // 10 or 8
}

type ParsedSupplierInvoice = {
  supplier_name?: string
  invoice_number?: string
  invoice_date?: string
  period_start?: string
  period_end?: string
  subtotal?: number
  tax?: number
  total?: number
  items: ParsedItem[]
}

const SYSTEM_PROMPT = `あなたは歯科材料の月次まとめ請求書を構造化データに変換する専門家です。
PDFから情報を抽出し、必ず JSON形式 で返してください。

抽出ルール:
- supplier_name: 仕入先会社名（株式会社含む全名称）
- invoice_number: 請求書番号 / 伝票番号
- invoice_date: 請求書発行日 (YYYY-MM-DD 形式)
- period_start: 請求対象期間の開始日 (YYYY-MM-DD)
- period_end: 請求対象期間の終了日 (YYYY-MM-DD、締め日)
- subtotal: 小計（税抜）
- tax: 消費税合計
- total: 請求合計（税込）
- items: 明細行の配列。**全ページの全明細**を漏れなく抽出。各項目:
  - delivery_date: 納品日 (YYYY-MM-DD) - 月次請求書では行ごとに違う日付が並ぶことが多い
  - delivery_number: 伝票No / 納品書No
  - supplier_product_code: 商品コード（数字混合）あれば
  - jan_code: JAN（13桁）あれば
  - product_name: 商品名（メーカー名 + 商品名 + 規格、複数行は1行に結合）
  - manufacturer: メーカー名（商品名から分離できれば）
  - pack_size: 入数表記（"20枚入"等）
  - quantity: 数量
  - unit_price: 単価（税抜）
  - amount: 金額（税抜小計）
  - tax_rate: 10 または 8（軽減税率対象なら8、それ以外10）

重要:
- 入金行・値引行・カード決済等の調整行はスキップ（quantity が無い・金額がマイナスのもの）
- 集計表（材料費/消耗品/薬品 等のカテゴリ別合計）は items に含めない
- ページごとに同じ明細を重複して入れない
- 数量×単価 = 金額 となる "売上行" のみ items に含める

出力は JSON のみ。説明文・マークダウン記号 (\`\`\`) は不要。`

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY 未設定" }, { status: 500 })
  }

  try {
    const { pdfBase64 } = await req.json()
    if (!pdfBase64) {
      return NextResponse.json({ error: "pdfBase64 が空" }, { status: 400 })
    }

    // PDF サイズ確認 (Anthropic API は 32MB まで)
    const sizeBytes = Math.ceil(pdfBase64.length * 0.75)  // base64 → 実サイズ概算
    if (sizeBytes > 30 * 1024 * 1024) {
      return NextResponse.json(
        { error: `PDFサイズが大きすぎます: ${(sizeBytes / 1024 / 1024).toFixed(1)}MB (上限30MB)。ページを分割してください。` },
        { status: 413 }
      )
    }

    // 明細が多い月次請求書はAIの生成そのものに数分かかることがあり、
    // 非ストリーミングだと「最初の1バイトが来るまで」の既定タイムアウト
    // （NodeのfetchはHeadersTimeoutErrorで5分前後）に引っかかって落ちる。
    // ストリーミングにすると生成の合間も細かくデータが届くため、この種の
    // タイムアウトを回避できる（Anthropicも長時間かかる処理にはstream推奨）。
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",  // 月次は精度重視で sonnet
        max_tokens: 64000,            // 多明細対応（枚数の多い月次請求書で出力が切れないよう引き上げ）
        system: SYSTEM_PROMPT,
        stream: true,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
              },
              {
                type: "text",
                text: "この月次まとめ請求書から、全ページの全明細を漏れなく抽出してJSONで返してください。",
              },
            ],
          },
        ],
      }),
    })

    if (!r.ok) {
      const errText = await r.text()
      console.error("Claude API error:", errText)
      return NextResponse.json(
        { error: `Claude API: ${r.status}`, detail: errText.slice(0, 500) },
        { status: 502 }
      )
    }
    if (!r.body) {
      return NextResponse.json({ error: "ストリーミング応答の取得に失敗しました" }, { status: 502 })
    }

    // SSEストリームを読み、content_block_delta の text_delta を連結する
    let text = ""
    let stopReason: string | null = null
    let sawError: string | null = null
    let usage: { input_tokens?: number; output_tokens?: number } = {}
    {
      const reader = r.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() || ""
        for (const line of lines) {
          if (!line.startsWith("data:")) continue
          const jsonStr = line.slice(5).trim()
          if (!jsonStr) continue
          let evt: any
          try { evt = JSON.parse(jsonStr) } catch { continue }
          if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
            text += evt.delta.text
          } else if (evt.type === "message_start" && evt.message?.usage) {
            usage = { ...usage, ...evt.message.usage }
          } else if (evt.type === "message_delta") {
            if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason
            if (evt.usage) usage = { ...usage, ...evt.usage }
          } else if (evt.type === "error") {
            sawError = evt.error?.message || "unknown stream error"
          }
        }
      }
    }
    if (sawError) {
      return NextResponse.json({ error: `Claude API (stream): ${sawError}` }, { status: 502 })
    }

    let jsonText = text.trim()
    const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fence) jsonText = fence[1].trim()
    else jsonText = jsonText.replace(/^```(?:json)?\s*/, "")  // 出力が途中で切れて閉じ```が無い場合

    let parsed: ParsedSupplierInvoice
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      const truncated = stopReason === "max_tokens"
      return NextResponse.json(
        {
          error: truncated
            ? "PDFの明細が多く、AIの回答が最後まで出力される前に打ち切られました（max_tokens到達）。ページを分割して読み込んでください。"
            : "JSON 解析失敗",
          raw: text.slice(0, 1000),
        },
        { status: 502 }
      )
    }

    // バリデーション
    if (!Array.isArray(parsed.items)) parsed.items = []

    return NextResponse.json({
      ok: true,
      data: parsed,
      usage,
    })
  } catch (e) {
    console.error("parse-supplier-invoice error:", e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
