"use client"

// 請求書チェック（仕入照合・納品漏れ・在庫辻褄）
// ① 仕入照合   : メーカー納品書 vs 仕入れ処理の突合
// ② 納品漏れ   : 在庫あり・出荷可能なのに未納品の注文
// ③ 在庫辻褄   : 仕入累計 − 納品累計 と 現在庫の差異

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"

type Tab = "receiving" | "delivery" | "stock"

// ── 型 ──────────────────────────────────────────────────
type Product     = { id: string; name: string; product_code: string | null; manufacturer: string | null; stock: number }
type Supplier    = { id: string; name: string }
type Receipt     = { id: string; product_id: string | null; supplier_id: string | null; quantity: number; unit_price: number | null; created_at: string; supplier_invoice_item_id: string | null }
type SuppInv     = { id: string; supplier_id: string | null; invoice_date: string | null; invoice_number: string | null; total_amount: number | null; status: string | null }
type SuppInvItem = { id: string; invoice_id: string; product_name: string | null; quantity: number | null; unit_price: number | null }
type Order       = { id: string; clinic_id: string; status: string; total_price: number; delivery_number: string | null; created_at: string }
type OrderItem   = { id: string; order_id: string; product_id: string | null; product_name: string | null; quantity: number; price: number }
type Clinic      = { id: string; name: string }

