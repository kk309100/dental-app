"use client"

// 仕入納品一覧（過去の入荷履歴）
// データソース: stock_receipts
// - サブタブ: 一覧 / 日付別 / 仕入先別 / 商品別
// - ソート: 日付順 / 仕入先順 / 商品順 / 金額順
// - フィルタ: 期間 / 仕入先 / 商品名

import { useEffect, useMemo, useState } from "react"
import { romajiAlt } from "@/lib/romaji"
import Link from "next/link"
import { supabase, fetchAll } from "@/lib/supabase"
import { fmtYen, parseDbDate } from "@/lib/invoice"
import { GroupViewTabs, useGroupView, type GroupableRow } from "@/app/components/GroupViewTabs"
import { downloadCSV, toCSV } from "@/lib/csv"

type Receipt = {
  id: string
  product_id: string | null
  supplier_id: string | null
  quantity: number
  unit_price: number | null
  memo: string | null
  created_at: string
  supplier_invoice_item_id?: string | null
}
type Supplier = { id: string; name: string }
type Product = { id: string; name: string; product_code: string | null; manufacturer: string | null; category: string | null }

type SortKey = "date_desc" | "date_asc" | "supplier_asc" | "product_asc" | "amount_desc" | "amount_asc"

export default function ReceivingsListPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState("")
  const [supplierFilter, setSupplierFilter] = useState<string>("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [noPoOnly, setNoPoOnly] = useState(false)
  const [sortBy, setSortBy] = useState<SortKey>("date_desc")
  const [groupView, setGroupView] = useGroupView()

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    // stock_receipts・products は件数が多いため、Supabase既定の1000件上限に引っかからないよう fetchAll でページング取得する
    const [r, s, p] = await Promise.all([
      fetchAll("stock_receipts", "*", (q: any) => q.order("created_at", { ascending: false })),
      supabase.from("suppliers").select("id,name").order("name").limit(50000),
      fetchAll("products", "id,name,product_code,manufacturer,category"),
    ])
    setReceipts((r as Receipt[]) || [])
    setSuppliers((s.data as Supplier[]) || [])
    setProducts((p as Product[]) || [])
    setLoading(false)
  }

  // ── 入荷の取消・修正 ──────────────────────────────────────────
  // 元の入荷記録は在庫の動き（stock_movements）に「入庫取消」「入庫修正」として残る。
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; qty: string; price: string; date: string; supplierId: string; memo: string; productId: string; productQ: string } | null>(null)
  function startEdit(r: Receipt) {
    setEditing({ id: r.id, qty: String(r.quantity), price: r.unit_price == null ? "" : String(r.unit_price), date: r.created_at.slice(0, 10), supplierId: r.supplier_id || "", memo: r.memo || "", productId: r.product_id || "", productQ: "" })
  }

  // 発注書から入荷した記録なら、発注書の入荷数も同じだけ戻す（状態も判定し直す）
  async function revertPurchaseOrderReceipt(r: Receipt, delta: number) {
    const m = String(r.memo || "").match(/^発注書\s+(\S+)/)
    if (!m || !r.product_id || delta <= 0) return
    const { data: heads } = await supabase.from("purchase_orders").select("id,po_number,status").neq("status", "取消")
    const po = (heads || []).find(h => String(h.po_number || h.id.slice(0, 8)) === m[1])
    if (!po) return
    const { data: lines } = await supabase.from("purchase_order_items").select("id,product_id,quantity,received_quantity").eq("purchase_order_id", po.id)
    let left = delta
    for (const l of (lines || []).filter(l => l.product_id === r.product_id).sort((a, b) => Number(b.received_quantity || 0) - Number(a.received_quantity || 0))) {
      if (left <= 0) break
      const cur = Number(l.received_quantity || 0)
      const step = Math.min(left, cur)
      if (step <= 0) continue
      await supabase.from("purchase_order_items").update({ received_quantity: cur - step }).eq("id", l.id)
      l.received_quantity = cur - step
      left -= step
    }
    const all = (lines || []).every(l => Number(l.received_quantity || 0) >= Number(l.quantity))
    const some = (lines || []).some(l => Number(l.received_quantity || 0) > 0)
    const status = all ? "入荷済" : some ? "部分入荷" : "発注済"
    if (po.status !== status && po.status !== "未送付") await supabase.from("purchase_orders").update({ status }).eq("id", po.id)
  }

  // 在庫を delta だけ増減し、動きを記録する（在庫がマイナスになる場合は確認）
  async function adjustStock(productId: string, delta: number, type: string, reason: string): Promise<boolean> {
    const { data: p, error } = await supabase.from("products").select("stock").eq("id", productId).single()
    if (error || !p) { alert("商品の在庫を読み取れませんでした: " + (error?.message || "")); return false }
    const before = Number(p.stock || 0), after = before + delta
    if (after < 0 && !confirm(`在庫が ${before} → ${after} とマイナスになります（すでに出荷・納品した分が含まれている可能性があります）。続けますか？`)) return false
    const { error: ue } = await supabase.from("products").update({ stock: after }).eq("id", productId)
    if (ue) { alert("在庫の更新に失敗: " + ue.message); return false }
    try { await supabase.from("stock_movements").insert({ product_id: productId, movement_type: type, quantity: delta, before_stock: before, after_stock: after, ref_type: "stock_receipt", reason }) } catch { /* 記録のみ */ }
    return true
  }

  async function cancelReceipt(r: Receipt) {
    if (r.supplier_invoice_item_id) { alert("月次請求書と付け合わせ済みの入荷は、取り消せません。先に付け合わせを外してください。"); return }
    if (!confirm(`この入荷を取り消しますか？\n\n${productName(r.product_id)}  数量 ${r.quantity}\n在庫が ${r.quantity} 減ります。`)) return
    setBusyId(r.id)
    try {
      if (r.product_id && Number(r.quantity) !== 0) {
        if (!(await adjustStock(r.product_id, -Number(r.quantity), "入庫取消", `入荷取消（${r.created_at.slice(0, 10)} ${r.memo || ""}）`))) return
        await revertPurchaseOrderReceipt(r, Number(r.quantity))
      }
      const { error } = await supabase.from("stock_receipts").delete().eq("id", r.id)
      if (error) { alert("取消に失敗しました（在庫は戻っています。もう一度お試しください）: " + error.message); return }
      setReceipts(prev => prev.filter(x => x.id !== r.id))   // 画面全体は読み直さず、その行だけ消す
    } finally { setBusyId(null) }
  }

  async function saveEdit(r: Receipt) {
    if (!editing) return
    const qty = Number(editing.qty), price = editing.price === "" ? null : Number(editing.price)
    if (!Number.isFinite(qty) || qty <= 0 || (price !== null && (!Number.isFinite(price) || price < 0))) { alert("数量は1以上、単価は0以上の数字で入力してください"); return }
    const newProductId = editing.productId || null
    const productChanged = newProductId !== (r.product_id || null)
    if (r.supplier_invoice_item_id && (qty !== Number(r.quantity) || price !== (r.unit_price ?? null) || productChanged)) { alert("月次請求書と付け合わせ済みの入荷は、数量・単価・商品を修正できません。先に付け合わせを外してください。"); return }
    setBusyId(r.id)
    try {
      const oldQty = Number(r.quantity)
      if (productChanged) {
        // 商品を変えるとき: 元の商品の在庫を戻し、新しい商品の在庫に足す
        if (r.product_id) {
          if (!(await adjustStock(r.product_id, -oldQty, "入庫修正", `入荷の商品変更（${productName(r.product_id)} から外す）`))) return
          await revertPurchaseOrderReceipt(r, oldQty)
        }
        if (newProductId && !(await adjustStock(newProductId, qty, "入庫修正", `入荷の商品変更（${productName(newProductId)} に付け替え）`))) return
      } else {
        const delta = qty - oldQty
        if (delta !== 0 && r.product_id) {
          if (!(await adjustStock(r.product_id, delta, "入庫修正", `入荷修正 数量 ${oldQty}→${qty}（${r.created_at.slice(0, 10)}）`))) return
          if (delta < 0) await revertPurchaseOrderReceipt(r, -delta)
        }
      }
      const patch: Record<string, unknown> = { quantity: qty, unit_price: price, supplier_id: editing.supplierId || null, memo: editing.memo.trim() || null, product_id: newProductId }
      if (editing.date && editing.date !== r.created_at.slice(0, 10)) patch.created_at = `${editing.date}T12:00:00`   // 入荷日を変えたときだけ
      const { error } = await supabase.from("stock_receipts").update(patch).eq("id", r.id)
      if (error) { alert("修正に失敗しました: " + error.message); return }
      setEditing(null)
      setReceipts(prev => prev.map(x => x.id === r.id ? ({ ...x, ...patch } as Receipt) : x))   // 画面全体は読み直さず、その行だけ更新する
    } finally { setBusyId(null) }
  }

  const supplierMap = useMemo(() => new Map(suppliers.map(s => [s.id, s])), [suppliers])
  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const supplierName = (id: string | null) => id ? (supplierMap.get(id)?.name || "(削除済み)") : "(未指定)"
  const productName = (id: string | null) => id ? (productMap.get(id)?.name || "(削除済み)") : "(未指定)"

  const norm = (v: string) => String(v || "").toLowerCase().normalize("NFKC")

  const filtered = useMemo(() => {
    const k = norm(search)
    const k2 = romajiAlt(search) ? norm(romajiAlt(search)!) : ""   // ローマ字入力でもカタカナ名を探せるように
    return receipts.filter(r => {
      if (supplierFilter !== "all" && r.supplier_id !== supplierFilter) return false
      if (noPoOnly && !(r.memo || "").includes("⚠発注記録なし")) return false
      const d = r.created_at.slice(0, 10)
      if (from && d < from) return false
      if (to && d > to) return false
      if (!k) return true
      const target = norm(`${productName(r.product_id)} ${supplierName(r.supplier_id)} ${r.memo || ""}`)
      return target.includes(k) || (!!k2 && target.includes(k2))
    })
  }, [receipts, supplierFilter, from, to, search, suppliers, products, noPoOnly])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      const aDate = a.created_at, bDate = b.created_at
      const aSup = supplierName(a.supplier_id), bSup = supplierName(b.supplier_id)
      const aProd = productName(a.product_id), bProd = productName(b.product_id)
      const aAmt = Number(a.unit_price || 0) * Number(a.quantity)
      const bAmt = Number(b.unit_price || 0) * Number(b.quantity)
      switch (sortBy) {
        case "date_desc": return bDate.localeCompare(aDate)
        case "date_asc": return aDate.localeCompare(bDate)
        case "supplier_asc": return aSup.localeCompare(bSup, "ja") || bDate.localeCompare(aDate)
        case "product_asc": return aProd.localeCompare(bProd, "ja") || bDate.localeCompare(aDate)
        case "amount_desc": return bAmt - aAmt
        case "amount_asc": return aAmt - bAmt
      }
    })
    return arr
  }, [filtered, sortBy, suppliers, products])

  // 集計
  const totals = useMemo(() => {
    const totalAmount = filtered.reduce((s, r) => s + Number(r.unit_price || 0) * Number(r.quantity), 0)
    return { count: filtered.length, totalAmount }
  }, [filtered])

  // 「発注記録なし」で受け取った件数（紙注文などでデンハブ未入力だった可能性がある入荷）
  const noPoCount = useMemo(() => receipts.filter(r => (r.memo || "").includes("⚠発注記録なし")).length, [receipts])

  // GroupViewTabs 用の行データ
  const groupRows: GroupableRow[] = useMemo(() => sorted.map(r => ({
    id: r.id,
    date: r.created_at.slice(0, 10),
    party: supplierName(r.supplier_id),
    amount: Number(r.unit_price || 0) * Number(r.quantity),
    items: [{
      name: productName(r.product_id),
      quantity: Number(r.quantity),
      price: Number(r.unit_price || 0),
    }],
  })), [sorted, suppliers, products])

  function exportCSV() {
    const csv = toCSV(
      sorted.map(r => {
        const p = r.product_id ? productMap.get(r.product_id) : null
        return {
          入荷日: r.created_at.slice(0, 10),
          仕入先: supplierName(r.supplier_id),
          商品コード: p?.product_code || "",
          商品名: productName(r.product_id),
          メーカー: p?.manufacturer || "",
          数量: r.quantity,
          単価: r.unit_price || 0,
          金額: Number(r.unit_price || 0) * Number(r.quantity),
          メモ: r.memo || "",
        }
      }),
      ["入荷日", "仕入先", "商品コード", "商品名", "メーカー", "数量", "単価", "金額", "メモ"]
    )
    downloadCSV(`仕入納品一覧_${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  if (loading) return <p className="text-center py-12 text-gray-400">読み込み中…</p>

  return (
    <div className="space-y-2">
      {/* ヘッダ */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900" style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: 0 }}>
          📋 仕入納品一覧
          <span className="ml-2 text-xs font-normal text-gray-400">
            該当 {totals.count} 件 ・ 合計 {fmtYen(totals.totalAmount)}
          </span>
          {noPoCount > 0 && (
            <button onClick={() => setNoPoOnly(v => !v)}
              className={"ml-2 text-[11px] font-bold px-2 py-0.5 rounded-full align-middle " + (noPoOnly ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-700 border border-amber-200")}
              title="発注書に無い商品を受け取った入荷（紙注文などでデンハブに未入力だった可能性）のみ表示を切り替え">
              ⚠ 発注記録なし {noPoCount}件
            </button>
          )}
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={exportCSV}
            className="px-3 py-2 bg-white border border-gray-200 rounded text-sm hover:bg-gray-50">📤 CSV出力</button>
          <Link href="/admin/receiving"
            className="px-3 py-2 bg-emerald-600 text-white text-sm font-bold rounded hover:bg-emerald-700">
            ＋ 入荷登録（手打ち or PDF読込）
          </Link>
          <Link href="/admin/supplier-invoices"
            className="px-3 py-2 bg-purple-100 text-purple-700 text-sm font-bold rounded hover:bg-purple-200">
            🔍 月次請求書付け合わせ
          </Link>
        </div>
      </div>

      {/* フィルタ */}
      <div className="flex gap-1.5 items-center bg-gray-50 p-2 rounded-lg flex-wrap" style={{ border: "1px solid #e8eaed" }}>
        <input lang="ja" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="商品名・仕入先・メモで検索"
          className="flex-1 min-w-[180px] px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}
          className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white max-w-[200px]">
          <option value="all">全仕入先</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <span className="text-xs text-gray-400">〜</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <select value={sortBy} onChange={e => setSortBy(e.target.value as SortKey)}
          className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="date_desc">📅 日付 新→古</option>
          <option value="date_asc">📅 日付 古→新</option>
          <option value="supplier_asc">🏭 仕入先順</option>
          <option value="product_asc">📦 商品順</option>
          <option value="amount_desc">💰 金額 大→小</option>
          <option value="amount_asc">💰 金額 小→大</option>
        </select>
      </div>

      {/* サブタブ + 一覧 */}
      <GroupViewTabs value={groupView} onChange={setGroupView} rows={groupRows} partyLabel="仕入先">
        <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0", maxHeight: "calc(100vh - 280px)" }}>
          <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
            <thead className="sticky top-0 bg-gray-100">
              <tr className="text-[12px] text-gray-700 font-bold border-b-2 border-gray-300">
                <th className="px-2 py-1.5 text-center w-24">入荷日</th>
                <th className="px-2 py-1.5 text-left w-40">仕入先</th>
                <th className="px-2 py-1.5 text-left w-24">商品コード</th>
                <th className="px-2 py-1.5 text-left">商品名</th>
                <th className="px-2 py-1.5 text-left w-28">メーカー</th>
                <th className="px-2 py-1.5 text-right w-14">数量</th>
                <th className="px-2 py-1.5 text-right w-20">単価</th>
                <th className="px-2 py-1.5 text-right w-24">金額</th>
                <th className="px-2 py-1.5 text-left w-32">メモ</th>
                <th className="px-2 py-1.5 text-center w-16">付け合わせ</th>
                <th className="px-2 py-1.5 text-center w-28">操作</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-gray-400">該当する入荷記録なし</td></tr>
              ) : sorted.map((r, i) => {
                const p = r.product_id ? productMap.get(r.product_id) : null
                const amount = Number(r.unit_price || 0) * Number(r.quantity)
                const matched = !!r.supplier_invoice_item_id
                const noOpenPO = (r.memo || "").includes("⚠発注記録なし")
                return (
                  <tr key={r.id} className={"border-b border-gray-100 hover:bg-blue-50/40 " + (noOpenPO ? "bg-amber-50/60" : i % 2 === 0 ? "" : "bg-gray-50/30")}>
                    <td className="px-2 py-1.5 text-center text-[12px] text-gray-700">
                      {editing?.id === r.id
                        ? <input type="date" value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })} className="px-1 py-0.5 border border-gray-300 rounded text-[12px]" />
                        : parseDbDate(r.created_at).toLocaleDateString("ja-JP", { year: "2-digit", month: "2-digit", day: "2-digit" })}
                    </td>
                    <td className="px-2 py-1.5 text-[12px]">
                      {editing?.id === r.id
                        ? <select value={editing.supplierId} onChange={e => setEditing({ ...editing, supplierId: e.target.value })} className="px-1 py-0.5 border border-gray-300 rounded text-[12px] max-w-[160px]">
                            <option value="">（未指定）</option>
                            {suppliers.map(sp => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
                          </select>
                        : supplierName(r.supplier_id)}
                    </td>
                    <td className="px-2 py-1.5 text-[12px] text-gray-500 font-mono">{p?.product_code || "—"}</td>
                    <td className="px-2 py-1.5">
                      {editing?.id === r.id ? (
                        <div className="relative">
                          <div className="text-[12px] mb-0.5">{productName(editing.productId || null)}</div>
                          <input value={editing.productQ} onChange={e => setEditing({ ...editing, productQ: e.target.value })} placeholder="商品を変えるなら、ここで検索" className="w-full px-1 py-0.5 border border-gray-300 rounded text-[11px]" />
                          {editing.productQ.trim() && (
                            <div className="absolute z-20 left-0 right-0 bg-white border border-gray-300 rounded shadow max-h-48 overflow-auto">
                              {products.filter(pp => norm(pp.name + " " + (pp.product_code || "")).includes(norm(editing.productQ))).slice(0, 8).map(pp => (
                                <button key={pp.id} onClick={() => setEditing({ ...editing, productId: pp.id, productQ: "" })} className="block w-full text-left px-2 py-1 text-[12px] hover:bg-blue-50 border-b border-gray-100">
                                  {pp.name}<span className="text-gray-400 ml-1">{pp.product_code || ""}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : productName(r.product_id)}
                    </td>
                    <td className="px-2 py-1.5 text-[12px] text-gray-500">{p?.manufacturer || "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {editing?.id === r.id
                        ? <input type="number" min={1} value={editing.qty} onChange={e => setEditing({ ...editing, qty: e.target.value })} className="w-16 px-1 py-0.5 border border-gray-300 rounded text-right" />
                        : r.quantity}
                    </td>
                    <td className="px-2 py-1.5 text-right text-[12px] text-gray-600 tabular-nums">
                      {editing?.id === r.id
                        ? <input type="number" min={0} step="any" value={editing.price} onChange={e => setEditing({ ...editing, price: e.target.value })} className="w-20 px-1 py-0.5 border border-gray-300 rounded text-right" />
                        : fmtYen(r.unit_price || 0)}
                    </td>
                    <td className="px-2 py-1.5 text-right text-[12px] font-bold tabular-nums">{fmtYen(amount)}</td>
                    <td className="px-2 py-1.5 text-[12px] text-gray-500">
                      {editing?.id === r.id ? <input value={editing.memo} onChange={e => setEditing({ ...editing, memo: e.target.value })} className="w-full px-1 py-0.5 border border-gray-300 rounded text-[12px]" /> : (r.memo || "").replace(/\s*\/?\s*⚠発注記録なし/, "")}
                      {noOpenPO && <span className="ml-1 text-[11px] text-amber-700 bg-amber-100 px-1 py-0.5 rounded" title="受け取り時、この商品を含む未入荷の発注書が見つかりませんでした（紙注文などでデンハブに未入力だった可能性）">⚠ 発注記録なし</span>}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {matched ? (
                        <span className="text-[12px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">✅</span>
                      ) : (
                        <span className="text-[12px] text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center whitespace-nowrap">
                      {editing?.id === r.id ? (
                        <>
                          <button disabled={busyId === r.id} onClick={() => saveEdit(r)} className="text-[11px] px-2 py-0.5 rounded bg-blue-600 text-white font-bold mr-1 disabled:opacity-50">保存</button>
                          <button onClick={() => setEditing(null)} className="text-[11px] px-2 py-0.5 rounded border border-gray-300 text-gray-600">戻る</button>
                        </>
                      ) : (
                        <>
                          <button disabled={busyId === r.id} onClick={() => startEdit(r)} className="text-[11px] px-2 py-0.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 mr-1 disabled:opacity-50">修正</button>
                          <button disabled={busyId === r.id} onClick={() => cancelReceipt(r)} className="text-[11px] px-2 py-0.5 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">取消</button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-gray-50 sticky bottom-0">
              <tr className="border-t-2 border-gray-300">
                <td colSpan={7} className="px-2 py-2 text-right text-xs font-bold text-gray-700">合計</td>
                <td className="px-2 py-2 text-right text-base font-bold text-gray-900 tabular-nums">{fmtYen(totals.totalAmount)}</td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </GroupViewTabs>
    </div>
  )
}
