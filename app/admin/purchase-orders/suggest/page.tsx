"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { fetchSuppliersByUsage, supplierOptionLabel, type Supplier } from "@/lib/supplier-sort"

export default function SuggestPOPageWrapper() {
  return (
    <Suspense fallback={<p className="text-gray-400 text-center py-12">読み込み中…</p>}>
      <SuggestPOPage />
    </Suspense>
  )
}

type Product = {
  id: string
  name: string
  product_code: string | null
  manufacturer: string | null
  stock: number | null
  reorder_level: number | null
  cost: number | null
  default_supplier_id?: string | null
}
type OrderItem = { product_id: string | null; quantity: number; order_id: string }
type Order = { id: string; status: string; clinic_id: string | null }
type Clinic = { id: string; name: string }
type StockReceipt = { id: string; product_id: string; supplier_id: string | null; quantity: number; unit_price: number | null; created_at: string }
type DraftPO = { id: string; po_number: string | null; supplier_id: string | null; total_amount: number | null }

type Suggestion = {
  product: Product
  systemStock: number
  reorderLevel: number
  reservedQty: number   // 未納品の注文に紐付いた量
  shortBy: number       // 不足量
  suggestQty: number    // 提案発注量
  unitPrice: number
  selected: boolean
  supplierOverride?: string
  deliveryTarget?: string   // 納品先: clinic_id / "stock" / "tbd"
  deliveryLabel?: string    // 表示用ラベル
}

