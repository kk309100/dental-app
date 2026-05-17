// 仕入先請求書 ↔ 仕入入荷データ の自動マッチング
//
// マッチングルール（優先度順）:
//   1. supplier_product_aliases に登録された対応関係（学習済み）
//   2. JAN コード一致
//   3. supplier_product_code === products.product_code
//   4. supplier_product_code === products.barcode
//   5. 商品名の正規化一致（NFKC + 大小無視 + 空白除去）
//   6. 商品名の部分一致
//
// 数量・金額判定:
//   - matched: 数量 と 金額 が両方一致（誤差 ±1円許容）
//   - qty_mismatch: 数量だけズレ
//   - price_mismatch: 単価ズレ（金額もズレる）
//   - amount_mismatch: 金額のみズレ（端数など）
//   - no_product: 自社商品マスタに該当無し
//   - unmatched: stock_receipts に対応する入荷記録なし

import { supabase } from "@/lib/supabase"

export type SupplierInvoiceItem = {
  id: string
  supplier_invoice_id: string
  delivery_date: string | null
  delivery_number: string | null
  supplier_product_code: string | null
  jan_code: string | null
  product_name: string | null
  quantity: number
  unit_price: number
  amount: number
  matched_stock_receipt_id?: string | null
  matched_product_id?: string | null
  match_status?: string
  match_score?: number
  match_note?: string
}

export type StockReceipt = {
  id: string
  supplier_id: string | null
  product_id: string | null
  quantity: number
  unit_price: number | null
  created_at: string
  memo: string | null
  supplier_invoice_item_id?: string | null
}

export type Product = {
  id: string
  name: string
  product_code: string | null
  barcode: string | null
  manufacturer: string | null
}

export type Alias = {
  supplier_id: string
  supplier_product_code: string | null
  supplier_product_name: string | null
  product_id: string
}

// 検索キー正規化（NFKC + lower + 空白除去）
const norm = (s: string | null | undefined): string =>
  String(s || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "")

const PRICE_TOLERANCE = 1  // ±1円までは一致扱い（端数）

/**
 * 仕入先側商品コード/JAN/名前 から自社 products.id を引く
 */
export function findProductId(
  item: { supplier_product_code: string | null; jan_code: string | null; product_name: string | null },
  supplierId: string,
  products: Product[],
  aliases: Alias[]
): { product_id: string | null; score: number; reason: string } {
  // 1. alias で学習済み
  if (item.supplier_product_code) {
    const a = aliases.find(x => x.supplier_id === supplierId && norm(x.supplier_product_code) === norm(item.supplier_product_code))
    if (a) return { product_id: a.product_id, score: 1.0, reason: "alias-code" }
  }
  if (item.product_name) {
    const a = aliases.find(x => x.supplier_id === supplierId && norm(x.supplier_product_name) === norm(item.product_name))
    if (a) return { product_id: a.product_id, score: 0.95, reason: "alias-name" }
  }

  // 2. JAN
  if (item.jan_code) {
    const p = products.find(x => x.barcode && norm(x.barcode) === norm(item.jan_code))
    if (p) return { product_id: p.id, score: 0.95, reason: "jan" }
  }

  // 3. 商品コード
  if (item.supplier_product_code) {
    const p1 = products.find(x => x.product_code && norm(x.product_code) === norm(item.supplier_product_code))
    if (p1) return { product_id: p1.id, score: 0.9, reason: "product_code" }
    const p2 = products.find(x => x.barcode && norm(x.barcode) === norm(item.supplier_product_code))
    if (p2) return { product_id: p2.id, score: 0.85, reason: "product_code-as-barcode" }
  }

  // 4. 商品名 完全一致
  if (item.product_name) {
    const k = norm(item.product_name)
    const p = products.find(x => norm(x.name) === k)
    if (p) return { product_id: p.id, score: 0.8, reason: "name-exact" }

    // 5. 商品名 部分一致（仕入先側の長い名前に products.name が含まれる）
    const partial = products.find(x => x.name && k.includes(norm(x.name)) && norm(x.name).length >= 4)
    if (partial) return { product_id: partial.id, score: 0.5, reason: "name-partial" }
  }

  return { product_id: null, score: 0, reason: "no-match" }
}

/**
 * 商品IDが分かっている前提で、対応する stock_receipts を探す
 * - 同じ supplier_id
 * - 同じ product_id
 * - 期間内の created_at（period_start ± 数日）
 * - 数量が近い
 */