export default function AuditPage() {
  const [tab, setTab] = useState<Tab>("receiving")

  // 共通データ
  const [products,  setProducts]  = useState<Product[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [receipts,  setReceipts]  = useState<Receipt[]>([])
  const [suppInvs,  setSuppInvs]  = useState<SuppInv[]>([])
  const [suppItems, setSuppItems] = useState<SuppInvItem[]>([])
  const [orders,    setOrders]    = useState<Order[]>([])
  const [orderItems,setOrderItems]= useState<OrderItem[]>([])
  const [clinics,   setClinics]   = useState<Clinic[]>([])
  const [loading,   setLoading]   = useState(true)

  // フィルタ
  const [period, setPeriod] = useState("3")   // 直近N ヶ月
  const [search, setSearch] = useState("")

  useEffect(() => { load() }, [period])

  async function load() {
    setLoading(true)
    const since = new Date()
    since.setMonth(since.getMonth() - Number(period))
    const sinceStr = since.toISOString().slice(0, 10)

    const [p, s, r, si, sii, o, oi, cl] = await Promise.all([
      supabase.from("products").select("id,name,product_code,manufacturer,stock").limit(50000),
      supabase.from("suppliers").select("id,name").limit(1000),
      supabase.from("stock_receipts").select("*").gte("created_at", sinceStr).order("created_at", { ascending: false }).limit(50000),
      supabase.from("supplier_invoices").select("id,supplier_id,invoice_date,invoice_number,total_amount,status").gte("invoice_date", sinceStr).order("invoice_date", { ascending: false }).limit(10000),
      supabase.from("supplier_invoice_items").select("id,invoice_id,product_name,quantity,unit_price").limit(50000),
      supabase.from("orders").select("id,clinic_id,status,total_price,delivery_number,created_at").gte("created_at", sinceStr).limit(50000),
      supabase.from("order_items").select("id,order_id,product_id,product_name,quantity,price").limit(200000),
      supabase.from("clinics").select("id,name").limit(1000),
    ])
    setProducts((p.data as Product[]) || [])
    setSuppliers((s.data as Supplier[]) || [])
    setReceipts((r.data as Receipt[]) || [])
    setSuppInvs((si.data as SuppInv[]) || [])
    setSuppItems((sii.data as SuppInvItem[]) || [])
    setOrders((o.data as Order[]) || [])
    setOrderItems((oi.data as OrderItem[]) || [])
    setClinics((cl.data as Clinic[]) || [])
    setLoading(false)
  }

  const productMap  = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const supplierMap = useMemo(() => new Map(suppliers.map(s => [s.id, s])), [suppliers])
  const clinicMap   = useMemo(() => new Map(clinics.map(c => [c.id, c])), [clinics])

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ① 仕入照合
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const suppItemsByInv = useMemo(() => {
    const m = new Map<string, SuppInvItem[]>()
    for (const it of suppItems) {
      if (!m.has(it.invoice_id)) m.set(it.invoice_id, [])
      m.get(it.invoice_id)!.push(it)
    }
    return m
  }, [suppItems])

  // 請求書アイテムIDセット（stock_receipts に紐付き済み）
  const linkedItemIds = useMemo(() => new Set(receipts.map(r => r.supplier_invoice_item_id).filter(Boolean) as string[]), [receipts])

  // 未マッチ：請求書アイテムに仕入れ処理が紐付いていない
  const unmatchedInvItems = useMemo(() =>
    suppItems.filter(it => !linkedItemIds.has(it.id)),
  [suppItems, linkedItemIds])

  // 未紐付け：仕入れ処理に請求書アイテムが紐付いていない
  const unlinkedReceipts = useMemo(() =>
    receipts.filter(r => !r.supplier_invoice_item_id),
  [receipts])

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ② 納品漏れ（在庫あり → 出荷可能なのに未納品）
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const pendingOrders = useMemo(() =>
    orders.filter(o => !["納品済み","納品済","キャンセル","取消","完了"].includes(o.status)),
  [orders])

  const orderItemsByOrder = useMemo(() => {
    const m = new Map<string, OrderItem[]>()
    for (const it of orderItems) {
      if (!m.has(it.order_id)) m.set(it.order_id, [])
      m.get(it.order_id)!.push(it)
    }
    return m
  }, [orderItems])

  const pendingWithStock = useMemo(() => {
    return pendingOrders.map(o => {
      const its = orderItemsByOrder.get(o.id) || []
      const allInStock = its.every(it => {
        const p = it.product_id ? productMap.get(it.product_id) : undefined
        return p ? Number(p.stock || 0) >= Number(it.quantity || 0) : false
      })
      const someInStock = its.some(it => {
        const p = it.product_id ? productMap.get(it.product_id) : undefined
        return p ? Number(p.stock || 0) > 0 : false
      })
      return { order: o, items: its, allInStock, someInStock }
    })
  }, [pendingOrders, orderItemsByOrder, productMap])

  const shippable    = useMemo(() => pendingWithStock.filter(x => x.allInStock), [pendingWithStock])
  const partialStock = useMemo(() => pendingWithStock.filter(x => !x.allInStock && x.someInStock), [pendingWithStock])
  const noStock      = useMemo(() => pendingWithStock.filter(x => !x.someInStock), [pendingWithStock])

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ③ 在庫辻褄
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const deliveredOrderIds = useMemo(() =>
    new Set(orders.filter(o => ["納品済み","納品済","完了"].includes(o.status)).map(o => o.id)),
  [orders])

  // 仕入累計・納品累計を商品別に集計
  const stockAudit = useMemo(() => {
    const receiptMap = new Map<string, number>()   // product_id → 累計仕入数
    const delivMap   = new Map<string, number>()   // product_id → 累計納品数

    for (const r of receipts) {
      if (!r.product_id) continue
      receiptMap.set(r.product_id, (receiptMap.get(r.product_id) || 0) + Number(r.quantity || 0))
    }
    for (const it of orderItems) {
      if (!it.product_id || !deliveredOrderIds.has(it.order_id)) continue
      delivMap.set(it.product_id, (delivMap.get(it.product_id) || 0) + Number(it.quantity || 0))
    }

    const rows: {
      product: Product
      received: number
      delivered: number
      net: number       // 仕入 − 納品
      actual: number    // products.stock
      diff: number      // net − actual（≠ 0 なら辻褄が合わない）
    }[] = []

    const allIds = new Set([...receiptMap.keys(), ...delivMap.keys()])
    for (const pid of allIds) {
      const product = productMap.get(pid)
      if (!product) continue
      const received  = receiptMap.get(pid)  || 0
      const delivered = delivMap.get(pid)    || 0
      const net       = received - delivered
      const actual    = Number(product.stock || 0)
      const diff      = net - actual
      if (diff !== 0) rows.push({ product, received, delivered, net, actual, diff })
    }
    rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    return rows
  }, [receipts, orderItems, deliveredOrderIds, productMap])

  // ── サマリー ─────────────────────────────────────────
  const summary = useMemo(() => ({
    unmatchedInv:  unmatchedInvItems.length,
    unlinkedRcpt:  unlinkedReceipts.length,
    shippable:     shippable.length,
    stockDiff:     stockAudit.filter(r => Math.abs(r.diff) > 0).length,
  }), [unmatchedInvItems, unlinkedReceipts, shippable, stockAudit])

  const norm = (v: string) => v.toLowerCase().normalize("NFKC")

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* ヘッダー */}
      <div style={{ marginBottom: 16, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111", margin: 0 }}>📋 請求書チェック</h1>
          <p style={{ fontSize: 13, color: "#6b7280", margin: "4px 0 0" }}>仕入照合・納品漏れ・在庫辻褄を一括確認</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 12, color: "#6b7280" }}>対象期間:</label>
          <select value={period} onChange={e => setPeriod(e.target.value)}
            style={{ padding: "5px 10px", border: "1px solid #e5e7eb", borderRadius: 7, fontSize: 13, background: "#fff" }}>
            <option value="1">直近1ヶ月</option>
            <option value="3">直近3ヶ月</option>
            <option value="6">直近6ヶ月</option>
            <option value="12">直近1年</option>
          </select>
          <button onClick={load} style={{ padding: "5px 14px", borderRadius: 7, border: "1px solid #e5e7eb", background: "#fff", fontSize: 13, cursor: "pointer" }}>
            🔄 更新
          </button>
        </div>
      </div>

      {/* サマリーカード */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { label: "未照合 仕入請求", val: summary.unmatchedInv, color: summary.unmatchedInv > 0 ? "#dc2626" : "#059669", bg: summary.unmatchedInv > 0 ? "#fef2f2" : "#f0fdf4", border: summary.unmatchedInv > 0 ? "#fecaca" : "#bbf7d0", tab: "receiving" as Tab },
          { label: "未紐付け 仕入記録", val: summary.unlinkedRcpt, color: summary.unlinkedRcpt > 0 ? "#d97706" : "#059669", bg: summary.unlinkedRcpt > 0 ? "#fffbeb" : "#f0fdf4", border: summary.unlinkedRcpt > 0 ? "#fde68a" : "#bbf7d0", tab: "receiving" as Tab },
          { label: "出荷可能 未納品", val: summary.shippable, color: summary.shippable > 0 ? "#dc2626" : "#059669", bg: summary.shippable > 0 ? "#fef2f2" : "#f0fdf4", border: summary.shippable > 0 ? "#fecaca" : "#bbf7d0", tab: "delivery" as Tab },
          { label: "在庫辻褄 不一致", val: summary.stockDiff, color: summary.stockDiff > 0 ? "#7c3aed" : "#059669", bg: summary.stockDiff > 0 ? "#f5f3ff" : "#f0fdf4", border: summary.stockDiff > 0 ? "#ddd6fe" : "#bbf7d0", tab: "stock" as Tab },
        ].map(s => (
          <button key={s.label} onClick={() => setTab(s.tab)}
            style={{ flex: "1 1 160px", background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12, padding: "12px 16px", textAlign: "left", cursor: "pointer" }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{s.label}</div>
          </button>
        ))}
      </div>

      {/* タブ */}
      <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #e5e7eb", marginBottom: 20 }}>
        {([
          { key: "receiving", label: "① 仕入照合" },
          { key: "delivery",  label: "② 納品漏れ" },
          { key: "stock",     label: "③ 在庫辻褄" },
        ] as { key: Tab; label: string }[]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "8px 20px", border: "none", borderRadius: "8px 8px 0 0",
            background: tab === t.key ? "#2563eb" : "transparent",
            color: tab === t.key ? "#fff" : "#6b7280",
            fontWeight: tab === t.key ? 700 : 400,
            fontSize: 13, cursor: "pointer", marginBottom: -2,
            borderBottom: tab === t.key ? "2px solid #2563eb" : "none",
          }}>{t.label}</button>
        ))}
      </div>

      {loading && <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>読み込み中…</div>}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* ① 仕入照合                              */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {!loading && tab === "receiving" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

          {/* 未照合：請求書アイテムに仕入処理なし */}
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "#111", marginBottom: 8 }}>
              🔴 未照合：仕入請求書に仕入れ処理が紐付いていない（{unmatchedInvItems.length}件）
            </h2>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
              メーカー納品書に記載されているが、仕入れ処理（stock_receipts）に対応するレコードがない明細です。
            </p>
            {unmatchedInvItems.length === 0 ? (
              <div style={okBox}>✅ 未照合の請求書明細はありません</div>
            ) : (
              <div style={tableWrap}>
                <table style={tbl}>
                  <thead><tr style={thRow}>
                    <th style={th}>請求書日付</th>
                    <th style={th}>仕入先</th>
                    <th style={th}>請求書No.</th>
                    <th style={th}>商品名</th>
                    <th style={th}>数量</th>
                    <th style={th}>単価</th>
                    <th style={th}>操作</th>
                  </tr></thead>
                  <tbody>
                    {unmatchedInvItems.slice(0, 100).map(it => {
                      const inv = suppInvs.find(i => i.id === it.invoice_id)
                      const sup = inv?.supplier_id ? supplierMap.get(inv.supplier_id) : undefined
                      return (
                        <tr key={it.id} style={trStyle}>
                          <td style={td}>{inv?.invoice_date || "—"}</td>
                          <td style={td}>{sup?.name || "—"}</td>
                          <td style={td}>{inv?.invoice_number || "—"}</td>
                          <td style={td}>{it.product_name || "—"}</td>
                          <td style={{ ...td, textAlign: "right" }}>{it.quantity ?? "—"}</td>
                          <td style={{ ...td, textAlign: "right" }}>{it.unit_price != null ? fmtYen(it.unit_price) : "—"}</td>
                          <td style={td}>
                            {inv && (
                              <Link href={`/admin/supplier-invoices/${inv.id}/match`}
                                style={{ fontSize: 11, color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>
                                照合する →
                              </Link>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {unmatchedInvItems.length > 100 && <p style={{ fontSize: 12, color: "#9ca3af", padding: 8 }}>…他 {unmatchedInvItems.length - 100} 件</p>}
              </div>
            )}
          </div>

          {/* 未紐付け：仕入処理に請求書なし */}
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "#111", marginBottom: 8 }}>
              🟡 未紐付け：仕入れ処理に請求書が紐付いていない（{unlinkedReceipts.length}件）
            </h2>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
              手動で仕入れ入力したが、メーカー納品書と照合されていない記録です。
            </p>
            {unlinkedReceipts.length === 0 ? (
              <div style={okBox}>✅ 未紐付けの仕入れ記録はありません</div>
            ) : (
              <div style={tableWrap}>
                <table style={tbl}>
                  <thead><tr style={thRow}>
                    <th style={th}>日付</th>
                    <th style={th}>仕入先</th>
                    <th style={th}>商品名</th>
                    <th style={th}>数量</th>
                    <th style={th}>単価</th>
                  </tr></thead>
                  <tbody>
                    {unlinkedReceipts.slice(0, 100).map(r => {
                      const prod = r.product_id ? productMap.get(r.product_id) : undefined
                      const sup  = r.supplier_id ? supplierMap.get(r.supplier_id) : undefined
                      return (
                        <tr key={r.id} style={trStyle}>
                          <td style={td}>{r.created_at.slice(0, 10)}</td>
                          <td style={td}>{sup?.name || "—"}</td>
                          <td style={td}>{prod?.name || "—"}</td>
                          <td style={{ ...td, textAlign: "right" }}>{r.quantity}</td>
                          <td style={{ ...td, textAlign: "right" }}>{r.unit_price != null ? fmtYen(r.unit_price) : "—"}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {unlinkedReceipts.length > 100 && <p style={{ fontSize: 12, color: "#9ca3af", padding: 8 }}>…他 {unlinkedReceipts.length - 100} 件</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* ② 納品漏れ                              */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {!loading && tab === "delivery" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>
            「納品済み」「キャンセル」以外のステータスの注文を在庫状況で分類します。
          </p>

          {/* 出荷可能 */}
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "#dc2626", marginBottom: 8 }}>
              🚨 出荷可能（全商品在庫あり）なのに未納品 — {shippable.length}件
            </h2>
            {shippable.length === 0 ? (
              <div style={okBox}>✅ 出荷可能な未納品注文はありません</div>
            ) : (
              <div style={tableWrap}>
                <table style={tbl}>
                  <thead><tr style={thRow}>
                    <th style={th}>医院名</th>
                    <th style={th}>伝票No.</th>
                    <th style={th}>ステータス</th>
                    <th style={th}>注文日</th>
                    <th style={th}>品目数</th>
                    <th style={th}>金額</th>
                    <th style={th}>操作</th>
                  </tr></thead>
                  <tbody>
                    {shippable.map(({ order: o, items: its }) => (
                      <tr key={o.id} style={{ ...trStyle, background: "#fff5f5" }}>
                        <td style={{ ...td, fontWeight: 600 }}>{clinicMap.get(o.clinic_id)?.name || "—"}</td>
                        <td style={td}>{o.delivery_number || o.id.slice(0, 8)}</td>
                        <td style={td}><span style={{ background: "#fee2e2", color: "#b91c1c", padding: "1px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{o.status}</span></td>
                        <td style={td}>{o.created_at.slice(0, 10)}</td>
                        <td style={{ ...td, textAlign: "right" }}>{its.length}</td>
                        <td style={{ ...td, textAlign: "right" }}>{fmtYen(o.total_price)}</td>
                        <td style={td}>
                          <Link href={`/admin/deliveries/${o.id}`}
                            style={{ fontSize: 11, color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>
                            詳細 →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 一部在庫あり */}
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "#d97706", marginBottom: 8 }}>
              ⚠️ 一部商品のみ在庫あり — {partialStock.length}件
            </h2>
            {partialStock.length === 0 ? (
              <div style={okBox}>✅ 該当なし</div>
            ) : (
              <div style={tableWrap}>
                <table style={tbl}>
                  <thead><tr style={thRow}>
                    <th style={th}>医院名</th>
                    <th style={th}>伝票No.</th>
                    <th style={th}>ステータス</th>
                    <th style={th}>注文日</th>
                    <th style={th}>金額</th>
                    <th style={th}>操作</th>
                  </tr></thead>
                  <tbody>
                    {partialStock.map(({ order: o }) => (
                      <tr key={o.id} style={{ ...trStyle, background: "#fffbeb" }}>
                        <td style={{ ...td, fontWeight: 600 }}>{clinicMap.get(o.clinic_id)?.name || "—"}</td>
                        <td style={td}>{o.delivery_number || o.id.slice(0, 8)}</td>
                        <td style={td}><span style={{ background: "#fef3c7", color: "#92400e", padding: "1px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{o.status}</span></td>
                        <td style={td}>{o.created_at.slice(0, 10)}</td>
                        <td style={{ ...td, textAlign: "right" }}>{fmtYen(o.total_price)}</td>
                        <td style={td}>
                          <Link href={`/admin/deliveries/${o.id}`}
                            style={{ fontSize: 11, color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>
                            詳細 →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 在庫なし */}
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "#6b7280", marginBottom: 8 }}>
              🔵 在庫不足（入荷待ち） — {noStock.length}件
            </h2>
            {noStock.length === 0 ? (
              <div style={okBox}>✅ 該当なし</div>
            ) : (
              <div style={tableWrap}>
                <table style={tbl}>
                  <thead><tr style={thRow}>
                    <th style={th}>医院名</th>
                    <th style={th}>伝票No.</th>
                    <th style={th}>ステータス</th>
                    <th style={th}>注文日</th>
                    <th style={th}>金額</th>
                  </tr></thead>
                  <tbody>
                    {noStock.map(({ order: o }) => (
                      <tr key={o.id} style={trStyle}>
                        <td style={{ ...td, fontWeight: 600 }}>{clinicMap.get(o.clinic_id)?.name || "—"}</td>
                        <td style={td}>{o.delivery_number || o.id.slice(0, 8)}</td>
                        <td style={td}><span style={{ background: "#f3f4f6", color: "#6b7280", padding: "1px 8px", borderRadius: 999, fontSize: 11 }}>{o.status}</span></td>
                        <td style={td}>{o.created_at.slice(0, 10)}</td>
                        <td style={{ ...td, textAlign: "right" }}>{fmtYen(o.total_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {/* ③ 在庫辻褄                              */}
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {!loading && tab === "stock" && (
        <div>
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>
            期間内の「仕入累計 − 納品累計（納品済み注文）」と「現在庫」の差を表示します。<br />
            差異がある商品は手動修正・システム外の出入庫などが考えられます。
          </p>

          {/* 検索 */}
          <div style={{ marginBottom: 12 }}>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="商品名・商品コードで絞り込み…"
              style={{ padding: "8px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13, width: 280, outline: "none" }} />
          </div>

          {stockAudit.length === 0 ? (
            <div style={okBox}>✅ 期間内の在庫辻褄はすべて一致しています</div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                {stockAudit.length}件の差異あり（差の絶対値が大きい順）
              </div>
              <div style={tableWrap}>
                <table style={tbl}>
                  <thead><tr style={thRow}>
                    <th style={th}>商品名</th>
                    <th style={th}>メーカー</th>
                    <th style={{ ...th, textAlign: "right" }}>仕入累計</th>
                    <th style={{ ...th, textAlign: "right" }}>納品累計</th>
                    <th style={{ ...th, textAlign: "right" }}>差引（期間内）</th>
                    <th style={{ ...th, textAlign: "right" }}>現在庫</th>
                    <th style={{ ...th, textAlign: "right" }}>差異</th>
                  </tr></thead>
                  <tbody>
                    {stockAudit
                      .filter(r => !search || norm(r.product.name + (r.product.product_code || "")).includes(norm(search)))
                      .slice(0, 200)
                      .map(r => (
                        <tr key={r.product.id} style={{ ...trStyle, background: r.diff < 0 ? "#fef2f2" : r.diff > 0 ? "#fffbeb" : "#fff" }}>
                          <td style={td}>
                            <div style={{ fontWeight: 600 }}>{r.product.name}</div>
                            {r.product.product_code && <div style={{ fontSize: 11, color: "#9ca3af" }}>{r.product.product_code}</div>}
                          </td>
                          <td style={{ ...td, fontSize: 11, color: "#6b7280" }}>{r.product.manufacturer || "—"}</td>
                          <td style={{ ...td, textAlign: "right", color: "#059669" }}>+{r.received}</td>
                          <td style={{ ...td, textAlign: "right", color: "#dc2626" }}>−{r.delivered}</td>
                          <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{r.net}</td>
                          <td style={{ ...td, textAlign: "right" }}>{r.actual}</td>
                          <td style={{ ...td, textAlign: "right", fontWeight: 700, color: r.diff < 0 ? "#dc2626" : "#d97706" }}>
                            {r.diff > 0 ? `+${r.diff}` : r.diff}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 8 }}>
                ※ 差異 = 期間内差引 − 現在庫。差異がプラス → 期間内に現在庫より多く仕入れ・少なく出た（過去在庫の持ち越しや在庫調整の可能性）。マイナス → 現在庫が計算値より多い（期間外の仕入れ分が含まれる場合など）。
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── スタイル定数 ────────────────────────────────────
const tableWrap: React.CSSProperties = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "auto" }
const tbl:       React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 }
const thRow:     React.CSSProperties = { background: "#f9fafb" }
const th:        React.CSSProperties = { padding: "8px 10px", fontSize: 12, fontWeight: 700, color: "#374151", borderBottom: "1.5px solid #e5e7eb", whiteSpace: "nowrap", textAlign: "left" }
const td:        React.CSSProperties = { padding: "8px 10px", fontSize: 13, borderBottom: "1px solid #f3f4f6", verticalAlign: "middle" }
const trStyle:   React.CSSProperties = { transition: "background 0.1s" }
const okBox:     React.CSSProperties = { background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "14px 18px", color: "#166534", fontWeight: 600, fontSize: 14 }