function SuggestPOPage() {
  const router = useRouter()
  const sp = useSearchParams()
  const fromOrders = sp.get("from_orders")?.split(",").filter(Boolean) || []
  const fromOrder = sp.get("from_order")
  const sourceOrderIds = fromOrder ? [fromOrder] : fromOrders
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [groupSupplier, setGroupSupplier] = useState<string>("")
  const [historyByProduct, setHistoryByProduct] = useState<Map<string, StockReceipt[]>>(new Map())
  const [openHistoryProductId, setOpenHistoryProductId] = useState<string | null>(null)
  const [draftPOs, setDraftPOs] = useState<DraftPO[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [p, sups, oi, o, sr, dr, cl] = await Promise.all([
      supabase.from("products").select("id,name,product_code,manufacturer,stock,reorder_level,cost,default_supplier_id").limit(50000),
      fetchSuppliersByUsage("id,name"),
      supabase.from("order_items").select("product_id,quantity,order_id").limit(50000),
      // 全件取得→クライアントで「納品済」「納品済み」「キャンセル」「取消」を除外
      // PostgREST .not in は日本語値で 400 エラーになるため
      supabase.from("orders").select("id,status,clinic_id").limit(50000),
      supabase.from("stock_receipts").select("id,product_id,supplier_id,quantity,unit_price,created_at").order("created_at", { ascending: false }).limit(50000),
      supabase.from("purchase_orders").select("id,po_number,supplier_id,total_amount").eq("status", "下書き"),
      supabase.from("clinics").select("id,name").limit(50000),
    ])
    const products = (p.data as Product[]) || []
    setSuppliers(sups)
    setDraftPOs((dr.data as DraftPO[]) || [])
    setClinics((cl.data as Clinic[]) || [])
    // 商品ごとの過去仕入履歴をマップ化
    const histMap = new Map<string, StockReceipt[]>()
    ;((sr.data as StockReceipt[]) || []).forEach(r => {
      if (!r.product_id) return
      if (!histMap.has(r.product_id)) histMap.set(r.product_id, [])
      histMap.get(r.product_id)!.push(r)
    })
    setHistoryByProduct(histMap)
    // 「納品済」「納品済み」「キャンセル」「取消」を除外（表記ゆれ吸収）
    const allOrders = (o.data as Order[]) || []
    const orders = allOrders.filter(o => !["納品済み", "納品済", "キャンセル", "取消"].includes(o.status))
    const orderIds = new Set(orders.map(o => o.id))
    const items = ((oi.data as OrderItem[]) || []).filter(i => i.order_id && orderIds.has(i.order_id))

    // 商品ごとの未出庫予約数
    const reserved = new Map<string, number>()
    items.forEach(i => {
      if (!i.product_id) return
      reserved.set(i.product_id, (reserved.get(i.product_id) || 0) + Number(i.quantity || 0))
    })

    const list: Suggestion[] = []

    // 商品ごとの「最後の仕入先」を計算（自動マッチ用）
    function lastSupplier(productId: string): { supplierId: string | null; lastPrice: number | null } {
      const hist = histMap.get(productId)
      if (!hist || hist.length === 0) return { supplierId: null, lastPrice: null }
      const latest = hist[0]  // 既に created_at desc 順
      return { supplierId: latest.supplier_id, lastPrice: latest.unit_price }
    }

    if (sourceOrderIds.length > 0) {
      // 【from_order/from_orders 指定モード】
      // その注文に含まれる商品だけを、注文数量ベースで「不足分だけ」発注候補にする
      const orderQtyByProduct = new Map<string, number>()
      // 商品ごとに「どの医院の注文か」をトラッキング（納品先初期値用）
      const productClinicMap = new Map<string, string>()
      const ordersList = (o.data as Order[]) || []
      const orderClinicMap = new Map(ordersList.map(o => [o.id, o.clinic_id]))
      ;((oi.data as OrderItem[]) || [])
        .filter(i => i.order_id && sourceOrderIds.includes(i.order_id) && i.product_id)
        .forEach(i => {
          const cur = orderQtyByProduct.get(i.product_id as string) || 0
          orderQtyByProduct.set(i.product_id as string, cur + Number(i.quantity || 0))
          const cid = orderClinicMap.get(i.order_id)
          if (cid && !productClinicMap.has(i.product_id as string)) {
            productClinicMap.set(i.product_id as string, cid)
          }
        })
      const clinicNameMap = new Map(((cl.data as Clinic[]) || []).map(c => [c.id, c.name]))
      products.forEach(p => {
        const orderQty = orderQtyByProduct.get(p.id) || 0
        if (orderQty === 0) return
        const stock = Number(p.stock || 0)
        const shortBy = Math.max(0, orderQty - stock)
        // ★ shortBy=0（在庫足りる）でも候補に含める。ただし初期選択はOFF
        //   ユーザーが「不足分だけ」「全商品」選べる柔軟性を確保
        const last = lastSupplier(p.id)
        const clinicId = productClinicMap.get(p.id)
        list.push({
          product: p,
          systemStock: stock,
          reorderLevel: orderQty,
          reservedQty: orderQty,
          shortBy,
          suggestQty: shortBy > 0 ? shortBy : orderQty,  // 足りてれば注文数量と同じ提案
          unitPrice: last.lastPrice ?? Number(p.cost || 0),
          selected: shortBy > 0,  // 不足分だけ初期チェック、足りる商品はOFF
          supplierOverride: last.supplierId || p.default_supplier_id || undefined,
          deliveryTarget: clinicId || "stock",
          deliveryLabel: clinicId ? (clinicNameMap.get(clinicId) || "医院") : "在庫",
        })
      })
    } else {
      // 【通常モード】商品マスタ全体の在庫不足から推奨
      products.forEach(p => {
        const stock = Number(p.stock || 0)
        const reorderLv = Number(p.reorder_level || 0)
        const reservedQty = reserved.get(p.id) || 0
        const effectiveStock = stock - reservedQty
        const shortBy = Math.max(0, (reorderLv + reservedQty) - stock)
        const suggestQty = shortBy > 0 ? Math.max(shortBy, Math.ceil(reorderLv * 0.5)) : 0
        if (suggestQty > 0 || effectiveStock < 0) {
          const last = lastSupplier(p.id)
          list.push({
            product: p,
            systemStock: stock,
            reorderLevel: reorderLv,
            reservedQty,
            shortBy: Math.max(shortBy, -effectiveStock),
            suggestQty: Math.max(suggestQty, -effectiveStock, 1),
            unitPrice: last.lastPrice ?? Number(p.cost || 0),
            selected: true,
            supplierOverride: last.supplierId || p.default_supplier_id || undefined,
            deliveryTarget: "stock",
            deliveryLabel: "在庫",
          })
        }
      })
    }
    list.sort((a, b) => (b.shortBy / Math.max(1, b.reorderLevel)) - (a.shortBy / Math.max(1, a.reorderLevel)))
    setSuggestions(list)
    setLoading(false)
  }

  const supplierName = (id: string | null | undefined) => id ? suppliers.find(s => s.id === id)?.name || "(削除済み)" : "(未設定)"

  const filtered = useMemo(() => {
    return suggestions.filter(s => {
      if (groupSupplier && (s.supplierOverride || s.product.default_supplier_id || "") !== groupSupplier) return false
      if (!search) return true
      const target = `${s.product.name} ${s.product.product_code || ""} ${s.product.manufacturer || ""}`.toLowerCase()
      return target.includes(search.toLowerCase())
    })
  }, [suggestions, search, groupSupplier])

  const summary = useMemo(() => {
    const sup = new Map<string, number>()
    filtered.filter(s => s.selected).forEach(s => {
      const sid = s.supplierOverride || s.product.default_supplier_id || "(未設定)"
      sup.set(sid, (sup.get(sid) || 0) + s.suggestQty * s.unitPrice)
    })
    return sup
  }, [filtered])

  function update(idx: number, patch: Partial<Suggestion>) {
    setSuggestions(prev => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  function deliveryNoteFor(s: Suggestion): string {
    const parts: string[] = []
    if (s.deliveryLabel) parts.push(`納品先:${s.deliveryLabel}`)
    if (s.shortBy > 0) parts.push(`在庫${s.systemStock}/不足${s.shortBy}`)
    return parts.join(" / ")
  }

  async function createPOForSupplier(supId: string) {
    const target = suggestions.filter(s => s.selected && (s.supplierOverride || s.product.default_supplier_id || "") === supId && s.suggestQty > 0)
    if (target.length === 0) { alert("対象なし"); return }

    // 同じ仕入先の下書き発注書があるか
    const existingDraft = draftPOs.find(d => d.supplier_id === supId)

    if (existingDraft) {
      // 既存に追加 or 新規作成 を選択
      const choice = window.confirm(
        `「${supplierName(supId)}」宛の作成中（下書き）の発注書があります（No.${existingDraft.po_number || existingDraft.id.slice(0, 8)}・¥${(existingDraft.total_amount || 0).toLocaleString()}）。\n\n` +
        `[OK] 既存の下書きに追加\n[キャンセル] 新規作成`
      )
      if (choice) {
        // 既存に追加
        const items = target.map(s => ({
          purchase_order_id: existingDraft.id,
          product_id: s.product.id,
          product_name: s.product.name,
          quantity: s.suggestQty,
          unit_price: s.unitPrice,
          note: deliveryNoteFor(s),
        }))
        const { error: ie } = await supabase.from("purchase_order_items").insert(items)
        if (ie) { alert("追加失敗: " + ie.message); return }
        // 合計額を再計算
        const { data: allItems } = await supabase.from("purchase_order_items")
          .select("quantity,unit_price").eq("purchase_order_id", existingDraft.id)
        const newTotal = (allItems || []).reduce((s, i: { quantity: number; unit_price: number }) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0)
        await supabase.from("purchase_orders").update({ total_amount: newTotal }).eq("id", existingDraft.id)
        alert(`✅ 既存の下書き発注書 No.${existingDraft.po_number || existingDraft.id.slice(0, 8)} に ${items.length} 件追加しました`)
        router.push(`/admin/purchase-orders/${existingDraft.id}`)
        return
      }
    }

    // 新規作成
    if (!confirm(`「${supplierName(supId)}」宛に新規発注書を作成します（${target.length}件）。よろしいですか？`)) return
    const draft = {
      supplier_id: supId,
      rows: target.map(s => ({
        product_id: s.product.id,
        product_name: s.product.name,
        quantity: s.suggestQty,
        unit_price: s.unitPrice,
        note: deliveryNoteFor(s),
      })),
      note: sourceOrderIds.length > 0 ? `注文 ${sourceOrderIds.length}件 から自動生成` : "在庫不足から自動生成",
    }
    sessionStorage.setItem("po:draft", JSON.stringify(draft))
    router.push("/admin/purchase-orders/new")
  }

  if (loading) return <p className="text-gray-400 text-center py-12">在庫を分析中…</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900">
          {sourceOrderIds.length > 0 ? "📦 注文の不足品 発注" : "発注書の自動提案"}
          <span className="ml-2 text-xs font-normal text-gray-400">
            {sourceOrderIds.length > 0
              ? `この注文を出荷するために必要な不足分（${sourceOrderIds.length}件分の注文）`
              : "在庫不足 + 予約済み数を考慮した発注候補"}
          </span>
        </h1>
        <Link href="/admin/purchase-orders" className="text-xs text-gray-500 underline">← 発注書一覧</Link>
      </div>
      {sourceOrderIds.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 text-xs text-blue-800">
          💡 この画面では「<strong>注文に必要な分だけ</strong>」を発注候補として表示しています。
          余裕を持って多めに発注したい場合は数量を編集してください。
          <Link href="/admin/purchase-orders/suggest" className="ml-2 underline">→ 全在庫不足を見る</Link>
        </div>
      )}

      <div className="flex gap-1.5 items-center bg-gray-50 p-2 rounded-lg flex-wrap" style={{ border: "1px solid #e8eaed" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="商品名・コード・メーカー"
          className="flex-1 min-w-[180px] px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <select value={groupSupplier} onChange={e => setGroupSupplier(e.target.value)}
          className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white max-w-[200px]">
          <option value="">全仕入先</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {summary.size > 0 && (
        <div className="bg-blue-50 rounded-lg p-3" style={{ border: "1px solid #c7d2fe" }}>
          <p className="text-xs font-bold text-blue-900 mb-1">
            仕入先別 発注予定
            <span className="ml-2 text-[10px] font-normal text-gray-500">※ 同じ仕入先で「下書き」発注書がある場合は追加 or 新規を選択できます</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {Array.from(summary.entries()).map(([sid, amt]) => {
              const draft = draftPOs.find(d => d.supplier_id === sid)
              return (
                <button key={sid} onClick={() => sid !== "(未設定)" && createPOForSupplier(sid)}
                  disabled={sid === "(未設定)"}
                  className={"text-xs px-3 py-1.5 border rounded hover:bg-blue-100 disabled:opacity-50 " + (draft ? "bg-amber-50 border-amber-300" : "bg-white border-blue-200")}>
                  <span className="font-bold">{supplierName(sid as string)}</span>
                  <span className="ml-2 text-blue-700 tabular-nums">{fmtYen(amt)}</span>
                  {draft && <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-amber-200 text-amber-900 rounded font-bold">📝 下書きあり</span>}
                  {sid !== "(未設定)" && <span className="ml-2 text-blue-500">→ 発注書{draft ? "に追加" : "作成"}</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0" }}>
        <table className="w-full text-xs">
          <thead className="bg-gray-100 sticky top-0">
            <tr className="text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-2 py-1.5 text-center w-8"></th>
              <th className="px-2 py-1.5 text-left" colSpan={2}>商品 / 過去仕入履歴（クリックで選択）</th>
              <th className="px-2 py-1.5 text-right w-16">在庫</th>
              <th className="px-2 py-1.5 text-right w-16">{sourceOrderIds.length > 0 ? "必要" : "予約"}</th>
              <th className="px-2 py-1.5 text-right w-16">不足</th>
              <th className="px-2 py-1.5 text-right w-20">発注数</th>
              <th className="px-2 py-1.5 text-right w-24">単価</th>
              <th className="px-2 py-1.5 text-right w-24">小計</th>
              <th className="px-2 py-1.5 text-left w-40">納品先 / 仕入先</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-6 text-center text-gray-400">不足商品なし 🎉</td></tr>
            ) : filtered.map((s, idx) => {
              const realIdx = suggestions.indexOf(s)
              const history = historyByProduct.get(s.product.id) || []
              const isHistoryOpen = openHistoryProductId === s.product.id
              return (
                <>
                  <tr key={s.product.id} className={"border-b border-gray-100 " + (idx % 2 === 0 ? "" : "bg-gray-50/30")}>
                    <td className="px-2 py-1 text-center align-top pt-3">
                      <input type="checkbox" checked={s.selected} onChange={e => update(realIdx, { selected: e.target.checked })} />
                    </td>
                    <td className="px-2 py-1" colSpan={2}>
                      {/* 商品名 */}
                      <div className="font-bold text-gray-900">{s.product.name}</div>
                      <div className="text-[10px] text-gray-500 mb-1.5">
                        {s.product.product_code || ""} {s.product.manufacturer || ""}
                      </div>
                      {/* 過去仕入候補（常時表示・クリックで選択） */}
                      {history.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {history.slice(0, 8).map(h => {
                            const sup = suppliers.find(x => x.id === h.supplier_id)
                            const isSelected = (s.supplierOverride === h.supplier_id) && (s.unitPrice === Number(h.unit_price || 0))
                            return (
                              <button
                                key={h.id}
                                onClick={() => update(realIdx, {
                                  supplierOverride: h.supplier_id || undefined,
                                  unitPrice: Number(h.unit_price || 0),
                                })}
                                className={"text-[10px] px-2 py-1 border rounded hover:bg-emerald-100 " +
                                  (isSelected ? "bg-emerald-100 border-emerald-400 ring-1 ring-emerald-400" : "bg-white border-gray-200")}
                                title={`${sup?.name || "(未設定)"} ¥${Number(h.unit_price || 0).toLocaleString()} / ${new Date(h.created_at).toLocaleDateString("ja-JP")}`}
                              >
                                <span className="font-bold text-gray-900">{sup?.name || "(未設定)"}</span>
                                <span className="ml-1.5 text-emerald-700 font-bold">¥{Number(h.unit_price || 0).toLocaleString()}</span>
                                <span className="ml-1 text-gray-400">{new Date(h.created_at).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}</span>
                              </button>
                            )
                          })}
                          {history.length > 8 && (
                            <span className="text-[10px] text-gray-400 px-1.5 py-1">他 {history.length - 8} 件</span>
                          )}
                        </div>
                      ) : (
                        <div className="text-[10px] text-gray-400">過去仕入履歴なし</div>
                      )}
                    </td>
                    <td className={"px-2 py-1 text-right tabular-nums " + (s.systemStock <= 0 ? "text-red-600 font-bold" : "text-gray-700")}>{s.systemStock}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-gray-500">{s.reservedQty || "—"}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-amber-700 font-bold">{s.shortBy || "—"}</td>
                    <td className="px-2 py-1">
                      <input type="number" value={s.suggestQty} onChange={e => update(realIdx, { suggestQty: Number(e.target.value) })}
                        className="w-full px-1.5 py-0.5 border border-gray-200 rounded text-xs text-right" min={0} />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" value={s.unitPrice} onChange={e => update(realIdx, { unitPrice: Number(e.target.value) })}
                        className="w-full px-1.5 py-0.5 border border-gray-200 rounded text-xs text-right" min={0} />
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums font-bold">{fmtYen(s.suggestQty * s.unitPrice)}</td>
                    <td className="px-2 py-1">
                      <select value={s.deliveryTarget || "stock"}
                        onChange={e => {
                          const v = e.target.value
                          const lbl = v === "stock" ? "在庫" : v === "tbd" ? "未定" : (clinics.find(c => c.id === v)?.name || "医院")
                          update(realIdx, { deliveryTarget: v, deliveryLabel: lbl })
                        }}
                        className="w-full px-1.5 py-0.5 border border-gray-200 rounded text-xs">
                        <option value="stock">📦 在庫補充</option>
                        <option value="tbd">未定</option>
                        <optgroup label="医院（納品先）">
                          {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </optgroup>
                      </select>
                      {/* 仕入先（小さく表示・編集可） */}
                      <select value={s.supplierOverride || s.product.default_supplier_id || ""}
                        onChange={e => update(realIdx, { supplierOverride: e.target.value })}
                        className="w-full mt-0.5 px-1.5 py-0.5 border border-gray-200 rounded text-[10px] bg-blue-50/30">
                        <option value="">仕入先(未設定)</option>
                        {suppliers.map(sup => <option key={sup.id} value={sup.id}>{supplierOptionLabel(sup)}</option>)}
                      </select>
                    </td>
                  </tr>
                  {false && isHistoryOpen && history.length > 0 && (
                    <tr className="bg-blue-50/30 border-b border-gray-100">
                      <td colSpan={11} className="px-4 py-2">
                        <p className="text-[10px] font-bold text-gray-500 mb-1">過去の仕入履歴（クリックで仕入先・単価セット）</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1">
                          {history.slice(0, 12).map(h => {
                            const sup = suppliers.find(x => x.id === h.supplier_id)
                            return (
                              <button
                                key={h.id}
                                onClick={() => update(realIdx, {
                                  supplierOverride: h.supplier_id || undefined,
                                  unitPrice: Number(h.unit_price || 0),
                                })}
                                className="text-left text-[11px] px-2 py-1.5 bg-white border border-gray-200 rounded hover:bg-emerald-50 hover:border-emerald-300"
                                title="クリックでこの仕入先・単価をセット"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-bold text-gray-900 truncate">{sup?.name || "(未設定)"}</span>
                                  <span className="text-emerald-700 font-bold tabular-nums ml-2">¥{Number(h.unit_price || 0).toLocaleString()}</span>
                                </div>
                                <div className="text-[10px] text-gray-500">
                                  {new Date(h.created_at).toLocaleDateString("ja-JP")} ・ {h.quantity}個
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