export function findStockReceipt(
  productId: string,
  supplierId: string,
  expectedQty: number,
  expectedDate: string | null,
  receipts: StockReceipt[]
): { receipt: StockReceipt | null; reason: string } {
  // 既に他にマッチ済みのレコードは除外
  const candidates = receipts.filter(r =>
    r.supplier_id === supplierId &&
    r.product_id === productId &&
    !r.supplier_invoice_item_id  // まだ請求書に紐づいてない
  )
  if (candidates.length === 0) return { receipt: null, reason: "no-receipt" }

  // 1. 期日 + 数量 完全一致
  if (expectedDate) {
    const exact = candidates.find(r =>
      r.created_at.slice(0, 10) === expectedDate &&
      Number(r.quantity) === expectedQty
    )
    if (exact) return { receipt: exact, reason: "date+qty" }
  }

  // 2. 数量一致（最近順）
  const qtyMatch = candidates
    .filter(r => Number(r.quantity) === expectedQty)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  if (qtyMatch) return { receipt: qtyMatch, reason: "qty" }

  // 3. 期日が近いもの（±7日）
  if (expectedDate) {
    const expDate = new Date(expectedDate).getTime()
    const within7 = candidates
      .map(r => ({ r, diff: Math.abs(new Date(r.created_at).getTime() - expDate) }))
      .filter(x => x.diff <= 7 * 24 * 60 * 60 * 1000)
      .sort((a, b) => a.diff - b.diff)[0]
    if (within7) return { receipt: within7.r, reason: "near-date" }
  }

  // 4. 商品ID一致だけ（最新）
  const latest = candidates.sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  return { receipt: latest, reason: "product-only" }
}

/**
 * 1明細について match_status 判定
 */
export function classifyMatch(
  item: SupplierInvoiceItem,
  productId: string | null,
  receipt: StockReceipt | null
): { status: string; note: string } {
  if (!productId) return { status: "no_product", note: "自社商品マスタに該当なし" }
  if (!receipt) return { status: "unmatched", note: "対応する入荷記録なし（請求書のみ）" }

  const qtyMatch = Number(receipt.quantity) === Number(item.quantity)
  const priceMatch = Math.abs(Number(receipt.unit_price || 0) - Number(item.unit_price)) <= PRICE_TOLERANCE
  const expectedAmount = Number(receipt.unit_price || 0) * Number(receipt.quantity)
  const amountMatch = Math.abs(expectedAmount - Number(item.amount)) <= PRICE_TOLERANCE

  if (qtyMatch && priceMatch && amountMatch) return { status: "matched", note: "" }
  if (!qtyMatch && !priceMatch) {
    return { status: "amount_mismatch", note: `数量 ${item.quantity}→${receipt.quantity} / 単価 ¥${item.unit_price}→¥${receipt.unit_price}` }
  }
  if (!qtyMatch) {
    return { status: "qty_mismatch", note: `数量ズレ ${item.quantity} 請求 / ${receipt.quantity} 入荷` }
  }
  if (!priceMatch || !amountMatch) {
    return { status: "price_mismatch", note: `単価ズレ ¥${item.unit_price} 請求 / ¥${receipt.unit_price} 入荷` }
  }
  return { status: "matched", note: "" }
}

/**
 * 月次請求書1枚分の自動マッチを実行
 *   1. items を全件取得
 *   2. supplier の products + aliases + 期間内 stock_receipts を取得
 *   3. 各 item について product_id 推定 → stock_receipt 推定 → 状態判定
 *   4. 結果を supplier_invoice_items に書き戻す
 */
