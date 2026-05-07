// 発注プール（仕入先別の下書き発注書）
//
// 業務フロー:
//   1. 各医院から注文が来る → 商品ごとに仕入先が違う
//   2. 注文の「→発注」ボタンで、不足商品を「仕入先別の下書き発注書」にプール
//   3. 同じ仕入先に既存の下書きがあれば追記、なければ新規作成
//   4. 半日 or 1日溜めた後、プール画面で「✓発注確定」→ 下書き→発注済 に変更
//
// 既存の purchase_orders.status="下書き" を「プール」として活用
// 各明細の note に「[医院名] from 注文ID」を記録 → 医院納品先の追跡用

import { supabase } from "@/lib/supabase"

export type PoolItem = {
  product_id: string
  product_name: string
  quantity: number
  unit_price: number
  source_order_id: string
  source_clinic_name: string
  source_clinic_id: string | null
}

export type PoolResult = {
  ok: boolean
  pos: { supplier_id: string; supplier_name: string; po_id: string; added_items: number }[]
  errors: string[]
}

/**
 * 商品リストを仕入先別に振り分けてプール（下書き発注書）に追加
 *
 * @param items 追加する商品リスト（仕入先IDが items[i].supplier_id_override で指定されてる前提）
 * @param itemsBySupplier { supplierId: PoolItem[] } の形で渡す
 */
