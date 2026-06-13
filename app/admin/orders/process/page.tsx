"use client"

// 受注処理ページ（分割納品対応版）
// ・全商品在庫あり + 売上モードON → 納品済み + 請求書 + 在庫減算
// ・一部在庫あり  + 売上モードON → 注文を分割:
//     在庫あり分 → 新規注文（納品済み）+ 請求書 + 在庫減算 + 納品書印刷可
//     在庫不足分 → 元注文（準備中）+ 発注プール
// ・全在庫不足 or 売上モードOFF → 準備中 + 発注プール

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { poolFromOrders } from "@/lib/po-pool"
import { fmtYen, calcTax, generateInvoiceNumber, calcDueDate } from "@/lib/invoice"
import Link from "next/link"

// ─── 型定義 ───────────────────────────────────────────────
type Order = {
  id: string; clinic_id: string; status: string
  created_at: string; total_price: number
  delivery_number: string | null; source: string | null; note: string | null
}
type OrderItem = {
  id: string; order_id: string; product_id: string | null
  product_name: string | null; quantity: number; price: number
}
type Product  = { id: string; name: string; stock: number | null }
type Clinic   = { id: string; name: string; corporate_name: string | null }

type ProcessResult = {
  orderId: string; clinicName: string
  inStockCount: number; shortCount: number
  invoiceNumber: string | null
  newOrderId: string | null
  poolAdded: { supplier_name: string; added_items: number }[]
  skippedNoSupplier: number
  mode: "sold" | "split" | "prepared"
  error: string | null
}

// ─── カラー定数 ───────────────────────────────────────────
const C = {
  green:  { bg: "#dcfce7", color: "#15803d", border: "#86efac" },
  red:    { bg: "#fee2e2", color: "#b91c1c", border: "#fca5a5" },
  yellow: { bg: "#fef3c7", color: "#92400e", border: "#fde68a" },
  blue:   { bg: "#dbeafe", color: "#1e40af", border: "#93c5fd" },
  orange: { bg: "#fff7ed", color: "#9a3412", border: "#fdba74" },
  purple: { bg: "#f5f3ff", color: "#6d28d9", border: "#c4b5fd" },
  teal:   { bg: "#f0fdfa", color: "#0f766e", border: "#5eead4" },
}