export async function runAutoMatch(supplierInvoiceId: string): Promise<{
  total: number
  matched: number
  qty_mismatch: number
  price_mismatch: number
  amount_mismatch: number
  no_product: number
  unmatched: number
}> {
  // 請求書ヘッダ取得
  const { data: invHead } = await supabase.from("supplier_invoices")
    .select("supplier_id,period_start,period_end")
    .eq("id", supplierInvoiceId).single()
  if (!invHead) throw new Error("請求書が見つかりません")
  const supplierId = invHead.supplier_id

  // 明細取得
  const { data: items } = await supabase.from("supplier_invoice_items")
    .select("*")
    .eq("supplier_invoice_id", supplierInvoiceId)
    .limit(50000)
  const allItems = (items as SupplierInvoiceItem[]) || []

  // products
  const { data: prodData } = await supabase.from("products")
    .select("id,name,product_code,barcode,manufacturer")
    .limit(50000)
  const products = (prodData as Product[]) || []

  // aliases
  const { data: aliasData } = await supabase.from("supplier_product_aliases")
    .select("supplier_id,supplier_product_code,supplier_product_name,product_id")
    .eq("supplier_id", supplierId)
    .limit(50000)
  const aliases = (aliasData as Alias[]) || []

  // 期間内の stock_receipts
  let q = supabase.from("stock_receipts")
    .select("id,supplier_id,product_id,quantity,unit_price,created_at,memo,supplier_invoice_item_id")
    .eq("supplier_id", supplierId)
    .limit(50000)
  if (invHead.period_start) q = q.gte("created_at", invHead.period_start)
  if (invHead.period_end) q = q.lte("created_at", invHead.period_end + "T23:59:59")
  const { data: rcptData } = await q
  const receipts = (rcptData as StockReceipt[]) || []

  // マッチング
  const counts = { matched: 0, qty_mismatch: 0, price_mismatch: 0, amount_mismatch: 0, no_product: 0, unmatched: 0 }
  const updates: Array<{ id: string; matched_product_id: string | null; matched_stock_receipt_id: string | null; match_status: string; match_score: number; match_note: string }> = []
  const claimedReceiptIds = new Set<string>()

  for (const item of allItems) {
    const { product_id, score, reason } = findProductId(item, supplierId, products, aliases)
    let receipt: StockReceipt | null = null
    if (product_id) {
      // 既に他のitem に取られていない receipts
      const remaining = receipts.filter(r => !claimedReceiptIds.has(r.id))
      const r = findStockReceipt(product_id, supplierId, item.quantity, item.delivery_date, remaining)
      receipt = r.receipt
      if (receipt) claimedReceiptIds.add(receipt.id)
    }

    const { status, note } = classifyMatch(item, product_id, receipt)
    counts[status as keyof typeof counts] = (counts[status as keyof typeof counts] || 0) + 1
    updates.push({
      id: item.id,
      matched_product_id: product_id,
      matched_stock_receipt_id: receipt?.id || null,
      match_status: status,
      match_score: score,
      match_note: note || `(${reason})`,
    })
  }

  // 一括更新（1件ずつ実行: bulk update がサポートされてないため）
  for (const u of updates) {
    await supabase.from("supplier_invoice_items").update({
      matched_product_id: u.matched_product_id,
      matched_stock_receipt_id: u.matched_stock_receipt_id,
      match_status: u.match_status,
      match_score: u.match_score,
      match_note: u.match_note,
    }).eq("id", u.id)
  }

  // ヘッダの status 更新
  const hasIssue = counts.qty_mismatch + counts.price_mismatch + counts.amount_mismatch + counts.no_product + counts.unmatched > 0
  await supabase.from("supplier_invoices").update({
    status: hasIssue ? "差異あり" : "OK",
    matched_at: new Date().toISOString(),
  }).eq("id", supplierInvoiceId)

  return { total: allItems.length, ...counts }
}

/**
 * 手動マッチ調整: 1明細の matched_product_id を変更
 * → supplier_product_aliases に学習データとして保存
 */
export async function setManualMatch(
  itemId: string,
  productId: string,
  supplierId: string,
  saveAlias = true
): Promise<void> {
  // item の現在の supplier_product_code / product_name を取得
  const { data: item } = await supabase.from("supplier_invoice_items")
    .select("supplier_product_code,product_name")
    .eq("id", itemId).single()

  // item を更新
  await supabase.from("supplier_invoice_items").update({
    matched_product_id: productId,
    match_status: "manual_ok",
    match_note: "手動指定",
  }).eq("id", itemId)

  // alias に保存（学習）
  if (saveAlias && item) {
    if (item.supplier_product_code) {
      try {
        await supabase.from("supplier_product_aliases").upsert({
          supplier_id: supplierId,
          supplier_product_code: item.supplier_product_code,
          supplier_product_name: item.product_name,
          product_id: productId,
          confidence: "manual",
          last_used_at: new Date().toISOString(),
        }, { onConflict: "supplier_id,supplier_product_code,product_id" })
      } catch { /* 重複は無視 */ }
    }
  }
}