export async function addItemsToPool(
  itemsBySupplier: Map<string, PoolItem[]>,
  suppliersInfo: Map<string, string>  // supplier_id → name
): Promise<PoolResult> {
  const result: PoolResult = { ok: true, pos: [], errors: [] }

  for (const [supplierId, items] of itemsBySupplier.entries()) {
    if (items.length === 0) continue

    try {
      // 1. その仕入先の「下書き」発注書を探す（既存があれば追記）
      const { data: existing } = await supabase
        .from("purchase_orders")
        .select("id,total_amount")
        .eq("supplier_id", supplierId)
        .eq("status", "下書き")
        .order("created_at", { ascending: false })
        .limit(1)

      let poId: string
      let existingTotal = 0
      const supplierName = suppliersInfo.get(supplierId) || "(仕入先)"

      if (existing && existing.length > 0) {
        poId = existing[0].id
        existingTotal = Number(existing[0].total_amount || 0)
      } else {
        // 新規 下書き 発注書 作成
        const now = new Date()
        const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`
        const rand = Math.floor(Math.random() * 9000) + 1000
        const poNumber = `POOL-${stamp}-${rand}`

        const { data: newPo, error: e1 } = await supabase
          .from("purchase_orders")
          .insert({
            po_number: poNumber,
            supplier_id: supplierId,
            status: "下書き",
            total_amount: 0,
            note: "発注プール（医院注文から集約）",
          })
          .select()
          .single()
        if (e1 || !newPo) {
          result.errors.push(`${supplierName}: PO作成失敗 ${e1?.message || ""}`)
          continue
        }
        poId = newPo.id
      }

      // 2. 明細を追加（同じ商品でも別行として追加 = どの注文から来たか追跡可能）
      const itemRows = items.map(it => ({
        purchase_order_id: poId,
        product_id: it.product_id,
        product_name: it.product_name,
        quantity: it.quantity,
        unit_price: it.unit_price,
        received_quantity: 0,
        note: `[${it.source_clinic_name}] 注文 ${it.source_order_id.slice(0, 8)}`,
      }))
      const { error: e2 } = await supabase
        .from("purchase_order_items")
        .insert(itemRows)
      if (e2) {
        result.errors.push(`${supplierName}: 明細追加失敗 ${e2.message}`)
        continue
      }

      // 3. PO の total_amount 更新
      const addedTotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0)
      await supabase
        .from("purchase_orders")
        .update({ total_amount: existingTotal + addedTotal })
        .eq("id", poId)

      result.pos.push({
        supplier_id: supplierId,
        supplier_name: supplierName,
        po_id: poId,
        added_items: items.length,
      })
    } catch (e) {
      result.errors.push(`${suppliersInfo.get(supplierId) || supplierId}: ${(e as Error).message}`)
    }
  }

  if (result.errors.length > 0) result.ok = false
  return result
}

/**
 * 注文1件 or 複数件から、不足商品を仕入先別にプールに追加するヘルパ
 */
export async function poolFromOrders(orderIds: string[]): Promise<PoolResult & { skippedNoSupplier: number; skippedNoShortage: number }> {
  // 1. データ取得
  const [oRes, oiRes, pRes, sRes, srRes, cRes] = await Promise.all([
    supabase.from("orders").select("id,clinic_id").in("id", orderIds),
    supabase.from("order_items").select("order_id,product_id,quantity").in("order_id", orderIds).limit(50000),
    supabase.from("products").select("id,name,stock,cost,default_supplier_id").limit(50000),
    supabase.from("suppliers").select("id,name").limit(50000),
    // 過去仕入履歴（最新優先で仕入先決定）
    supabase.from("stock_receipts").select("product_id,supplier_id,unit_price,created_at").order("created_at", { ascending: false }).limit(50000),
    supabase.from("clinics").select("id,name").limit(50000),
  ])

  const orders = oRes.data || []
  const orderItems = oiRes.data || []
  const products = pRes.data || []
  const suppliers = sRes.data || []
  const stockReceipts = srRes.data || []
  const clinics = cRes.data || []

  const productById = new Map(products.map((p: any) => [p.id, p]))
  const supplierById = new Map<string, string>(suppliers.map((s: any) => [s.id, s.name]))
  const clinicById = new Map(clinics.map((c: any) => [c.id, c.name]))
  const orderById = new Map(orders.map((o: any) => [o.id, o]))

  // 商品ごとの「最新の仕入先」を計算
  const lastSupplierByProduct = new Map<string, { supplierId: string; unitPrice: number | null }>()
  for (const r of stockReceipts as any[]) {
    if (!r.product_id || !r.supplier_id) continue
    if (!lastSupplierByProduct.has(r.product_id)) {
      lastSupplierByProduct.set(r.product_id, { supplierId: r.supplier_id, unitPrice: r.unit_price })
    }
  }

  // 2. 不足商品を仕入先別にグルーピング
  const itemsBySupplier = new Map<string, PoolItem[]>()
  let skippedNoSupplier = 0
  let skippedNoShortage = 0

  for (const oi of orderItems as any[]) {
    if (!oi.product_id) continue
    const product = productById.get(oi.product_id) as any
    if (!product) { skippedNoShortage++; continue }
    const stock = Number(product.stock || 0)
    const orderQty = Number(oi.quantity || 0)
    const shortBy = orderQty - stock
    if (shortBy <= 0) { skippedNoShortage++; continue }

    // 仕入先決定: default_supplier_id > 過去履歴
    const last = lastSupplierByProduct.get(oi.product_id)
    const supplierId = product.default_supplier_id || last?.supplierId
    if (!supplierId) { skippedNoSupplier++; continue }

    const order = orderById.get(oi.order_id) as any
    const clinicName = order?.clinic_id ? (clinicById.get(order.clinic_id) || "(医院)") : "(医院)"
    const unitPrice = last?.unitPrice ?? Number(product.cost || 0)

    const list = itemsBySupplier.get(supplierId) || []
    list.push({
      product_id: oi.product_id,
      product_name: product.name,
      quantity: shortBy,
      unit_price: unitPrice,
      source_order_id: oi.order_id,
      source_clinic_name: clinicName,
      source_clinic_id: order?.clinic_id || null,
    })
    itemsBySupplier.set(supplierId, list)
  }

  // 3. プールに追加
  const result = await addItemsToPool(itemsBySupplier, supplierById)
  return { ...result, skippedNoSupplier, skippedNoShortage }
}

/**
 * 下書き状態の発注書を「発注済」に確定
 */
export async function confirmPoolPO(poId: string, sentMethod: string = "FAX"): Promise<{ ok: boolean; error?: string }> {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from("purchase_orders")
    .update({
      status: "発注済",
      ordered_at: now,
      sent_method: sentMethod,
      sent_at: now,
    })
    .eq("id", poId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * プール状態の発注書を破棄（明細含めて削除）
 */
export async function discardPoolPO(poId: string): Promise<{ ok: boolean; error?: string }> {
  await supabase.from("purchase_order_items").delete().eq("purchase_order_id", poId)
  const { error } = await supabase.from("purchase_orders").delete().eq("id", poId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
