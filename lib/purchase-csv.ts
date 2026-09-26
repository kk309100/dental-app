// 外部の仕入管理システムが出す「仕入日報」CSVの共通パーサ
// csv-import（stock_receipts への取り込み）と quick-check（請求書との即時照合）の両方で使う
//
// 想定フォーマット（列名で判定。列の並び順・余計な列の有無は問わない）:
//   仕入先コード,仕入先名,伝票日付,伝票№,仕入区分,商品コード,商品名,メーカー,単価,数量,金額,
//   高度医療項目,摘要,経費分類,商品分類,クラス,担当者名
//
// 仕入区分が「仕入」以外の行（値引き・入金などの調整行）は自動でスキップする

import { parseCSV } from "@/lib/csv"

export type PurchaseCsvRow = {
  lineNo: number
  voucherDate: string        // YYYY-MM-DD
  voucherNo: string
  kubun: string              // 仕入区分
  productCode: string
  productName: string
  manufacturer: string
  unitPrice: number | null
  quantity: number | null
  amount: number | null
  memo: string               // 摘要
  supplierCode: string       // 行ごとの仕入先コード（仕入先コード / 取引先コード列）
  supplierName: string       // 行ごとの仕入先名（仕入先名 / 取引先名列）
}

export type PurchaseCsvResult = {
  rows: PurchaseCsvRow[]
  skippedCount: number       // 値引き・入金など「仕入」以外でスキップした行数
  supplierCode: string       // 先頭行から推定した仕入先コード
  supplierName: string       // 先頭行から推定した仕入先名
  error?: string             // 列不足など、解析自体が失敗した場合のメッセージ
}

const REQUIRED_HEADERS = ["商品名", "数量", "単価", "金額"]

// 院内システムのCSVはShift-JIS(CP932)で書き出されることが多い。
// UTF-8として厳密デコードして失敗したらShift-JISとして読み直す。
export async function readTextSmart(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf)
  } catch {
    try { return new TextDecoder("shift_jis").decode(buf) }
    catch { return new TextDecoder("utf-8").decode(buf) }
  }
}

function toNum(s: string | undefined): number | null {
  if (s === undefined || s === null) return null
  const t = String(s).replace(/[¥,\s]/g, "")
  if (t === "") return null
  const n = Number(t)
  return isNaN(n) ? null : n
}

function toISODate(s: string | undefined): string {
  const t = String(s || "").trim()
  // 「2026/9/21」のような月日が1桁の表記も「2026-09-21」に揃える（そのままでは日時として不正になる）
  const m = t.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/)
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : t.replace(/\//g, "-")
}

export function parsePurchaseCsv(text: string): PurchaseCsvResult {
  const empty: PurchaseCsvResult = { rows: [], skippedCount: 0, supplierCode: "", supplierName: "" }
  const csvRows = parseCSV(text)
  if (csvRows.length === 0) return { ...empty, error: "CSVから行を読み取れませんでした。" }

  const headers = Object.keys(csvRows[0])
  const missing = REQUIRED_HEADERS.filter(h => !headers.includes(h))
  if (missing.length > 0) {
    return {
      ...empty,
      error: `必要な列が見つかりません: ${missing.join("、")}\n（見つかった列: ${headers.filter(Boolean).join("、")}）`,
    }
  }

  let skipped = 0
  const rows: PurchaseCsvRow[] = []
  csvRows.forEach((row, i) => {
    // 仕入日報は「仕入区分」、商品元帳は「区分」（売上・仕入・値引が混在）。どちらでも「仕入」以外は除外する
    const kubun = (row["仕入区分"] || row["区分"] || "").trim()
    const productName = (row["商品名"] || "").trim()
    if (!productName) return
    if (kubun && kubun !== "仕入") { skipped++; return }

    rows.push({
      lineNo: i + 2, // ヘッダ行を1行目とした実際のCSV行番号
      voucherDate: toISODate(row["伝票日付"]),
      voucherNo: (row["伝票№"] || row["伝票No"] || row["伝票番号"] || "").trim(),
      kubun,
      productCode: (row["商品コード"] || "").trim(),
      productName,
      manufacturer: (row["メーカー"] || "").trim(),
      unitPrice: toNum(row["単価"]),
      quantity: toNum(row["数量"]),
      amount: toNum(row["金額"]),
      memo: (row["摘要"] || "").trim(),
      supplierCode: (row["仕入先コード"] || row["取引先コード"] || "").trim(),
      supplierName: (row["仕入先名"] || row["取引先名"] || "").trim(),
    })
  })

  if (rows.length === 0) {
    return { ...empty, skippedCount: skipped, error: "「仕入」区分の行が見つかりませんでした（すべて値引き・入金などの調整行でした）。" }
  }

  return {
    rows,
    skippedCount: skipped,
    supplierCode: (csvRows[0]["仕入先コード"] || csvRows[0]["取引先コード"] || "").trim(),
    supplierName: (csvRows[0]["仕入先名"] || csvRows[0]["取引先名"] || "").trim(),
  }
}
