"use client"

import { useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"

type Log = { time: string; level: "info" | "ok" | "error"; msg: string }

export default function SimulationPage() {
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<Log[]>([])
  const [opts, setOpts] = useState({
    clinics: 10,
    productsPerOrder: 100,
    months: 2,
    stockHigh: 30,
    stockLow: 30,
    stockZero: 40,
  })

  function log(level: Log["level"], msg: string) {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString("ja-JP"), level, msg }])
  }

  function rand<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }
  function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min }
  function pick<T>(arr: T[], n: number): T[] {
    const a = [...arr]
    const result: T[] = []
    while (result.length < n && a.length > 0) {
      const i = Math.floor(Math.random() * a.length)
      result.push(a.splice(i, 1)[0])
    }
    return result
  }

  async function run() {
    if (!confirm(`シミュレーションを開始します。\n\n医院 ${opts.clinics}個 × 商品 ${opts.productsPerOrder}種類\n在庫: 十分${opts.stockHigh}% / 規定不足${opts.stockLow}% / 切れ${opts.stockZero}%\n期間: ${opts.months}ヶ月分\n\n大量データを生成します。よろしいですか？`)) return
    setRunning(true)
    setLogs([])
    try {
      // ===== ステップ1: 既存マスタ取得 =====
      log("info", "Step 1/8: マスタ取得中...")
      const [clinicsR, productsR, suppliersR] = await Promise.all([
        supabase.from("clinics").select("id,name").limit(50),
        supabase.from("products").select("id,name,price,cost").limit(500),
        supabase.from("suppliers").select("id,name").limit(50),
      ])
      const allClinics = clinicsR.data || []
      const allProducts = productsR.data || []
      const allSuppliers = suppliersR.data || []
      if (allClinics.length < opts.clinics) { log("error", `医院数不足: ${allClinics.length} < ${opts.clinics}`); setRunning(false); return }
      if (allProducts.length < opts.productsPerOrder) { log("error", `商品数不足: ${allProducts.length} < ${opts.productsPerOrder}`); setRunning(false); return }
      const linkSup = allSuppliers.find(s => s.name.includes("リンク")) || allSuppliers[0]
      const sasakiSup = allSuppliers.find(s => s.name.includes("ササキ")) || allSuppliers[1] || linkSup
      const ishidaSup = allSuppliers.find(s => s.name.includes("イシダ")) || allSuppliers[2] || linkSup
      log("ok", `✓ 医院${allClinics.length} / 商品${allProducts.length} / 仕入先${allSuppliers.length}`)
      log("ok", `✓ 主力仕入先: ${linkSup?.name}, ${sasakiSup?.name}, ${ishidaSup?.name}`)

      // ===== ステップ2: 対象選定 =====
      log("info", "Step 2/8: シミュ対象を選定...")
      const targetClinics = pick(allClinics, opts.clinics)
      const targetProducts = pick(allProducts, opts.productsPerOrder)
      log("ok", `✓ 医院${targetClinics.length}件 / 商品${targetProducts.length}件 を対象に`)

      // ===== ステップ3: 在庫を 30/30/40 に再分配 =====
      log("info", "Step 3/8: 商品在庫をシミュ用に調整中...")
      let highCnt = 0, lowCnt = 0, zeroCnt = 0
      for (let i = 0; i < targetProducts.length; i++) {
        const p = targetProducts[i]
        const r = Math.random() * 100
        let newStock: number
        if (r < opts.stockHigh) { newStock = randInt(50, 200); highCnt++ }
        else if (r < opts.stockHigh + opts.stockLow) { newStock = randInt(1, 5); lowCnt++ }
        else { newStock = 0; zeroCnt++ }
        await supabase.from("products").update({ stock: newStock, reorder_level: 10 }).eq("id", p.id)
      }
      log("ok", `✓ 在庫調整: 十分${highCnt}件 / 規定不足${lowCnt}件 / 切れ${zeroCnt}件`)

      // ===== ステップ4: 各医院に注文を作成（2ヶ月に分散） =====
      log("info", "Step 4/8: 注文を作成中（10医院×100商品）...")
      const now = new Date()
      const startDate = new Date(now.getFullYear(), now.getMonth() - opts.months, 1)
      const orderIdsByClinic = new Map<string, string[]>()
      let createdOrders = 0
      for (const clinic of targetClinics) {
        // 各医院 月1〜3回の注文
        const ordersPerClinic = randInt(2, 4)
        const ordersForClinic: string[] = []
        for (let oi = 0; oi < ordersPerClinic; oi++) {
          const dayOffset = randInt(0, opts.months * 30)
          const orderDate = new Date(startDate.getTime() + dayOffset * 86400000)
          // ランダムに 30〜100 商品を選んで注文行に
          const orderProducts = pick(targetProducts, randInt(30, opts.productsPerOrder))
          const items = orderProducts.map(p => ({
            product_id: p.id,
            product_name: p.name,
            quantity: randInt(1, 5),
            price: Number(p.price || 1000),
          }))
          const total = items.reduce((s, i) => s + i.price * i.quantity, 0)
          const dn = `DN-SIM-${orderDate.getFullYear()}${String(orderDate.getMonth() + 1).padStart(2, "0")}${String(orderDate.getDate()).padStart(2, "0")}-${randInt(1000, 9999)}`
          const { data: order, error } = await supabase.from("orders").insert({
            clinic_id: clinic.id,
            status: "注文受付",
            total_price: total,
            delivery_number: dn,
            created_at: orderDate.toISOString(),
            note: "📊 シミュレーション生成",
          }).select().single()
          if (error || !order) { log("error", `注文作成失敗: ${error?.message}`); continue }
          await supabase.from("order_items").insert(items.map(it => ({ ...it, order_id: order.id })))
          ordersForClinic.push(order.id)
          createdOrders++
        }
        orderIdsByClinic.set(clinic.id, ordersForClinic)
      }
      log("ok", `✓ ${createdOrders}件の注文を作成`)

      // ===== ステップ5: 在庫ある分は即納品（注文を「納品済み」へ） =====
      log("info", "Step 5/8: 在庫ある注文を納品済みに...")
      const allCreatedOrderIds = Array.from(orderIdsByClinic.values()).flat()
      // 全注文の order_items を取得
      const { data: allItems } = await supabase.from("order_items").select("id,order_id,product_id,quantity").in("order_id", allCreatedOrderIds)
      const itemsByOrder = new Map<string, typeof allItems>()
      ;(allItems || []).forEach(it => {
        if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, [])
        itemsByOrder.get(it.order_id)!.push(it)
      })
      // 在庫マップ
      const { data: pStock } = await supabase.from("products").select("id,stock").in("id", targetProducts.map(p => p.id))
      const stockMap = new Map((pStock || []).map(p => [p.id, Number(p.stock || 0)]))
      let deliveredCount = 0
      const shortItems: { product_id: string; quantity: number; order_id: string }[] = []
      for (const orderId of allCreatedOrderIds) {
        const items = itemsByOrder.get(orderId) || []
        let canDeliverAll = true
        for (const it of items) {
          if (!it.product_id) continue
          const stock = stockMap.get(it.product_id) || 0
          if (stock < Number(it.quantity)) {
            canDeliverAll = false
            shortItems.push({ product_id: it.product_id, quantity: Number(it.quantity) - stock, order_id: orderId })
          }
        }
        if (canDeliverAll) {
          // 在庫減算
          for (const it of items) {
            if (!it.product_id) continue
            const stock = stockMap.get(it.product_id) || 0
            const newStock = stock - Number(it.quantity)
            stockMap.set(it.product_id, newStock)
            await supabase.from("products").update({ stock: newStock }).eq("id", it.product_id)
          }
          await supabase.from("orders").update({ status: "納品済み", delivered_at: new Date().toISOString() }).eq("id", orderId)
          deliveredCount++
        }
      }
      log("ok", `✓ ${deliveredCount}件を即納品済みに（在庫充足）`)
      log("info", `→ 残り ${allCreatedOrderIds.length - deliveredCount}件 = ${shortItems.length}明細が在庫不足`)

      // ===== ステップ6: 不足分を発注書化（リンクメイン） =====
      log("info", "Step 6/8: 不足分の発注書を作成中...")
      // 商品ごとに不足量集計
      const shortByProduct = new Map<string, number>()
      shortItems.forEach(s => shortByProduct.set(s.product_id, (shortByProduct.get(s.product_id) || 0) + s.quantity))
      // 仕入先別に分散（リンク 70%, ササキ 20%, イシダ 10%）
      const linkItems: { product_id: string; product_name: string; quantity: number; unit_price: number }[] = []
      const sasakiItems: typeof linkItems = []
      const ishidaItems: typeof linkItems = []
      Array.from(shortByProduct.entries()).forEach(([pid, qty]) => {
        const p = targetProducts.find(x => x.id === pid)
        if (!p) return
        const r = Math.random()
        const item = { product_id: pid, product_name: p.name, quantity: qty + 5, unit_price: Number(p.cost || p.price || 1000) }
        if (r < 0.7) linkItems.push(item)
        else if (r < 0.9) sasakiItems.push(item)
        else ishidaItems.push(item)
      })
      const createdPOs: { id: string; po_number: string; supplier: string; itemCount: number }[] = []
      for (const [sup, items] of [[linkSup, linkItems], [sasakiSup, sasakiItems], [ishidaSup, ishidaItems]] as const) {
        if (!sup || items.length === 0) continue
        const total = items.reduce((s, i) => s + i.unit_price * i.quantity, 0)
        const poNumber = `PO-SIM-${randInt(10000, 99999)}`
        const { data: po, error } = await supabase.from("purchase_orders").insert({
          po_number: poNumber,
          supplier_id: sup.id,
          status: "発注済",
          ordered_at: new Date().toISOString(),
          total_amount: total,
          note: "📊 シミュレーション自動生成",
        }).select().single()
        if (error || !po) { log("error", `PO作成失敗 ${sup.name}: ${error?.message}`); continue }
        await supabase.from("purchase_order_items").insert(items.map(i => ({ ...i, purchase_order_id: po.id })))
        createdPOs.push({ id: po.id, po_number: poNumber, supplier: sup.name, itemCount: items.length })
      }
      log("ok", `✓ ${createdPOs.length}件の発注書を作成: ${createdPOs.map(p => `${p.supplier}${p.itemCount}品`).join(" / ")}`)

      // ===== ステップ7: 仕入納品（POを入荷済み + stock 加算） =====
      log("info", "Step 7/8: 仕入納品処理（在庫加算）...")
      let restocked = 0
      for (const po of createdPOs) {
        const { data: poItems } = await supabase.from("purchase_order_items").select("product_id,quantity,unit_price").eq("purchase_order_id", po.id)
        for (const i of (poItems || [])) {
          if (!i.product_id) continue
          const cur = stockMap.get(i.product_id) || 0
          const newStock = cur + Number(i.quantity)
          stockMap.set(i.product_id, newStock)
          await supabase.from("products").update({ stock: newStock }).eq("id", i.product_id)
          await supabase.from("purchase_order_items").update({ received_quantity: i.quantity }).eq("purchase_order_id", po.id).eq("product_id", i.product_id)
          // stock_receipts に記録
          await supabase.from("stock_receipts").insert({
            product_id: i.product_id,
            quantity: i.quantity,
            unit_price: i.unit_price,
            supplier_id: createdPOs.find(x => x.id === po.id) ? (allSuppliers.find(s => s.name === po.supplier)?.id || null) : null,
            memo: `📊 シミュ ${po.po_number}`,
          })
          restocked++
        }
        await supabase.from("purchase_orders").update({ status: "入荷済" }).eq("id", po.id)
      }
      log("ok", `✓ ${restocked}商品分を仕入納品（在庫加算）`)

      // ===== ステップ8: 残り注文を医院納品 + 請求書発行 =====
      log("info", "Step 8/8: 残り注文の医院納品 + 請求書発行...")
      let nowDelivered = 0
      for (const orderId of allCreatedOrderIds) {
        const { data: ord } = await supabase.from("orders").select("status").eq("id", orderId).single()
        if (ord?.status && ["納品済み", "納品済"].includes(ord.status)) continue
        const items = itemsByOrder.get(orderId) || []
        // 在庫から減算
        for (const it of items) {
          if (!it.product_id) continue
          const stock = stockMap.get(it.product_id) || 0
          stockMap.set(it.product_id, Math.max(0, stock - Number(it.quantity)))
          await supabase.from("products").update({ stock: Math.max(0, stock - Number(it.quantity)) }).eq("id", it.product_id)
        }
        await supabase.from("orders").update({ status: "納品済み", delivered_at: new Date().toISOString() }).eq("id", orderId)
        nowDelivered++
      }
      log("ok", `✓ さらに ${nowDelivered}件を医院納品（合計 ${deliveredCount + nowDelivered}件納品済み）`)

      // 請求書: 医院別 月次
      log("info", "請求書発行中（医院別×月次）...")
      let invCount = 0
      for (const clinic of targetClinics) {
        const orderIds = orderIdsByClinic.get(clinic.id) || []
        // 月別にグループ化
        const byMonth = new Map<string, string[]>()
        for (const oid of orderIds) {
          const { data: o } = await supabase.from("orders").select("created_at").eq("id", oid).single()
          if (!o) continue
          const ym = o.created_at.slice(0, 7)
          if (!byMonth.has(ym)) byMonth.set(ym, [])
          byMonth.get(ym)!.push(oid)
        }
        for (const [ym, oids] of byMonth) {
          const { data: ois } = await supabase.from("order_items").select("price,quantity").in("order_id", oids)
          const subtotal = (ois || []).reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 0), 0)
          const tax = Math.round(subtotal * 0.10)
          const invNumber = `INV-SIM-${ym.replace("-", "")}-${clinic.id.slice(0, 4)}`
          const { data: inv, error } = await supabase.from("invoices").insert({
            clinic_id: clinic.id,
            invoice_number: invNumber,
            issue_date: ym + "-28",
            due_date: ym + "-28",
            subtotal, tax, total: subtotal + tax,
            status: "issued",
          }).select().single()
          if (error || !inv) continue
          await supabase.from("orders").update({ invoice_id: inv.id }).in("id", oids)
          invCount++
        }
      }
      log("ok", `✓ ${invCount}件の請求書を発行`)

      log("ok", "🎉 シミュレーション完了！各画面でデータを確認してください")
      log("info", "クリーンアップしたい場合は下の「シミュデータ削除」ボタン")
    } catch (e) {
      log("error", `エラー: ${(e as Error).message}`)
    } finally {
      setRunning(false)
    }
  }

  async function cleanup() {
    if (!confirm("シミュレーション生成データを全削除します。\n注文/発注書/請求書/仕入記録のうち、メモに「📊 シミュレーション」を含むものが対象です。\n本当に削除しますか？")) return
    setRunning(true)
    setLogs([])
    try {
      log("info", "シミュデータ削除中...")
      // 順番が重要: 子から親
      // 1. invoices (note ベース)
      await supabase.from("invoices").delete().like("invoice_number", "INV-SIM-%")
      log("ok", "✓ シミュ請求書削除")
      // 2. stock_receipts (memo ベース)
      await supabase.from("stock_receipts").delete().like("memo", "📊 シミュ%")
      log("ok", "✓ シミュ仕入記録削除")
      // 3. purchase_order_items (PO ベース)
      const { data: pos } = await supabase.from("purchase_orders").select("id").like("po_number", "PO-SIM-%").limit(50000)
      if (pos && pos.length > 0) {
        await supabase.from("purchase_order_items").delete().in("purchase_order_id", pos.map(p => p.id))
        await supabase.from("purchase_orders").delete().like("po_number", "PO-SIM-%")
      }
      log("ok", "✓ シミュ発注書削除")
      // 4. order_items + orders
      const { data: orders } = await supabase.from("orders").select("id").like("delivery_number", "DN-SIM-%").limit(50000)
      if (orders && orders.length > 0) {
        await supabase.from("order_items").delete().in("order_id", orders.map(o => o.id))
        await supabase.from("orders").delete().like("delivery_number", "DN-SIM-%")
      }
      log("ok", `✓ シミュ注文 ${orders?.length || 0}件 削除`)
      log("ok", "🧹 クリーンアップ完了")
    } catch (e) {
      log("error", `エラー: ${(e as Error).message}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827" }}>
          📊 シミュレーション
          <span className="ml-2 text-xs font-normal text-gray-400">業務フローを大量データで一気にテスト</span>
        </h1>
        <Link href="/admin" className="text-xs text-gray-500 underline">← HOME</Link>
      </div>

      <div className="bg-white rounded-lg p-4 space-y-3" style={{ border: "1px solid #e8eaed" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>設定</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" style={{ fontSize: 13 }}>
          <label>医院数<input type="number" value={opts.clinics} onChange={e => setOpts({ ...opts, clinics: Number(e.target.value) })} className="w-full mt-1 px-2 py-1.5 border rounded" style={{ fontSize: 14 }} /></label>
          <label>商品種類<input type="number" value={opts.productsPerOrder} onChange={e => setOpts({ ...opts, productsPerOrder: Number(e.target.value) })} className="w-full mt-1 px-2 py-1.5 border rounded" style={{ fontSize: 14 }} /></label>
          <label>期間（月）<input type="number" value={opts.months} onChange={e => setOpts({ ...opts, months: Number(e.target.value) })} className="w-full mt-1 px-2 py-1.5 border rounded" style={{ fontSize: 14 }} /></label>
          <label>在庫十分%<input type="number" value={opts.stockHigh} onChange={e => setOpts({ ...opts, stockHigh: Number(e.target.value) })} className="w-full mt-1 px-2 py-1.5 border rounded" style={{ fontSize: 14 }} /></label>
          <label>規定不足%<input type="number" value={opts.stockLow} onChange={e => setOpts({ ...opts, stockLow: Number(e.target.value) })} className="w-full mt-1 px-2 py-1.5 border rounded" style={{ fontSize: 14 }} /></label>
          <label>在庫切れ%<input type="number" value={opts.stockZero} onChange={e => setOpts({ ...opts, stockZero: Number(e.target.value) })} className="w-full mt-1 px-2 py-1.5 border rounded" style={{ fontSize: 14 }} /></label>
        </div>
        <div className="flex gap-2">
          <button onClick={run} disabled={running} className="px-5 py-2 bg-emerald-600 text-white text-sm font-bold rounded disabled:opacity-50">
            {running ? "実行中…" : "🚀 シミュレーション開始"}
          </button>
          <button onClick={cleanup} disabled={running} className="px-5 py-2 bg-red-600 text-white text-sm font-bold rounded disabled:opacity-50">
            🧹 シミュデータ削除
          </button>
        </div>
      </div>

      <div className="bg-gray-900 text-white rounded-lg p-3 font-mono max-h-[60vh] overflow-y-auto" style={{ fontSize: 12 }}>
        <p className="text-gray-400">📜 ログ</p>
        {logs.length === 0 ? (
          <p className="text-gray-500 mt-2">「シミュレーション開始」を押すとここに進捗が出ます。</p>
        ) : (
          logs.map((l, i) => (
            <div key={i} className={l.level === "error" ? "text-red-400" : l.level === "ok" ? "text-emerald-300" : "text-gray-300"}>
              <span className="text-gray-500">[{l.time}]</span> {l.msg}
            </div>
          ))
        )}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-900">
        💡 <strong>このシミュは何をするか:</strong>
        <ol className="ml-5 mt-1 list-decimal space-y-0.5">
          <li>マスタから医院・商品・仕入先を取得</li>
          <li>在庫を「十分/規定不足/切れ」に再分配</li>
          <li>各医院に複数注文を作成（過去N月分散）</li>
          <li>在庫充足の注文は即納品済みに</li>
          <li>不足分はリンク主体で発注書発行（70/20/10で分散）</li>
          <li>発注書を入荷済みにして在庫加算</li>
          <li>残りの注文も納品済みに</li>
          <li>医院別×月次で請求書発行</li>
        </ol>
        <p className="mt-2">⚠ 既存マスタ（医院/商品/仕入先）は変更しません。在庫数だけ調整します。注文・発注書・請求書・仕入記録は新規作成。</p>
      </div>
    </div>
  )
}
