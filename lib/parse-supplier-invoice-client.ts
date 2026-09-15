// 仕入先請求書PDFの解析クライアントヘルパー
//
// 背景: /api/parse-supplier-invoice は Claude Vision で1リクエストの中で
// PDF全ページ・全明細を読み取るが、Vercel のサーバーレス関数には実行時間の
// 上限があり（実測: このプロジェクトでは約300秒で504。コード側の
// maxDuration をそれ以上に設定しても、実際のプラン上限には勝てない）、
// ページ数・明細数の多い月次請求書だとタイムアウトする。
//
// 対策: PDFを数ページ単位に分割し、複数回に分けてAPIへ送って結果を結合する。
// 1チャンクあたりの処理時間が確実にタイムアウト内に収まるようにする。

import { PDFDocument } from "pdf-lib"

export type ParsedInvoiceItem = {
  delivery_date?: string
  delivery_number?: string
  supplier_product_code?: string
  jan_code?: string
  product_name: string
  manufacturer?: string
  pack_size?: string
  quantity: number
  unit_price: number
  amount: number
  tax_rate?: number
}

export type ParsedInvoice = {
  supplier_name?: string
  invoice_number?: string
  invoice_date?: string
  period_start?: string
  period_end?: string
  subtotal?: number
  tax?: number
  total?: number
  items: ParsedInvoiceItem[]
}

export type ParseProgress = {
  chunkIndex: number   // 1始まり
  chunkCount: number
  pageRange: string    // "1-4" 等
}

export type ParseResult = {
  data: ParsedInvoice
  warnings: string[]   // 一部チャンクの読み取りに失敗した場合の警告（成功分は返す）
}

// 1チャンクあたりのページ数。
// 実測で13ページ/168明細のPDFが約300秒（タイムアウト境界）だったため、
// 十分な余裕を持たせて4ページ/チャンクを既定値にする。
const PAGES_PER_CHUNK = 4
// この件数以下ならチャンク分割せず1回で送る（小さいPDFを無駄に分割しない）
const SPLIT_THRESHOLD = 6

function bufferToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

async function callParseApi(pdfBase64: string): Promise<ParsedInvoice> {
  const r = await fetch("/api/parse-supplier-invoice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pdfBase64 }),
  })
  const body = await r.json().catch(() => null)
  if (!r.ok || !body) {
    if (r.status === 504) throw new Error("読み取りに時間がかかりすぎてタイムアウトしました（504）")
    throw new Error(body?.error || `HTTP ${r.status}`)
  }
  return body.data as ParsedInvoice
}

// 空でないフィールドだけをマージ先に上書きする（後のチャンクの値を優先）
// → 合計金額などの集計は請求書の末尾ページに載ることが多いため、
//   最後のチャンクの値が結果的に優先される
function mergeHeader(target: ParsedInvoice, src: ParsedInvoice) {
  const keys: (keyof ParsedInvoice)[] = [
    "supplier_name", "invoice_number", "invoice_date",
    "period_start", "period_end", "subtotal", "tax", "total",
  ]
  for (const k of keys) {
    const v = src[k]
    if (v !== undefined && v !== null && v !== "") (target as any)[k] = v
  }
}

export async function parseSupplierInvoicePdf(
  file: File,
  onProgress?: (p: ParseProgress) => void,
): Promise<ParseResult> {
  const buf = await file.arrayBuffer()

  const doc = await PDFDocument.load(buf, { ignoreEncryption: true })
  const pageCount = doc.getPageCount()

  // 小さいPDFはそのまま1回で送る
  if (pageCount <= SPLIT_THRESHOLD) {
    onProgress?.({ chunkIndex: 1, chunkCount: 1, pageRange: `1-${pageCount}` })
    const data = await callParseApi(bufferToBase64(buf))
    return { data, warnings: [] }
  }

  // ページ範囲ごとに分割
  const ranges: number[][] = []
  for (let start = 0; start < pageCount; start += PAGES_PER_CHUNK) {
    const end = Math.min(start + PAGES_PER_CHUNK, pageCount)
    ranges.push(Array.from({ length: end - start }, (_, i) => start + i))
  }

  const merged: ParsedInvoice = { items: [] }
  const warnings: string[] = []

  for (let i = 0; i < ranges.length; i++) {
    const indices = ranges[i]
    const pageRange = `${indices[0] + 1}-${indices[indices.length - 1] + 1}`
    onProgress?.({ chunkIndex: i + 1, chunkCount: ranges.length, pageRange })

    try {
      const chunkDoc = await PDFDocument.create()
      const copied = await chunkDoc.copyPages(doc, indices)
      copied.forEach(p => chunkDoc.addPage(p))
      const chunkBytes = await chunkDoc.save()

      const chunkData = await callParseApi(bufferToBase64(chunkBytes))
      merged.items.push(...(chunkData.items || []))
      mergeHeader(merged, chunkData)
    } catch (e) {
      warnings.push(`ページ${pageRange}: ${(e as Error).message}`)
    }
  }

  if (merged.items.length === 0 && warnings.length > 0) {
    throw new Error("すべてのページで読み取りに失敗しました:\n" + warnings.join("\n"))
  }

  return { data: merged, warnings }
}
