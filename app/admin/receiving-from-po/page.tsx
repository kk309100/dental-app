"use client"

// 発注書から入荷処理ページ
// 発注書の商品一覧を表示し、今回届いた商品だけチェックして入荷処理。
// 商品名の手入力・PDF読取不要。分割入荷・部分入荷に完全対応。

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import Link from "next/link"

type PO = {
  id: string; po_number: string | null; supplier_id: string | null
  status: string; ordered_at: string | null; note: string | null
}
type POItem = {
  id: string; purchase_order_id: string; product_id: string | null
  product_name: string | null; quantity: number; unit_price: number
  received_quantity: number | null; note: string | null
}
type Supplier = { id: string; name: string }
type Order    = { id: string; clinic_id: string; status: string; total_price: number; delivery_number: string | null }
type Clinic   = { id: string; name: string }

type ReceiveResult = {
  poId: string; poNumber: string; supplierName: string
  receivedItems: number; totalAmount: number
  nowShippable: { orderId: string; clinicName: string; deliveryNumber: string; totalPrice: number }[]
  partiallyImpacted: number
  error: string | null
}

export default function ReceivingFromPoPage() {
  const [pos, setPos]             = useState<PO[]>([])
  const [poItems, setPoItems]     = useState<POItem[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts]   = useState<{ id: string; stock: number | null }[]>([])
  const [clinics, setClinics]     = useState<Clinic[]>([])
  const [orders, setOrders]       = useState<Order[]>([])
  const [orderItems, setOrderItems] = useState<{ order_id: string; product_id: string | null; quantity: number }[]>([])

  const [loading, setLoading]     = useState(true)
  const [receiving, setReceiving] = useState<Set<string>>(new Set())
  const [results, setResults]     = useState<ReceiveResult[]>([])

  // 選択チェック: poItemId → checked
  const [checked, setChecked] = useState<Set<string>>(new Set())
  // 今回入荷数量オーバーライド: poItemId → qty
  const [qtyOverride, setQtyOverride] = useState<Map<string, number>>(new Map())
  // 展開状態: poId → open/close（デフォルト全展開）
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [p, pi, s, pr, o, oi, cl] = await Promise.all([
      supabase.from("purchase_orders")
        .select("id,po_number,supplier_id,status,ordered_at,note")
        .in("status", ["発注済", "部分入荷", "発注済み"])
        .order("ordered_at", { ascending: false })
        .limit(200),
      supabase.from("purchase_order_items")
        .select("id,purchase_order_id,product_id,product_name,quantity,unit_price,received_quantity,note")
        .limit(50000),
      supabase.from("suppliers").select("id,name").limit(1000),
      supabase.from("products").select("id,stock").limit(50000),
      supabase.from("orders").select("id,clinic_id,status,total_price,delivery_number").limit(50000),
      supabase.from("order_items").select("order_id,product_id,quantity").limit(50000),
      supabase.from("clinics").select("id,name").limit(1000),
    ])
    const fetchedItems = (pi.data as POItem[]) || []
    setPos((p.data as PO[]) || [])
    setPoItems(fetchedItems)
    setSuppliers((s.data as Supplier[]) || [])
    setProducts((pr.data as { id: string; stock: number | null }[]) || [])
    setOrders((o.data as Order[]) || [])
    setOrderItems((oi.data as { order_id: string; product_id: string | null; quantity: number }[]) || [])
    setClinics((cl.data as Clinic[]) || [])
    // 初期チェック: 未入荷残数がある商品を全選択
    const initChecked = new Set(
      fetchedItems.filter(it => remaining(it) > 0).map(it => it.id)
    )
    setChecked(initChecked)
    setLoading(false)
  }

  const supplierById = useMemo(() => new Map(suppliers.map(s => [s.id, s])), [suppliers])
  const clinicById   = useMemo(() => new Map(clinics.map(c => [c.id, c])), [clinics])
  const stockById    = useMemo(() => new Map(products.map(p => [p.id, Number(p.stock || 0)])), [products])
  const itemsByPo    = useMemo(() => {
    const m = new Map<string, POItem[]>()
    for (const it of poItems) {
      if (!m.has(it.purchase_order_id)) m.set(it.purchase_order_id, [])
      m.get(it.purchase_order_id)!.push(it)
    }
    return m
  }, [poItems])

  function remaining(item: POItem) {
    return Math.max(0, Number(item.quantity) - Number(item.received_quantity || 0))
  }
  function receiveQty(item: POItem): number {
    return qtyOverride.has(item.id) ? qtyOverride.get(item.id)! : remaining(item)
  }

  // チェック操作
  function toggleItem(itemId: string) {
    setChecked(prev => {
      const n = new Set(prev); n.has(itemId) ? n.delete(itemId) : n.add(itemId); return n
    })
  }
  function checkAll(poId: string) {
    const its = (itemsByPo.get(poId) || []).filter(it => remaining(it) > 0)
    setChecked(prev => { const n = new Set(prev); its.forEach(it => n.add(it.id)); return n })
  }
  function uncheckAll(poId: string) {
    const its = itemsByPo.get(poId) || []
    setChecked(prev => { const n = new Set(prev); its.forEach(it => n.delete(it.id)); return n })
  }

  // 折りたたみ
  function toggleCollapse(poId: string) {
    setCollapsed(prev => { const n = new Set(prev); n.has(poId) ? n.delete(poId) : n.add(poId); return n })
  }

  // 出荷可能注文の検索
  async function findNowShippable(receivedProductIds: string[]): Promise<{
    nowShippable: ReceiveResult["nowShippable"]; partiallyImpacted: number
  }> {
    if (receivedProductIds.length === 0) return { nowShippable: [], partiallyImpacted: 0 }
    const { data: latestStocks } = await supabase.from("products").select("id,stock").in("id", receivedProductIds)
    const freshStock = new Map((latestStocks || []).map((p: any) => [p.id, Number(p.stock || 0)]))
    const allStockMap = new Map(stockById)
    freshStock.forEach((v, k) => allStockMap.set(k, v))

    const pendingOrders = orders.filter(o => !["納品済み", "納品済", "キャンセル", "取消"].includes(o.status))
    const pendingOrderIds = new Set(pendingOrders.map(o => o.id))
    const affectedOrderIds = new Set(
      orderItems
        .filter(oi => pendingOrderIds.has(oi.order_id) && oi.product_id && receivedProductIds.includes(oi.product_id))
        .map(oi => oi.order_id)
    )

    const nowShippable: ReceiveResult["nowShippable"] = []
    let partiallyImpacted = 0
    for (const oid of affectedOrderIds) {
      const itsForOrder = orderItems.filter(oi => oi.order_id === oid)
      const allOk = itsForOrder.every(oi =>
        !oi.product_id || Number(allStockMap.get(oi.product_id) || 0) >= Number(oi.quantity || 0)
      )
      const ord = pendingOrders.find(o => o.id === oid)
      if (!ord) continue
      if (allOk) {
        nowShippable.push({
          orderId: oid,
          clinicName: clinicById.get(ord.clinic_id)?.name || "(医院不明)",
          deliveryNumber: ord.delivery_number || oid.slice(0, 8),
          totalPrice: Number(ord.total_price || 0),
        })
      } else { partiallyImpacted++ }
    }
    return { nowShippable, partiallyImpacted }
  }

  // ─── 入荷処理（チェックされた商品のみ）────────────────────
  async function receiveChecked(po: PO) {
    if (receiving.has(po.id)) return
    const allIts    = itemsByPo.get(po.id) || []
    const targetIts = allIts.filter(it => checked.has(it.id) && receiveQty(it) > 0)
    if (targetIts.length === 0) {
      alert("入荷する商品が選択されていません。\n届いた商品にチェックを入れてください。")
      return
    }
    const supplierName = po.supplier_id ? (supplierById.get(po.supplier_id)?.name || "不明") : "仕入先未設定"
    const totalAmt = targetIts.reduce((s, it) => s + receiveQty(it) * Number(it.unit_price || 0), 0)

    setReceiving(prev => new Set([...prev, po.id]))
    const receivedProductIds: string[] = []

    try {
      for (const it of targetIts) {
        const qty         = receiveQty(it)
        const newReceived = Number(it.received_quantity || 0) + qty

        // 1. received_quantity 更新
        await supabase.from("purchase_order_items")
          .update({ received_quantity: newReceived })
          .eq("id", it.id)

        // 2. 在庫加算
        if (it.product_id && qty > 0) {
          const before = Number(stockById.get(it.product_id) || 0)
          const after  = before + qty
          await supabase.from("products").update({ stock: after }).eq("id", it.product_id)
          try {
            await supabase.from("stock_movements").insert({
              product_id:    it.product_id,
              movement_type: "入庫",
              quantity:      qty,
              before_stock:  before,
              after_stock:   after,
              ref_type:      "purchase_order_item",
              ref_id:        it.id,
              reason:        `発注書 ${po.po_number || po.id.slice(0, 8)} 入荷`,
            })
          } catch { /* スキップ */ }
          try {
            await supabase.from("stock_receipts").insert({
              product_id:  it.product_id,
              quantity:    qty,
              supplier_id: po.supplier_id,
              unit_price:  it.unit_price || null,
              memo:        `発注書 ${po.po_number || po.id.slice(0, 8)}`,
            })
          } catch { /* スキップ */ }
          receivedProductIds.push(it.product_id)
          stockById.set(it.product_id, before + qty)
        }
      }

      // 3. PO ステータス更新（最新DB値で判定）
      const { data: latestItems } = await supabase
        .from("purchase_order_items")
        .select("quantity,received_quantity")
        .eq("purchase_order_id", po.id)
      if (latestItems) {
        const allDone = latestItems.every(i => Number(i.received_quantity || 0) >= Number(i.quantity))
        const someDone = latestItems.some(i => Number(i.received_quantity || 0) > 0)
        const newStatus = allDone ? "入荷済" : someDone ? "部分入荷" : po.status
        await supabase.from("purchase_orders").update({ status: newStatus }).eq("id", po.id)
        if (allDone) setPos(prev => prev.filter(p => p.id !== po.id))
      }

      // 4. 出荷可能注文を検索
      const { nowShippable, partiallyImpacted } = await findNowShippable(receivedProductIds)

      setResults(prev => [{
        poId: po.id, poNumber: po.po_number || po.id.slice(0, 8), supplierName,
        receivedItems: targetIts.length, totalAmount: totalAmt,
        nowShippable, partiallyImpacted, error: null,
      }, ...prev])

    } catch (e) {
      setResults(prev => [{
        poId: po.id, poNumber: po.po_number || po.id.slice(0, 8), supplierName,
        receivedItems: 0, totalAmount: 0,
        nowShippable: [], partiallyImpacted: 0, error: (e as Error).message,
      }, ...prev])
    } finally {
      setReceiving(prev => { const n = new Set(prev); n.delete(po.id); return n })
      fetchData()
    }
  }

  if (loading) return (
    <div style={{ textAlign: "center", padding: 60, color: "#9ca3af" }}>
      <div style={{ fontSize: 32 }}>⏳</div>読み込み中…
    </div>
  )

  return (
    <div style={{ maxWidth: 860 }}>

      {/* ─── ヘッダー ───────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: 0 }}>
              📦 発注書から入荷処理
            </h1>
            <p style={{ fontSize: 12, color: "#6b7280", margin: "4px 0 0" }}>
              届いた商品にチェックを入れて「入荷処理」 — 手入力不要、分割入荷OK
            </p>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/admin/receiving"><button style={btnGray}>✏️ 手動入力・PDF</button></Link>
            <Link href="/admin/purchase-orders"><button style={btnGray}>📋 発注書一覧</button></Link>
            <Link href="/admin/shipping"><button style={btnBlue}>🚚 出荷準備</button></Link>
          </div>
        </div>

        <div style={{
          marginTop: 14, padding: "10px 16px",
          background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10,
          fontSize: 13, color: "#1e40af",
        }}>
          💡 <strong>今日届いた商品だけチェック</strong>して「入荷処理」を押してください。
          まだ届いていない商品はチェックを外せばOK。数量が違う場合は数字を変えられます。
        </div>
      </div>

      {/* ─── 処理結果 ───────────────────────────────────── */}
      {results.length > 0 && (
        <div style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          {results.map((r, i) => (
            <div key={i} style={{
              padding: "14px 18px",
              background: r.error ? "#fff5f5" : "#f0fdf4",
              border: `2px solid ${r.error ? "#fca5a5" : "#86efac"}`,
              borderRadius: 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 18 }}>{r.error ? "❌" : "✅"}</span>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{r.supplierName} / {r.poNumber}</span>
                {!r.error && (
                  <span style={{ fontSize: 12, color: "#15803d" }}>
                    {r.receivedItems}品を入荷処理 — {fmtYen(r.totalAmount)}
                  </span>
                )}
                <button onClick={() => setResults(prev => prev.filter((_, j) => j !== i))}
                  style={{ marginLeft: "auto", fontSize: 12, color: "#9ca3af", background: "none", border: "none", cursor: "pointer" }}>✕</button>
              </div>
              {r.error && <div style={{ fontSize: 12, color: "#dc2626", marginTop: 6 }}>エラー: {r.error}</div>}
              {!r.error && r.nowShippable.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#15803d", marginBottom: 6 }}>
                    🚚 出荷できるようになった注文 {r.nowShippable.length}件
                  </div>
                  {r.nowShippable.map((o, j) => (
                    <div key={j} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "6px 10px",
                      background: "#fff", borderRadius: 8, border: "1px solid #d1fae5",
                      fontSize: 13, marginBottom: 4,
                    }}>
                      <span style={{ fontWeight: 700 }}>{o.clinicName}</span>
                      <span style={{ color: "#6b7280", fontSize: 12 }}>{o.deliveryNumber}</span>
                      <span style={{ marginLeft: "auto", fontWeight: 700 }}>{fmtYen(o.totalPrice)}</span>
                    </div>
                  ))}
                  <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Link href={`/admin/shipping?orders=${r.nowShippable.map(o => o.orderId).join(",")}`}>
                      <button style={{ ...btnBlue, padding: "8px 16px", fontSize: 13 }}>
                        🚚 出荷準備へ（{r.nowShippable.length}件）
                      </button>
                    </Link>
                  </div>
                </div>
              )}
              {!r.error && r.partiallyImpacted > 0 && (
                <div style={{ fontSize: 12, color: "#b45309", marginTop: 6 }}>
                  ⚠ まだ一部の商品が不足している注文が {r.partiallyImpacted}件あります（追加入荷待ち）
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ─── 発注書リスト ────────────────────────────────── */}
      {pos.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "48px 24px",
          background: "#f0fdf4", border: "2px solid #86efac", borderRadius: 16,
        }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#15803d" }}>入荷待ちの発注書はありません</div>
          <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "center" }}>
            <Link href="/admin/purchase-orders"><button style={btnGray}>📋 発注書一覧</button></Link>
            <Link href="/admin/purchase-orders/pool"><button style={btnOrange}>📦 発注プール</button></Link>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {pos.map(po => {
            const allIts      = itemsByPo.get(po.id) || []
            const pendingIts  = allIts.filter(it => remaining(it) > 0)
            const checkedIts  = pendingIts.filter(it => checked.has(it.id))
            const supplierName = po.supplier_id ? (supplierById.get(po.supplier_id)?.name || "仕入先不明") : "仕入先未設定"
            const isReceiving  = receiving.has(po.id)
            const isCollapsed  = collapsed.has(po.id)
            const isPartial    = po.status === "部分入荷"
            const checkedTotal = checkedIts.reduce((s, it) => s + receiveQty(it) * Number(it.unit_price || 0), 0)
            const allChecked   = pendingIts.length > 0 && pendingIts.every(it => checked.has(it.id))

            return (
              <div key={po.id} style={{
                background: "#fff",
                border: `2px solid ${isPartial ? "#fde68a" : "#e5e7eb"}`,
                borderRadius: 14, overflow: "hidden",
              }}>
                {/* カードヘッダー */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "14px 18px",
                  background: isPartial ? "#fefce8" : "#f9fafb",
                  borderBottom: `1px solid ${isPartial ? "#fde68a" : "#e5e7eb"}`,
                  flexWrap: "wrap",
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{
                        fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                        background: isPartial ? "#fde68a" : "#dbeafe",
                        color: isPartial ? "#92400e" : "#1e40af",
                      }}>
                        {isPartial ? "⚠ 部分入荷中" : "📬 入荷待ち"}
                      </span>
                      <span style={{ fontSize: 16, fontWeight: 800, color: "#111827" }}>{supplierName}</span>
                      <span style={{ fontSize: 12, color: "#9ca3af" }}>
                        {po.po_number || po.id.slice(0, 8)}
                        {po.ordered_at && ` — 発注日 ${new Date(po.ordered_at).toLocaleDateString("ja-JP")}`}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                      全{allIts.length}品中 未入荷{pendingIts.length}品
                      {checkedIts.length > 0 && (
                        <span style={{ marginLeft: 8, fontWeight: 700, color: "#059669" }}>
                          → 今回チェック {checkedIts.length}品 {checkedTotal > 0 ? `/ ${fmtYen(checkedTotal)}` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                    <button
                      onClick={() => toggleCollapse(po.id)}
                      style={{ ...btnGray, fontSize: 12, padding: "6px 12px" }}>
                      {isCollapsed ? "▼ 開く" : "▲ 閉じる"}
                    </button>
                    <button
                      onClick={() => receiveChecked(po)}
                      disabled={isReceiving || checkedIts.length === 0}
                      style={{
                        padding: "10px 20px", borderRadius: 10, border: "none",
                        background: isReceiving ? "#d1d5db"
                          : checkedIts.length === 0 ? "#d1d5db"
                          : "#059669",
                        color: "#fff", fontSize: 14, fontWeight: 800,
                        cursor: (isReceiving || checkedIts.length === 0) ? "not-allowed" : "pointer",
                        whiteSpace: "nowrap",
                      }}>
                      {isReceiving ? "処理中…"
                        : checkedIts.length === 0 ? "商品を選択してください"
                        : `✅ ${checkedIts.length}品を入荷処理`}
                    </button>
                  </div>
                </div>

                {/* 商品チェックリスト */}
                {!isCollapsed && (
                  <div>
                    {/* 全選択/解除 ヘッダー行 */}
                    <div style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 18px", background: "#fafafa",
                      borderBottom: "1px solid #f0f0f0", fontSize: 12, color: "#6b7280",
                    }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={allChecked}
                          onChange={() => allChecked ? uncheckAll(po.id) : checkAll(po.id)}
                          style={{ width: 16, height: 16, cursor: "pointer" }}
                        />
                        <span style={{ fontWeight: 600, color: "#374151" }}>
                          {allChecked ? "すべて解除" : "すべて選択"}
                        </span>
                      </label>
                      <span style={{ marginLeft: "auto" }}>
                        未入荷 {pendingIts.length}品 / チェック済 {checkedIts.length}品
                      </span>
                    </div>

                    {/* 商品行 */}
                    <div style={{ padding: "4px 0" }}>
                      {allIts.map(it => {
                        const rem     = remaining(it)
                        const isDone  = rem === 0
                        const isChk   = checked.has(it.id)
                        const recvQty = receiveQty(it)

                        return (
                          <div key={it.id} style={{
                            display: "flex", alignItems: "center", gap: 12,
                            padding: "10px 18px",
                            borderBottom: "1px solid #f3f4f6",
                            background: isDone ? "#f0fdf4"
                              : isChk ? "#f0fdf9"
                              : "transparent",
                          }}>
                            {/* チェックボックス */}
                            <label style={{
                              display: "flex", alignItems: "center",
                              cursor: isDone ? "default" : "pointer",
                              flexShrink: 0,
                            }}>
                              <input
                                type="checkbox"
                                checked={isDone || isChk}
                                disabled={isDone}
                                onChange={() => !isDone && toggleItem(it.id)}
                                style={{ width: 18, height: 18, cursor: isDone ? "default" : "pointer" }}
                              />
                            </label>

                            {/* 商品名 */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{
                                fontSize: 14, fontWeight: isDone ? 400 : 600,
                                color: isDone ? "#9ca3af" : "#111827",
                              }}>
                                {it.product_name || "(商品名なし)"}
                              </div>
                              {it.note && (
                                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1 }}>{it.note}</div>
                              )}
                            </div>

                            {/* 発注数 */}
                            <div style={{ textAlign: "center", flexShrink: 0, minWidth: 60 }}>
                              <div style={{ fontSize: 11, color: "#9ca3af" }}>発注数</div>
                              <div style={{ fontSize: 14, fontWeight: 600 }}>{it.quantity}</div>
                            </div>

                            {/* 入荷済 */}
                            <div style={{ textAlign: "center", flexShrink: 0, minWidth: 60 }}>
                              <div style={{ fontSize: 11, color: "#9ca3af" }}>入荷済</div>
                              <div style={{ fontSize: 14, color: "#6b7280" }}>
                                {Number(it.received_quantity || 0) > 0 ? Number(it.received_quantity) : "—"}
                              </div>
                            </div>

                            {/* 残数 */}
                            <div style={{ textAlign: "center", flexShrink: 0, minWidth: 60 }}>
                              <div style={{ fontSize: 11, color: "#9ca3af" }}>残数</div>
                              <div style={{
                                fontSize: 14, fontWeight: 700,
                                color: isDone ? "#15803d" : "#b91c1c",
                              }}>
                                {isDone ? "✅" : rem}
                              </div>
                            </div>

                            {/* 今回入荷数（チェック時のみ編集可） */}
                            <div style={{ textAlign: "center", flexShrink: 0, minWidth: 90 }}>
                              <div style={{ fontSize: 11, color: "#9ca3af" }}>今回入荷数</div>
                              {isDone ? (
                                <div style={{ fontSize: 13, color: "#15803d", fontWeight: 600 }}>入荷済</div>
                              ) : isChk ? (
                                <input
                                  type="number"
                                  value={recvQty}
                                  min={1}
                                  max={rem}
                                  onChange={e => {
                                    const v = Math.min(rem, Math.max(1, Number(e.target.value) || 1))
                                    setQtyOverride(prev => new Map(prev).set(it.id, v))
                                  }}
                                  style={{
                                    width: 70, textAlign: "center", padding: "5px 6px",
                                    border: "2px solid #059669", borderRadius: 8,
                                    fontSize: 15, fontWeight: 700, color: "#065f46",
                                    background: "#f0fdf4",
                                  }}
                                />
                              ) : (
                                <div style={{ fontSize: 13, color: "#d1d5db" }}>—</div>
                              )}
                            </div>

                            {/* 単価・小計 */}
                            {it.unit_price > 0 && (
                              <div style={{ textAlign: "right", flexShrink: 0, minWidth: 80 }}>
                                <div style={{ fontSize: 11, color: "#9ca3af" }}>
                                  {fmtYen(it.unit_price)}/個
                                </div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: isChk ? "#374151" : "#d1d5db" }}>
                                  {isChk && !isDone ? fmtYen(recvQty * Number(it.unit_price)) : "—"}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {/* フッター: 合計 + 入荷ボタン */}
                    <div style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "12px 18px",
                      background: "#f9fafb", borderTop: "1px solid #e5e7eb",
                      flexWrap: "wrap",
                    }}>
                      <div style={{ fontSize: 13, color: "#6b7280" }}>
                        {checkedIts.length > 0
                          ? <><strong style={{ color: "#059669" }}>{checkedIts.length}品</strong>を選択中
                            {checkedTotal > 0 && <> / 仕入合計 <strong style={{ color: "#111827" }}>{fmtYen(checkedTotal)}</strong></>}
                          </>
                          : "届いた商品にチェックを入れてください"}
                      </div>
                      <button
                        onClick={() => receiveChecked(po)}
                        disabled={isReceiving || checkedIts.length === 0}
                        style={{
                          marginLeft: "auto", padding: "9px 24px", borderRadius: 10, border: "none",
                          background: (isReceiving || checkedIts.length === 0) ? "#d1d5db" : "#059669",
                          color: "#fff", fontSize: 14, fontWeight: 800,
                          cursor: (isReceiving || checkedIts.length === 0) ? "not-allowed" : "pointer",
                        }}>
                        {isReceiving ? "処理中…" : checkedIts.length === 0 ? "商品を選択" : `✅ ${checkedIts.length}品を入荷処理する`}
                      </button>
                    </div>

                    {po.note && (
                      <div style={{ padding: "8px 18px 12px" }}>
                        <div style={{ padding: "6px 10px", background: "#fefce8", border: "1px solid #fde68a", borderRadius: 6, fontSize: 12, color: "#92400e" }}>
                          備考: {po.note}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── スタイル ─────────────────────────────────────────────
const btnGray: React.CSSProperties = {
  padding: "7px 14px", borderRadius: 8, border: "1px solid #d1d5db",
  background: "#fff", fontSize: 12, color: "#374151", cursor: "pointer", fontWeight: 600,
}
const btnBlue: React.CSSProperties = {
  padding: "7px 14px", borderRadius: 8, border: "1px solid #93c5fd",
  background: "#eff6ff", fontSize: 12, color: "#1e40af", cursor: "pointer", fontWeight: 700,
}
const btnOrange: React.CSSProperties = {
  padding: "7px 14px", borderRadius: 8, border: "1px solid #fdba74",
  background: "#fff7ed", fontSize: 12, color: "#9a3412", cursor: "pointer", fontWeight: 700,
}