export default function OrderProcessPage() {
  const [orders, setOrders]         = useState<Order[]>([])
  const [items, setItems]           = useState<OrderItem[]>([])
  const [products, setProducts]     = useState<Product[]>([])
  const [clinics, setClinics]       = useState<Clinic[]>([])
  const [loading, setLoading]       = useState(true)
  const [processing, setProcessing] = useState<Set<string>>(new Set())
  const [results, setResults]       = useState<ProcessResult[]>([])
  const [showResult, setShowResult] = useState(false)
  const [processingAll, setProcessingAll] = useState(false)
  const [sellMode, setSellMode]     = useState(true)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [o, i, p, c] = await Promise.all([
      supabase.from("orders")
        .select("id,clinic_id,status,created_at,total_price,delivery_number,source,note")
        .in("status", ["注文受付", "確認中"])
        .order("created_at", { ascending: true })
        .limit(200),
      supabase.from("order_items").select("id,order_id,product_id,product_name,quantity,price").limit(50000),
      supabase.from("products").select("id,name,stock").limit(50000),
      supabase.from("clinics").select("id,name,corporate_name").limit(50000),
    ])
    setOrders((o.data as Order[]) || [])
    setItems((i.data as OrderItem[]) || [])
    setProducts((p.data as Product[]) || [])
    setClinics((c.data as Clinic[]) || [])
    setLoading(false)
  }

  const productById  = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const clinicById   = useMemo(() => new Map(clinics.map(c => [c.id, c])), [clinics])
  const itemsByOrder = useMemo(() => {
    const m = new Map<string, OrderItem[]>()
    for (const it of items) {
      if (!m.has(it.order_id)) m.set(it.order_id, [])
      m.get(it.order_id)!.push(it)
    }
    return m
  }, [items])

  function stockStatus(item: OrderItem) {
    const p = item.product_id ? productById.get(item.product_id) : null
    const stock = Number(p?.stock || 0)
    const need  = Number(item.quantity || 0)
    return { ok: stock >= need, stock, short: Math.max(0, need - stock) }
  }
  function orderStockSummary(orderId: string) {
    const its = itemsByOrder.get(orderId) || []
    let inStock = 0, short = 0
    for (const it of its) { stockStatus(it).ok ? inStock++ : short++ }
    return { inStock, short, total: its.length }
  }

  // ─── 在庫減算 ─────────────────────────────────────────
  async function deductStock(orderItems: OrderItem[]) {
    for (const it of orderItems) {
      if (!it.product_id) continue
      const prod = productById.get(it.product_id)
      const newStock = Number(prod?.stock || 0) - Number(it.quantity)
      await supabase.from("products").update({ stock: newStock }).eq("id", it.product_id)
    }
  }

  // ─── 請求書作成 ────────────────────────────────────────
  async function createInvoiceForOrder(
    order: { id: string; clinic_id: string; delivery_number: string | null },
    its: OrderItem[]
  ): Promise<{ invoiceId: string; invoiceNumber: string }> {
    const subtotal = its.reduce((s, it) => s + Number(it.price || 0) * Number(it.quantity || 0), 0)
    const tax      = calcTax(subtotal)
    const total    = subtotal + tax
    const now      = new Date()
    const invoice_number = await generateInvoiceNumber(now)
    const { data: inv, error: ie } = await supabase.from("invoices").insert({
      clinic_id:      order.clinic_id,
      invoice_number,
      issue_date:     now.toISOString().slice(0, 10),
      due_date:       calcDueDate(now),
      subtotal, tax, total,
      status:        "issued",
      notes:         `注文 ${order.delivery_number || order.id.slice(0, 8)} より自動作成`,
    }).select().single()
    if (ie || !inv) throw new Error("請求書作成失敗: " + (ie?.message || ""))
    return { invoiceId: inv.id as string, invoiceNumber: invoice_number }
  }

  // ─── 分割納品 ──────────────────────────────────────────
  // 在庫あり品 → 新規注文（納品済み）＋請求書＋在庫減算
  // 在庫不足品 → 元注文（準備中）＋発注プール
  async function splitAndDeliver(
    order: Order,
    its: OrderItem[]
  ): Promise<{ invoiceNumber: string; newOrderId: string; poolAdded: ProcessResult["poolAdded"]; skippedNoSupplier: number }> {
    const inStockItems = its.filter(it => stockStatus(it).ok)
    const shortItems   = its.filter(it => !stockStatus(it).ok)

    // 1. 在庫あり品用の新規注文を作成
    const inStockSubtotal = inStockItems.reduce((s, it) => s + Number(it.price || 0) * Number(it.quantity || 0), 0)
    const now = new Date()
    const { data: newOrder, error: noe } = await supabase.from("orders").insert({
      clinic_id:       order.clinic_id,
      status:          "納品済み",
      total_price:     inStockSubtotal,
      delivery_number: (order.delivery_number || order.id.slice(0, 8)) + "-A",
      source:          order.source,
      note:            `${order.note ? order.note + " " : ""}（分割納品：在庫あり分）`,
      delivered_at:    now.toISOString(),
    }).select().single()
    if (noe || !newOrder) throw new Error("分割注文作成失敗: " + noe?.message)

    // 2. 在庫あり品の order_items を新注文へ移動
    const { error: mve } = await supabase.from("order_items")
      .update({ order_id: newOrder.id })
      .in("id", inStockItems.map(it => it.id))
    if (mve) throw new Error("明細移動失敗: " + mve.message)

    // 3. 請求書を作成して新注文に紐付け
    const { invoiceId, invoiceNumber } = await createInvoiceForOrder(newOrder, inStockItems)
    await supabase.from("orders").update({ invoice_id: invoiceId }).eq("id", newOrder.id)

    // 4. 在庫を減算
    await deductStock(inStockItems)

    // 5. 元注文を在庫不足品のみ「準備中」に更新
    const shortSubtotal = shortItems.reduce((s, it) => s + Number(it.price || 0) * Number(it.quantity || 0), 0)
    await supabase.from("orders").update({
      status:      "準備中",
      total_price: shortSubtotal,
      note:        `${order.note ? order.note + " " : ""}（分割納品：発注待ち分）`,
    }).eq("id", order.id)

    // 6. 在庫不足分を発注プールへ
    let poolAdded: ProcessResult["poolAdded"] = []
    let skippedNoSupplier = 0
    if (shortItems.length > 0) {
      const r = await poolFromOrders([order.id])
      poolAdded = r.pos.map(p => ({ supplier_name: p.supplier_name, added_items: p.added_items }))
      skippedNoSupplier = r.skippedNoSupplier
    }

    return { invoiceNumber, newOrderId: newOrder.id, poolAdded, skippedNoSupplier }
  }

  // ─── 1件処理 ────────────────────────────────────────────
  async function processOrder(order: Order) {
    if (processing.has(order.id)) return
    setProcessing(prev => new Set([...prev, order.id]))

    try {
      const clinicName = clinicById.get(order.clinic_id)?.name || "(不明)"
      const summary    = orderStockSummary(order.id)
      const its        = itemsByOrder.get(order.id) || []
      const allInStock = summary.short === 0 && summary.total > 0
      const hasInStock = summary.inStock > 0
      const hasShort   = summary.short > 0

      let invoiceNumber: string | null = null
      let newOrderId: string | null = null
      let poolAdded: ProcessResult["poolAdded"] = []
      let skippedNoSupplier = 0
      let mode: ProcessResult["mode"] = "prepared"

      if (sellMode && allInStock) {
        // ── 全在庫あり → 納品済み + 請求書 + 在庫減算 ──
        const res = await createInvoiceForOrder(order, its)
        invoiceNumber = res.invoiceNumber
        await supabase.from("orders").update({
          status:       "納品済み",
          delivered_at: new Date().toISOString(),
          invoice_id:   res.invoiceId,
        }).eq("id", order.id)
        await deductStock(its)
        mode = "sold"

      } else if (sellMode && hasInStock && hasShort) {
        // ── 一部在庫あり → 分割納品 ─────────────────
        const res = await splitAndDeliver(order, its)
        invoiceNumber     = res.invoiceNumber
        newOrderId        = res.newOrderId
        poolAdded         = res.poolAdded
        skippedNoSupplier = res.skippedNoSupplier
        mode = "split"

      } else {
        // ── 準備中 + 発注プール ───────────────────────
        await supabase.from("orders").update({ status: "準備中" }).eq("id", order.id)
        if (hasShort) {
          const r = await poolFromOrders([order.id])
          poolAdded = r.pos.map(p => ({ supplier_name: p.supplier_name, added_items: p.added_items }))
          skippedNoSupplier = r.skippedNoSupplier
        }
        mode = "prepared"
      }

      setResults(prev => [...prev, {
        orderId: order.id, clinicName,
        inStockCount: summary.inStock, shortCount: summary.short,
        invoiceNumber, newOrderId, poolAdded, skippedNoSupplier, mode, error: null,
      }])
      setShowResult(true)
      setOrders(prev => prev.filter(o => o.id !== order.id))

    } catch (e) {
      setResults(prev => [...prev, {
        orderId: order.id,
        clinicName: clinicById.get(order.clinic_id)?.name || "(不明)",
        inStockCount: 0, shortCount: 0,
        invoiceNumber: null, newOrderId: null, poolAdded: [], skippedNoSupplier: 0,
        mode: "prepared", error: (e as Error).message,
      }])
      setShowResult(true)
    } finally {
      setProcessing(prev => { const n = new Set(prev); n.delete(order.id); return n })
    }
  }

  async function processAll() {
    if (orders.length === 0) return
    const allInCount   = orders.filter(o => { const s = orderStockSummary(o.id); return s.short === 0 }).length
    const partialCount = orders.filter(o => { const s = orderStockSummary(o.id); return s.inStock > 0 && s.short > 0 }).length
    const shortOnlyCount = orders.filter(o => { const s = orderStockSummary(o.id); return s.inStock === 0 }).length
    const msg = sellMode
      ? `新着注文 ${orders.length}件 をまとめて処理します。\n\n`
        + (allInCount > 0      ? `💰 全在庫あり ${allInCount}件 → 納品済み＋請求書\n` : "")
        + (partialCount > 0    ? `📦 一部在庫あり ${partialCount}件 → 分割（在庫あり分を即納品）\n` : "")
        + (shortOnlyCount > 0  ? `⚠️ 全在庫なし ${shortOnlyCount}件 → 準備中＋発注プール\n` : "")
        + "\nよろしいですか？"
      : `新着注文 ${orders.length}件 をまとめて「準備中」にします。\nよろしいですか？`
    if (!confirm(msg)) return
    setProcessingAll(true)
    for (const order of [...orders]) { await processOrder(order) }
    setProcessingAll(false)
  }

  function clinicLabel(clinicId: string) {
    const c = clinicById.get(clinicId)
    return c?.corporate_name ? `${c.corporate_name} ${c.name}` : (c?.name || "(医院不明)")
  }
  function fmtDateTime(iso: string) {
    const d = new Date(iso)
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`
  }

  if (loading) return (
    <div style={{ textAlign: "center", padding: 60, color: "#9ca3af" }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>読み込み中…
    </div>
  )

  return (
    <div style={{ maxWidth: 860 }}>

      {/* ─── ヘッダー ──────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: 0 }}>📥 受注処理</h1>
          <p style={{ fontSize: 12, color: "#6b7280", margin: "2px 0 0" }}>
            在庫あり分は即座に納品書作成、不足分は発注後に後納品
          </p>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/admin/orders"><button style={btnGray}>注文一覧</button></Link>
          <Link href="/admin/deliveries"><button style={btnGray}>📋 納品書一覧</button></Link>
          <Link href="/admin/shipping"><button style={btnBlue}>🚚 出荷準備</button></Link>
          <Link href="/admin/invoices"><button style={btnPurple}>🧾 請求書一覧</button></Link>
          <Link href="/admin/purchase-orders/pool"><button style={btnOrange}>📦 発注プール</button></Link>
        </div>
      </div>

      {/* ─── 売上モード切替 ─────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        background: sellMode ? "#fdf4ff" : "#f9fafb",
        border: `2px solid ${sellMode ? "#d8b4fe" : "#e5e7eb"}`,
        borderRadius: 12, padding: "12px 18px", marginBottom: 18, flexWrap: "wrap",
      }}>
        <div style={{ fontSize: 22 }}>{sellMode ? "💰" : "📋"}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>
            {sellMode ? "売上処理モード（ON）" : "出荷準備モード"}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
            {sellMode
              ? "在庫あり品 → 即座に納品書＋請求書作成。一部在庫不足の注文も在庫あり分だけ先に納品"
              : "すべての注文を「準備中」にします（請求書・納品書は後で作成）"}
          </div>
        </div>
        <button
          onClick={() => setSellMode(v => !v)}
          style={{
            position: "relative", width: 52, height: 28,
            borderRadius: 14, border: "none", cursor: "pointer",
            background: sellMode ? "#9333ea" : "#d1d5db",
            transition: "background 0.2s", flexShrink: 0,
          }}>
          <span style={{
            position: "absolute", top: 3,
            left: sellMode ? 26 : 4,
            width: 22, height: 22, borderRadius: "50%",
            background: "#fff", transition: "left 0.2s",
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          }} />
        </button>
        <div style={{ fontSize: 12, color: sellMode ? "#7c3aed" : "#6b7280", fontWeight: 600 }}>
          {sellMode ? "ON" : "OFF"}
        </div>
      </div>

      {/* ─── 件数バナー ────────────────────────────── */}
      {orders.length > 0 ? (
        <div style={{
          display: "flex", alignItems: "center", gap: 16,
          background: "#fff7ed", border: "2px solid #fdba74",
          borderRadius: 12, padding: "14px 20px", marginBottom: 20, flexWrap: "wrap",
        }}>
          <div style={{ fontSize: 28 }}>📋</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#9a3412" }}>
              新着注文 {orders.length}件
            </div>
            <div style={{ fontSize: 12, color: "#c2410c", marginTop: 2 }}>
              {orders.filter(o => { const s = orderStockSummary(o.id); return s.short === 0 }).length}件：全在庫あり
              {" ／ "}
              {orders.filter(o => { const s = orderStockSummary(o.id); return s.inStock > 0 && s.short > 0 }).length}件：一部在庫不足（分割納品可）
              {" ／ "}
              {orders.filter(o => { const s = orderStockSummary(o.id); return s.inStock === 0 }).length}件：全在庫不足
            </div>
          </div>
          <button
            onClick={processAll}
            disabled={processingAll}
            style={{
              marginLeft: "auto", padding: "10px 20px",
              borderRadius: 10, border: "none",
              background: processingAll ? "#d1d5db" : "#ea580c",
              color: "#fff", fontSize: 14, fontWeight: 700,
              cursor: processingAll ? "not-allowed" : "pointer", whiteSpace: "nowrap",
            }}>
            {processingAll ? "処理中…" : `⚡ ${orders.length}件まとめて処理`}
          </button>
        </div>
      ) : (
        <div style={{
          textAlign: "center", padding: "48px 24px",
          background: "#f0fdf4", border: "2px solid #86efac",
          borderRadius: 16, marginBottom: 20,
        }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#15803d" }}>新着注文はありません</div>
          <div style={{ fontSize: 12, color: "#16a34a", marginTop: 4 }}>すべての受注が処理済みです</div>
          <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/admin/deliveries"><button style={btnGray}>📋 納品書一覧</button></Link>
            <Link href="/admin/shipping"><button style={btnBlue}>🚚 出荷準備を確認</button></Link>
            <Link href="/admin/invoices"><button style={btnPurple}>🧾 請求書一覧</button></Link>
            <Link href="/admin/purchase-orders/pool"><button style={btnOrange}>📦 発注プールを確認</button></Link>
          </div>
        </div>
      )}

      {/* ─── 注文カード ────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {orders.map(order => {
          const its     = itemsByOrder.get(order.id) || []
          const summary = orderStockSummary(order.id)
          const allIn   = summary.short === 0 && summary.total > 0
          const partial = summary.inStock > 0 && summary.short > 0
          const isProc  = processing.has(order.id)

          const predictMode = sellMode
            ? allIn ? "sold" : partial ? "split" : "prepared"
            : "prepared"

          const modeStyle = {
            sold:     { bg: "#faf5ff", border: "#d8b4fe", btnBg: "#9333ea",
                        badge: "💰 全品即納品", badgeC: "#7c3aed", badgeBg: "#e9d5ff" },
            split:    { bg: "#f0fdfa", border: "#5eead4", btnBg: "#0d9488",
                        badge: "📦 在庫あり分のみ先納品", badgeC: "#0f766e", badgeBg: "#ccfbf1" },
            prepared: { bg: "#f9fafb", border: "#e5e7eb", btnBg: "#059669",
                        badge: "", badgeC: "", badgeBg: "" },
          }[predictMode]

          return (
            <div key={order.id} style={{
              background: "#fff",
              border: `2px solid ${modeStyle.border}`,
              borderRadius: 14, overflow: "hidden",
              opacity: isProc ? 0.6 : 1,
            }}>
              {/* カードヘッダー */}
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "12px 16px", background: modeStyle.bg,
                borderBottom: `1px solid ${modeStyle.border}`, flexWrap: "wrap",
              }}>
                {modeStyle.badge && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                    background: modeStyle.badgeBg, color: modeStyle.badgeC,
                  }}>
                    {modeStyle.badge}
                  </span>
                )}
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                  ...(order.source === "admin" ? C.yellow : C.blue),
                }}>
                  {order.source === "admin" ? "📞 電話/口頭" : "🏥 Web注文"}
                </span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>
                  {clinicLabel(order.clinic_id)}
                </span>
                <span style={{ fontSize: 12, color: "#9ca3af" }}>{fmtDateTime(order.created_at)}</span>
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  {summary.inStock > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, ...C.green }}>
                      ✅ 在庫あり {summary.inStock}品
                    </span>
                  )}
                  {summary.short > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, ...C.red }}>
                      ❌ 在庫不足 {summary.short}品
                    </span>
                  )}
                </span>
              </div>

              {/* 商品明細 */}
              <div style={{ padding: "10px 16px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <th style={thStyle}>商品名</th>
                      <th style={{ ...thStyle, textAlign: "right", width: 50 }}>数量</th>
                      <th style={{ ...thStyle, textAlign: "right", width: 70 }}>単価</th>
                      <th style={{ ...thStyle, textAlign: "center", width: 120 }}>在庫状況</th>
                      {predictMode === "split" && (
                        <th style={{ ...thStyle, textAlign: "center", width: 70 }}>今回の処理</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {its.map(it => {
                      const st = stockStatus(it)
                      return (
                        <tr key={it.id} style={{
                          borderBottom: "1px solid #f9fafb",
                          background: predictMode === "split"
                            ? (st.ok ? "#f0fdf4" : "#fff5f5")
                            : "transparent",
                        }}>
                          <td style={{ padding: "6px 6px", color: "#111827" }}>{it.product_name || "(商品名なし)"}</td>
                          <td style={{ padding: "6px 6px", textAlign: "right", fontWeight: 600 }}>{it.quantity}</td>
                          <td style={{ padding: "6px 6px", textAlign: "right", color: "#6b7280" }}>
                            {it.price > 0 ? fmtYen(it.price) : "—"}
                          </td>
                          <td style={{ padding: "6px 6px", textAlign: "center" }}>
                            {st.ok
                              ? <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, ...C.green }}>✅ 在庫{st.stock}</span>
                              : <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, ...C.red }}>❌ {st.short}個不足</span>
                            }
                          </td>
                          {predictMode === "split" && (
                            <td style={{ padding: "6px 6px", textAlign: "center" }}>
                              {st.ok
                                ? <span style={{ fontSize: 11, fontWeight: 700, color: "#0f766e" }}>今回納品 →</span>
                                : <span style={{ fontSize: 11, fontWeight: 700, color: "#b91c1c" }}>発注後に納品</span>
                              }
                            </td>
                          )}
                        </tr>
                      )
                    })}
                    {its.length === 0 && (
                      <tr><td colSpan={5} style={{ padding: "12px 6px", textAlign: "center", color: "#9ca3af", fontSize: 12 }}>明細なし</td></tr>
                    )}
                  </tbody>
                </table>
                {order.note && (
                  <div style={{ marginTop: 8, padding: "6px 10px", background: "#fefce8", border: "1px solid #fde68a", borderRadius: 6, fontSize: 12, color: "#92400e" }}>
                    💬 {order.note}
                  </div>
                )}
              </div>

              {/* カードフッター */}
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 16px", background: modeStyle.bg,
                borderTop: `1px solid ${modeStyle.border}`, flexWrap: "wrap",
              }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  {predictMode === "sold"
                    ? "全商品が在庫あり → 納品済み・請求書・在庫減算を自動処理"
                    : predictMode === "split"
                    ? `在庫あり${summary.inStock}品を先に納品（納品書＋請求書作成）、在庫不足${summary.short}品は発注後に改めて納品`
                    : "「準備中」に変更・在庫不足分は発注プールへ"}
                </div>
                <button
                  onClick={() => processOrder(order)}
                  disabled={isProc}
                  style={{
                    marginLeft: "auto", padding: "8px 18px",
                    borderRadius: 8, border: "none",
                    background: isProc ? "#d1d5db" : modeStyle.btnBg,
                    color: "#fff", fontSize: 13, fontWeight: 700,
                    cursor: isProc ? "not-allowed" : "pointer", whiteSpace: "nowrap",
                  }}>
                  {isProc ? "処理中…"
                    : predictMode === "sold"    ? "💰 売上処理する →"
                    : predictMode === "split"   ? "📦 分割して納品する →"
                    : "この注文を処理する →"}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* ─── 処理結果モーダル ───────────────────────── */}
      {showResult && results.length > 0 && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 9999, padding: 16,
        }}>
          <div style={{
            background: "#fff", borderRadius: 16,
            maxWidth: 560, width: "100%", maxHeight: "80vh", overflowY: "auto",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            <div style={{
              padding: "16px 20px 12px", borderBottom: "1px solid #e5e7eb",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <span style={{ fontSize: 20 }}>✅</span>
              <span style={{ fontSize: 16, fontWeight: 800 }}>処理完了 {results.length}件</span>
            </div>

            <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              {results.map((r, i) => (
                <div key={i} style={{
                  padding: "12px 14px",
                  background: r.error ? "#fff5f5" : r.mode === "sold" ? "#faf5ff" : r.mode === "split" ? "#f0fdfa" : "#f9fafb",
                  border: `1px solid ${r.error ? "#fca5a5" : r.mode === "sold" ? "#d8b4fe" : r.mode === "split" ? "#5eead4" : "#e5e7eb"}`,
                  borderRadius: 10,
                }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
                    {r.error ? "❌" : r.mode === "sold" ? "💰" : r.mode === "split" ? "📦" : "🚚"} {r.clinicName}
                  </div>
                  {r.error ? (
                    <div style={{ fontSize: 12, color: "#dc2626" }}>エラー: {r.error}</div>
                  ) : (
                    <div style={{ fontSize: 12, color: "#374151", lineHeight: 2 }}>
                      {r.mode === "sold" && (
                        <>
                          <div>✅ 全{r.inStockCount}品 → <strong>納品済み</strong>（在庫減算・納品書作成済）</div>
                          {r.invoiceNumber && (
                            <div>🧾 請求書：<strong style={{ color: "#7c3aed" }}>{r.invoiceNumber}</strong></div>
                          )}
                        </>
                      )}
                      {r.mode === "split" && (
                        <>
                          <div>✅ 在庫あり <strong>{r.inStockCount}品</strong> → 新規注文（納品済み）に分割・在庫減算済</div>
                          {r.invoiceNumber && (
                            <div>🧾 請求書：<strong style={{ color: "#0f766e" }}>{r.invoiceNumber}</strong></div>
                          )}
                          <div>⚠️ 在庫不足 <strong>{r.shortCount}品</strong> → 元注文（準備中）に残し発注プールへ</div>
                          {r.poolAdded.map((p, j) => (
                            <span key={j} style={{ marginRight: 6, padding: "1px 6px", background: "#fff7ed", borderRadius: 4, fontSize: 11, color: "#9a3412" }}>
                              {p.supplier_name} {p.added_items}品
                            </span>
                          ))}
                          {r.skippedNoSupplier > 0 && (
                            <div style={{ color: "#b45309", marginTop: 2 }}>⚠️ 仕入先未設定 {r.skippedNoSupplier}品（商品マスタで設定を）</div>
                          )}
                        </>
                      )}
                      {r.mode === "prepared" && (
                        <>
                          {r.inStockCount > 0 && <div>🚚 在庫あり <strong>{r.inStockCount}品</strong> → 出荷準備へ</div>}
                          {r.shortCount > 0 && (
                            <div>📦 在庫不足 <strong>{r.shortCount}品</strong> → 発注プールへ
                              {r.poolAdded.map((p, j) => (
                                <span key={j} style={{ marginLeft: 6, padding: "1px 6px", background: "#fff7ed", borderRadius: 4, fontSize: 11, color: "#9a3412" }}>
                                  {p.supplier_name} {p.added_items}品
                                </span>
                              ))}
                            </div>
                          )}
                          {r.skippedNoSupplier > 0 && (
                            <div style={{ color: "#b45309" }}>⚠️ 仕入先未設定 {r.skippedNoSupplier}品</div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div style={{
              padding: "12px 20px 16px", borderTop: "1px solid #e5e7eb",
              display: "flex", gap: 10, flexWrap: "wrap",
            }}>
              {(results.some(r => r.mode === "sold" || r.mode === "split")) && (
                <Link href="/admin/deliveries">
                  <button style={{ ...btnGray, padding: "9px 18px" }}>📋 納品書一覧へ</button>
                </Link>
              )}
              {(results.some(r => r.mode === "sold" || r.mode === "split")) && (
                <Link href="/admin/invoices">
                  <button style={{ ...btnPurple, padding: "9px 18px" }}>🧾 請求書一覧へ</button>
                </Link>
              )}
              {results.some(r => r.mode === "prepared" && r.inStockCount > 0) && (
                <Link href="/admin/shipping">
                  <button style={{ ...btnBlue, padding: "9px 18px" }}>🚚 出荷準備へ</button>
                </Link>
              )}
              {results.some(r => r.poolAdded.length > 0) && (
                <Link href="/admin/purchase-orders/pool">
                  <button style={{ ...btnOrange, padding: "9px 18px" }}>📦 発注プールへ</button>
                </Link>
              )}
              <button
                onClick={() => { setShowResult(false); setResults([]) }}
                style={{ ...btnGray, marginLeft: "auto", padding: "9px 18px" }}>
                閉じる
              </button>
            </div>
          </div>
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
const btnPurple: React.CSSProperties = {
  padding: "7px 14px", borderRadius: 8, border: "1px solid #d8b4fe",
  background: "#faf5ff", fontSize: 12, color: "#7c3aed", cursor: "pointer", fontWeight: 700,
}
