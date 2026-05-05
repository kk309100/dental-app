// 取引先別単価マスタの取得・更新ヘルパー
// 価格はすべて税抜（注文/発注の price/unit_price と同じ規約）
//
// テーブル: supplier_prices, clinic_prices （Supabase Studio で作成済み）
// 過去履歴から自動初期化された後、新しい注文/発注の度に最新価格として upsert される

import { supabase } from "@/lib/supabase"

export type SupplierPrice = {
  id: string
  supplier_id: string
  product_id: string
  unit_price: number
  pack_size: string | null
  note: string | null
  last_received_at: string | null
  updated_at: string | null
}

export type ClinicPrice = {
  id: string
  clinic_id: string
  product_id: string
  unit_price: number
  note: string | null
  last_sold_at: string | null
  updated_at: string | null
}

// ─────────────────────────────────────────────
// 全件取得
// ─────────────────────────────────────────────

export async function fetchAllSupplierPrices(): Promise<SupplierPrice[]> {
  try {
    const { data } = await supabase.from("supplier_prices").select("*").limit(50000)
    return (data as SupplierPrice[]) || []
  } catch {
    return []
  }
}

export async function fetchAllClinicPrices(): Promise<ClinicPrice[]> {
  try {
    const { data } = await supabase.from("clinic_prices").select("*").limit(50000)
    return (data as ClinicPrice[]) || []
  } catch {
    return []
  }
}

// 特定の仕入先 or 医院だけ
export async function fetchSupplierPrices(supplier_id: string): Promise<SupplierPrice[]> {
  if (!supplier_id) return []
  const { data } = await supabase.from("supplier_prices").select("*").eq("supplier_id", supplier_id).limit(50000)
  return (data as SupplierPrice[]) || []
}

export async function fetchClinicPrices(clinic_id: string): Promise<ClinicPrice[]> {
  if (!clinic_id) return []
  const { data } = await supabase.from("clinic_prices").select("*").eq("clinic_id", clinic_id).limit(50000)
  return (data as ClinicPrice[]) || []
}

// 特定商品の価格マトリクス（商品詳細ページ用）
export async function fetchSupplierPricesByProduct(product_id: string): Promise<SupplierPrice[]> {
  if (!product_id) return []
  const { data } = await supabase.from("supplier_prices").select("*").eq("product_id", product_id).limit(50000)
  return (data as SupplierPrice[]) || []
}

export async function fetchClinicPricesByProduct(product_id: string): Promise<ClinicPrice[]> {
  if (!product_id) return []
  const { data } = await supabase.from("clinic_prices").select("*").eq("product_id", product_id).limit(50000)
  return (data as ClinicPrice[]) || []
}

// ─────────────────────────────────────────────
// 高速ルックアップ用マップ（"clinic_id:product_id" → unit_price）
// ─────────────────────────────────────────────

export function makeSupplierPriceMap(prices: SupplierPrice[]): Map<string, number> {
  const m = new Map<string, number>()
  prices.forEach(p => m.set(`${p.supplier_id}:${p.product_id}`, Number(p.unit_price)))
  return m
}

export function makeClinicPriceMap(prices: ClinicPrice[]): Map<string, number> {
  const m = new Map<string, number>()
  prices.forEach(p => m.set(`${p.clinic_id}:${p.product_id}`, Number(p.unit_price)))
  return m
}

export const supplierPriceKey = (supplier_id: string, product_id: string) => `${supplier_id}:${product_id}`
export const clinicPriceKey = (clinic_id: string, product_id: string) => `${clinic_id}:${product_id}`

// ─────────────────────────────────────────────
// 単価の自動学習（注文/発注の度に最新価格を保存）
// ─────────────────────────────────────────────

/**
 * 仕入先×商品 の単価をマスタに upsert（最新仕入価格として記録）
 * 発注書発行時に呼び出す
 */
export async function upsertSupplierPrice(args: {
  supplier_id: string
  product_id: string
  unit_price: number
  pack_size?: string | null
  note?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  if (!args.supplier_id || !args.product_id || !args.unit_price || args.unit_price <= 0) {
    return { ok: false, error: "invalid args" }
  }
  try {
    const { error } = await supabase.from("supplier_prices").upsert({
      supplier_id: args.supplier_id,
      product_id: args.product_id,
      unit_price: args.unit_price,
      pack_size: args.pack_size ?? null,
      note: args.note ?? null,
      last_received_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "supplier_id,product_id" })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * 医院×商品 の単価をマスタに upsert（最新販売価格として記録）
 * 注文作成時に呼び出す
 */
export async function upsertClinicPrice(args: {
  clinic_id: string
  product_id: string
  unit_price: number
  note?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  if (!args.clinic_id || !args.product_id || !args.unit_price || args.unit_price <= 0) {
    return { ok: false, error: "invalid args" }
  }
  try {
    const { error } = await supabase.from("clinic_prices").upsert({
      clinic_id: args.clinic_id,
      product_id: args.product_id,
      unit_price: args.unit_price,
      note: args.note ?? null,
      last_sold_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "clinic_id,product_id" })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * 複数アイテムを一括 upsert（注文/発注の確定時に items を一気に学習）
 */
export async function bulkUpsertClinicPrices(
  clinic_id: string,
  items: { product_id: string | null; price: number }[]
): Promise<void> {
  const valid = items.filter(it => it.product_id && it.price > 0)
  if (valid.length === 0 || !clinic_id) return
  const now = new Date().toISOString()
  const rows = valid.map(it => ({
    clinic_id,
    product_id: it.product_id!,
    unit_price: it.price,
    last_sold_at: now,
    updated_at: now,
  }))
  try {
    await supabase.from("clinic_prices").upsert(rows, { onConflict: "clinic_id,product_id" })
  } catch { /* スキップ */ }
}

export async function bulkUpsertSupplierPrices(
  supplier_id: string,
  items: { product_id: string | null; unit_price: number }[]
): Promise<void> {
  const valid = items.filter(it => it.product_id && it.unit_price > 0)
  if (valid.length === 0 || !supplier_id) return
  const now = new Date().toISOString()
  const rows = valid.map(it => ({
    supplier_id,
    product_id: it.product_id!,
    unit_price: it.unit_price,
    last_received_at: now,
    updated_at: now,
  }))
  try {
    await supabase.from("supplier_prices").upsert(rows, { onConflict: "supplier_id,product_id" })
  } catch { /* スキップ */ }
}

// ─────────────────────────────────────────────
// 削除
// ─────────────────────────────────────────────

export async function deleteSupplierPrice(id: string) {
  const { error } = await supabase.from("supplier_prices").delete().eq("id", id)
  return { ok: !error, error: error?.message }
}

export async function deleteClinicPrice(id: string) {
  const { error } = await supabase.from("clinic_prices").delete().eq("id", id)
  return { ok: !error, error: error?.message }
}
