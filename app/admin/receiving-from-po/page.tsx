"use client"

// 発注書から入荷処理ページ
// 発注済みの発注書を選んで「全量入荷」ボタンを押すだけ。
// 商品名の手入力・PDF読取不要。在庫加算・入荷履歴・POステータス更新をすべて自動化。

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
  const [pos, setPos]           = useState<PO[]>([])
  const [poItems, setPoItems]   = useState<POItem[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<{ id: string; stock: number | null }[]>([])
  const [clinics, setClinics]   = useState<Clinic[]>([])
  const [orders, setOrders]     = useState<Order[]>([])
  const [orderItems, setOrderItems] = useState<{ order_id: string; product_id: string | null; quantity: number }[]>([])

  const [loading, setLoading]   = useState(true)
  const [receiving, setReceiving] = useState<Set<string>>(new Set())
  const [results, setResults]   = useState<ReceiveResult[]>([])
  const [expandedPos, setExpandedPos] = useState<Set<string>>(new Set())
  // 行ごとの受入数量オーバーライド（デフォルト = 発注残数）
  const [qtyOverride, setQtyOverride] = useState<Map<string, number>>(new Map())

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
    setPos((p.data as PO[]) || [])
    setPoItems((pi.data as POItem[]) || [])
    setSuppliers((s.data as Supplier[]) || [])
    setProducts((pr.data as { id: string; stock: number | null }[]) || [])
    setOrders((o.data as Order[]) || [])
    setOrderItems((oi.data as { order_id: string; product_id: string | null; quantity: number }[]) || [])
    setClinics((cl.data as Clinic[]) || [])
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

  // 発注残数（＝今回入荷すべき数量）
  function remaining(item: POItem) {
    return Math.max(0, Number(item.quantity) - Number(item.received_quantity || 0))
  }

  // 今回受け取る数量（オーバーライドがあればそれ、なければ残数）
  function receiveQty(item: POItem): number {
    return qtyOverride.has(item.id) ? qtyOverride.get(item.id)! : remaining(item)
  }

  // 入荷後に出荷可能になる注文を検索
  async function findNowShippable(receivedProductIds: string[]): Promise<{
    nowShippable: ReceiveResult["nowShippable"]; partiallyImpacted: number
  }> {
    if (receivedProductIds.length === 0) return { nowShippable: [], partiallyImpacted: 0 }
    // 最新在庫を再取得
    const { data: latestStocks } = await supabase.from("products").select("id,stock").in("id", receivedProductIds)
    const freshStock = new Map((latestStocks || []).map((p: any) => [p.id, Number(p.stock || 0)]))

    const pendingOrders = orders.filter(o => !["納品済み", "納品済", "キャンセル", "取消"].includes(o.status))
    const pendingOrderIds = new Set(pendingOrders.map(o => o.id))

    // 入庫商品を含む注文に絞り込み
    const affectedOrderIds = new Set(
      orderItems
        .filter(oi => pendingOrderIds.has(oi.order_id) && oi.product_id && receivedProductIds.includes(oi.product_id))
        .map(oi => oi.order_id)
    )

    // 全商品の最新在庫（既存 stockById + 今回更新分をマージ）
    const allStockMap = new Map(stockById)
    freshStock.forEach((v, k) => allStockMap.set(k, v))

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
      } else {
        partiallyImpacted++
      }
    }
    return { nowShippable, partiallyImpacted }
  }

  // ─── 1件の発注書を入荷処理 ──────────────────────────────
  async function receiveAll(po: PO) {
    if (receiving.has(po.id)) return
    const its  = (itemsByPo.get(po.id) || []).filter(it => receiveQty(it) > 0)
    if (its.length === 0) { alert("入荷する商品がありません（すべて受入済または数量0）"); return }

    const totalAmt = its.reduce((s, it) => s + receiveQty(it) * Number(it.unit_price || 0), 0)
    const supplierName = po.supplier_id ? (supplierById.get(po.supplier_id)?.name || "不明") : "仕入先未設定"
    if (!confirm(
      `【${supplierName}】${po.po_number || po.id.slice(0, 8)}\n\n`
      + its.map(it => `  ${it.product_name}  ×${receiveQty(it)}`).join("\n")
      + `\n\n合計 ${fmtYen(totalAmt)} を入荷処理します。よろしいですか？`
    )) return

    setReceiving(prev => new Set([...prev, po.id]))
    const receivedProductIds: string[] = []

    try {
      for (const it of its) {
        const qty  = receiveQty(it)
        const diff = qty   // receiveQty はすでに残数ベース
        const newReceived = Number(it.received_quantity || 0) + diff

        // 1. received_quantity 更新
        await supabase.from("purchase_order_items")
          .update({ received_quantity: newReceived })
          .eq("id", it.id)

        // 2. 在庫加算
        if (it.product_id && diff > 0) {
          const before = Number(stockById.get(it.product_id) || 0)
          const after  = before + diff
          await supabase.from("products").update({ stock: after }).eq("id", it.product_id)
          try {
            await supabase.from("stock_movements").insert({
              product_id:    it.product_id,
              movement_type: "入庫",
              quantity:      diff,
              before_stock:  before,
              after_stock:   after,
              ref_type:      "purchase_order_item",
              ref_id:        it.id,
              reason:        `発注書 ${po.po_number || po.id.slice(0, 8)} 入荷`,
            })
          } catch { /* テーブル未作成はスキップ */ }
          // stock_receipts にも記録
          try {
            await supabase.from("stock_receipts").insert({
              product_id: it.product_id,
              quantity:   diff,
              supplier_id: po.supplier_id,
              unit_price: it.unit_price || null,
              memo:       `発注書 ${po.po_number || po.id.slice(0, 8)}`,
            })
          } catch { /* テーブル未作成はスキップ */ }
          receivedProductIds.push(it.product_id)
          // ローカル在庫マップも更新（findNowShippable で使う）
          stockById.set(it.product_id, Number(stockById.get(it.product_id) || 0) + diff)
        }
      }

      // 3. PO ステータス更新
      const allItems = itemsByPo.get(po.id) || []
      const updatedItems = allItems.map(i => ({
        ...i,
        received_quantity: its.find(x => x.id === i.id)
          ? Number(i.received_quantity || 0) + receiveQty(i)
          : Number(i.received_quantity || 0),
      }))
      const allDone = updatedItems.every(i => Number(i.received_quantity) >= Number(i.quantity))
      await supabase.from("purchase_orders")
        .update({ status: allDone ? "入荷済" : "部分入荷" })
        .eq("id", po.id)

      // 4. 出荷可能注文を検索
      const { nowShippable, partiallyImpacted } = await findNowShippable(receivedProductIds)

      setResults(prev => [{
        poId: po.id, poNumber: po.po_number || po.id.slice(0, 8), supplierName,
        receivedItems: its.length, totalAmount: totalAmt,
        nowShippable, partiallyImpacted, error: null,
      }, ...prev])

      // PO をリストから除去（入荷済になった場合）
      if (allDone) setPos(prev => prev.filter(p => p.id !== po.id))
      else {
        // 部分入荷 → poItems の received_quantity を更新
        setPoItems(prev => prev.map(i => {
          const hit = its.find(x => x.id === i.id)
          return hit ? { ...i, received_quantity: Number(i.received_quantity || 0) + receiveQty(i) } : i
        }))
      }
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

  function toggleExpand(poId: string) {
    setExpandedPos(prev => {
      const n = new Set(prev); n.has(poId) ? n.delete(poId) : n.add(poId); return n
    })
  }

  if (loading) return (
    <div style={{ textAlign: "center", padding: 60, color: "#9ca3af" }}>
      <div style={{ fontSize: 32 }}>⏳</div>読み込み中…
    </div>
  )

  return (
    <div style={{ maxWidth: 820 }}>

      {/* ─── ヘッダー ───────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: 0 }}>
              📦 発注書から入荷処理
            </h1>
            <p style={{ fontSize: 12, color: "#6b7280", margin: "4px 0 0" }}>
              発注書の商品が届いたら「全量入荷」を押すだけ — 手入力・PDF読取不要
            </p>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/admin/receiving"><button style={btnGray}>✏️ 手動入力・PDF読取</button></Link>
            <Link href="/admin/purchase-orders"><button style={btnGray}>📋 発注書一覧</button></Link>
            <Link href="/admin/shipping"><button style={btnBlue}>🚚 出荷準備</button></Link>
          </div>
        </div>

        {/* 使い方バナー */}
        <div style={{
          marginTop: 16, padding: "12px 16px",
          background: "#eff6ff", border: "2px solid #93c5fd", borderRadius: 12,
          fontSize: 13, color: "#1e40af", lineHeight: 1.8,
        }}>
          <strong>💡 使い方：</strong>
          発注済みの発注書が一覧表示されます。
          商品が届いたら発注書を選んで <strong>「全量入荷」</strong> を押すだけ。
          在庫が自動で増え、出荷可能になった注文が即座に通知されます。<br />
          数量が少ない・多い場合は ▼ を押して行ごとに調整できます。
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
                <span style={{ fontSize: 14, fontWeight: 700 }}>
                  {r.supplierName} / {r.poNumber}
                </span>
                {!r.error && (
                  <span style={{ fontSize: 12, color: "#15803d" }}>
                    {r.receivedItems}品を入荷 — {fmtYen(r.totalAmount)}
                  </span>
                )}
                <button onClick={() => setResults(prev => prev.filter((_, j) => j !== i))}
                  style={{ marginLeft: "auto", fontSize: 12, color: "#9ca3af", background: "none", border: "none", cursor: "pointer" }}>✕</button>
              </div>
              {r.error && <div style={{ fontSize: 12, color: "#dc2626", marginTop: 6 }}>エラー: {r.error}</div>}
              {!r.error && r.nowShippable.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#15803d", marginBottom: 6 }}>
                    🚚 これで出荷可能になった注文 {r.nowShippable.length}件
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {r.nowShippable.map((o, j) => (
                      <div key={j} style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "6px 10px", background: "#fff", borderRadius: 8,
                        border: "1px solid #d1fae5", fontSize: 13,
                      }}>
                        <span style={{ fontWeight: 700 }}>{o.clinicName}</span>
                        <span style={{ color: "#6b7280", fontSize: 12 }}>{o.deliveryNumber}</span>
                        <span style={{ marginLeft: "auto", fontWeight: 700 }}>{fmtYen(o.totalPrice)}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Link href={`/admin/shipping?orders=${r.nowShippable.map(o => o.orderId).join(",")}`}>
                      <button style={{ ...btnBlue, padding: "8px 16px", fontSize: 13 }}>
                        🚚 出荷準備へ（{r.nowShippable.length}件）
                      </button>
                    </Link>
                    <Link href="/admin/orders/process">
                      <button style={{ ...btnGray, padding: "8px 16px", fontSize: 13 }}>
                        📥 受注処理へ
                      </button>
                    </Link>
                  </div>
                </div>
              )}
              {!r.error && r.partiallyImpacted > 0 && (
                <div style={{ fontSize: 12, color: "#b45309", marginTop: 6 }}>
                  ⚠ まだ他の品が不足している注文: {r.partiallyImpacted}件（追加入荷待ち）
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
          <div style={{ fontSize: 12, color: "#16a34a", marginTop: 4 }}>すべての発注書が入荷済みです</div>
          <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "center" }}>
            <Link href="/admin/purchase-orders"><button style={btnGray}>📋 発注書一覧</button></Link>
            <Link href="/admin/purchase-orders/pool"><button style={btnOrange}>📦 発注プール</button></Link>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {pos.map(po => {
            const its         = itemsByPo.get(po.id) || []
            const hasRemaining = its.some(it => remaining(it) > 0)
            const totalRemAmt  = its.reduce((s, it) => s + receiveQty(it) * Number(it.unit_price || 0), 0)
            const supplierName = po.supplier_id ? (supplierById.get(po.supplier_id)?.name || "仕入先不明") : "仕入先未設定"
            const isReceiving  = receiving.has(po.id)
            const expanded     = expandedPos.has(po.id)
            const isPartial    = po.status === "部分入荷"

            return (
              <div key={po.id} style={{
                background: "#fff",
                border: `2px solid ${isPartial ? "#fde68a" : "#e5e7eb"}`,
                borderRadius: 14, overflow: "hidden",
              }}>
                {/* カードヘッダー */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "14px 18px",
                  background: isPartial ? "#fefce8" : "#f9fafb",
                  borderBottom: expanded ? `1px solid ${isPartial ? "#fde68a" : "#e5e7eb"}` : "none",
                  flexWrap: "wrap",
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{
                        fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                        background: isPartial ? "#fde68a" : "#dbeafe",
                        color: isPartial ? "#92400e" : "#1e40af",
                      }}>
                        {isPartial ? "⚠ 部分入荷" : "📬 入荷待ち"}
                      </span>
                      <span style={{ fontSize: 15, fontWeight: 800, color: "#111827" }}>{supplierName}</span>
                      <span style={{ fontSize: 12, color: "#9ca3af" }}>
                        {po.po_number || po.id.slice(0, 8)}
                        {po.ordered_at && ` — 発注日 ${new Date(po.ordered_at).toLocaleDateString("ja-JP")}`}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                      {its.length}品
                      {isPartial && ` — うち未入荷 ${its.filter(it => remaining(it) > 0).length}品`}
                      {totalRemAmt > 0 && ` — 仕入額 ${fmtYen(totalRemAmt)}`}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center" }}>
                    <button
                      onClick={() => toggleExpand(po.id)}
                      style={{ ...btnGray, fontSize: 12, padding: "6px 12px" }}>
                      {expanded ? "▲ 閉じる" : "▼ 明細確認"}
                    </button>
                    {hasRemaining && (
                      <button
                        onClick={() => receiveAll(po)}
                        disabled={isReceiving}
                        style={{
                          padding: "10px 20px", borderRadius: 10, border: "none",
                          background: isReceiving ? "#d1d5db" : "#059669",
                          color: "#fff", fontSize: 14, fontWeight: 800,
                          cursor: isReceiving ? "not-allowed" : "pointer", whiteSpace: "nowrap",
                        }}>
                        {isReceiving ? "処理中…" : `✅ 全量入荷 (${its.filter(it => receiveQty(it) > 0).length}品)`}
                      </button>
                    )}
                    {!hasRemaining && (
                      <span style={{ fontSize: 12, color: "#15803d", fontWeight: 700 }}>✅ 全量入荷済み</span>
                    )}
                  </div>
                </div>

                {/* 明細テーブル（展開時のみ） */}
                {expanded && (
                  <div style={{ padding: "12px 18px" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: "2px solid #f3f4f6" }}>
                          <th style={thStyle}>商品名</th>
                          <th style={{ ...thStyle, textAlign: "right", width: 70 }}>発注数</th>
                          <th style={{ ...thStyle, textAlign: "right", width: 70 }}>入荷済</th>
                          <th style={{ ...thStyle, textAlign: "right", width: 70 }}>残数</th>
                          <th style={{ ...thStyle, textAlign: "right", width: 80 }}>今回入荷数</th>
                          <th style={{ ...thStyle, textAlign: "right", width: 80 }}>単価</th>
                          <th style={{ ...thStyle, textAlign: "right", width: 90 }}>小計</th>
                        </tr>
                      </thead>
                      <tbody>
                        {its.map(it => {
                          const rem     = remaining(it)
                          const recvQty = receiveQty(it)
                          const done    = rem === 0
                          return (
                            <tr key={it.id} style={{
                              borderBottom: "1px solid #f9fafb",
                              background: done ? "#f0fdf4" : rem > 0 ? "transparent" : "#fff5f5",
                            }}>
                              <td style={{ padding: "7px 6px", color: done ? "#6b7280" : "#111827" }}>
                                {it.product_name || "(商品名なし)"}
                                {it.note && <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 6 }}>{it.note}</span>}
                              </td>
                              <td style={{ padding: "7px 6px", textAlign: "right", color: "#374151" }}>{it.quantity}</td>
                              <td style={{ padding: "7px 6px", textAlign: "right", color: "#6b7280" }}>
                                {Number(it.received_quantity || 0) > 0 ? Number(it.received_quantity) : "—"}
                              </td>
                              <td style={{
                                padding: "7px 6px", textAlign: "right", fontWeight: 700,
                                color: rem > 0 ? "#b91c1c" : "#15803d",
                              }}>
                                {rem > 0 ? rem : "✅"}
                              </td>
                              <td style={{ padding: "7px 6px", textAlign: "right" }}>
                                {rem > 0 ? (
                                  <input
                                    type="number"
                                    value={recvQty}
                                    min={0}
                                    max={rem}
                                    onChange={e => {
                                      const v = Math.min(rem, Math.max(0, Number(e.target.value)))
                                      setQtyOverride(prev => new Map(prev).set(it.id, v))
                                    }}
                                    style={{
                                      width: 64, textAlign: "right", padding: "4px 6px",
                                      border: "2px solid #059669", borderRadius: 6,
                                      fontSize: 13, fontWeight: 700, color: "#065f46",
                                    }}
                                  />
                                ) : (
                                  <span style={{ color: "#9ca3af" }}>—</span>
                                )}
                              </td>
                              <td style={{ padding: "7px 6px", textAlign: "right", color: "#6b7280" }}>
                                {it.unit_price > 0 ? fmtYen(it.unit_price) : "—"}
                              </td>
                              <td style={{ padding: "7px 6px", textAlign: "right", fontWeight: 600 }}>
                                {recvQty > 0 && it.unit_price > 0 ? fmtYen(recvQty * Number(it.unit_price)) : "—"}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      {its.length > 0 && (
                        <tfoot>
                          <tr style={{ borderTop: "2px solid #e5e7eb", background: "#f9fafb" }}>
                            <td colSpan={6} style={{ padding: "8px 6px", textAlign: "right", fontSize: 13, color: "#374151", fontWeight: 700 }}>今回入荷合計</td>
                            <td style={{ padding: "8px 6px", textAlign: "right", fontSize: 14, fontWeight: 800, color: "#111827" }}>
                              {fmtYen(totalRemAmt)}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                    {po.note && (
                      <div style={{ marginTop: 8, padding: "6px 10px", background: "#fefce8", border: "1px solid #fde68a", borderRadius: 6, fontSize: 12, color: "#92400e" }}>
                        備考: {po.note}
                      </div>
                    )}
                    {hasRemaining && (
                      <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
                        <button
                          onClick={() => receiveAll(po)}
                          disabled={isReceiving}
                          style={{
                            padding: "9px 24px", borderRadius: 10, border: "none",
                            background: isReceiving ? "#d1d5db" : "#059669",
                            color: "#fff", fontSize: 14, fontWeight: 800,
                            cursor: isReceiving ? "not-allowed" : "pointer",
                          }}>
                          {isReceiving ? "処理中…" : `✅ 上記の数量で入荷処理する`}
                        </button>
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
const thStyle: React.CSSProperties = {
  textAlign: "left", padding: "4px 6px",
  fontSize: 11, color: "#9ca3af", fontWeight: 600,
}
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
