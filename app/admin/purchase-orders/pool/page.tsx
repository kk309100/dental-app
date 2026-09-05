"use client"

// 発注プール（仕入先別の下書き発注書）
//
// 業務フロー:
//   注文の「→発注」ボタンで不足商品が仕入先別の下書きにプールされる
//   このページで仕入先ごとに「発注確定」して発注書を発行する

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { confirmPoolPO, discardPoolPO } from "@/lib/po-pool"

type PO = {
  id: string
  po_number: string | null
  supplier_id: string | null
  status: string
  total_amount: number | null
  note: string | null
  created_at: string
}
type POItem = {
  id: string
  purchase_order_id: string
  product_id: string | null
  product_name: string | null
  quantity: number
  unit_price: number
  note: string | null
}
type Supplier = { id: string; name: string }

export default function POPoolPage() {
  const [pos, setPos] = useState<PO[]>([])
  const [items, setItems] = useState<POItem[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [manufacturerByProduct, setManufacturerByProduct] = useState<Map<string, string>>(new Map())

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [pRes, sRes] = await Promise.all([
      supabase.from("purchase_orders").select("*").eq("status", "下書き").order("created_at", { ascending: false }).limit(50000),
      supabase.from("suppliers").select("id,name").order("name").limit(50000),
    ])
    const draftPOs = (pRes.data as PO[]) || []
    setPos(draftPOs)
    setSuppliers((sRes.data as Supplier[]) || [])

    if (draftPOs.length > 0) {
      const ids = draftPOs.map(p => p.id)
      const { data: itms } = await supabase
        .from("purchase_order_items")
        .select("*")
        .in("purchase_order_id", ids)
        .limit(50000)
      const itemsData = (itms as POItem[]) || []
      setItems(itemsData)
      const productIds = Array.from(new Set(itemsData.map(i => i.product_id).filter((id): id is string => !!id)))
      if (productIds.length > 0) {
        const { data: prods } = await supabase.from("products").select("id,manufacturer").in("id", productIds)
        const map = new Map<string, string>()
        ;(prods || []).forEach((pr: any) => { if (pr.manufacturer) map.set(pr.id, pr.manufacturer) })
        setManufacturerByProduct(map)
      }
    } else {
      setItems([])
    }
    setLoading(false)
  }

  const supplierById = useMemo(() => new Map(suppliers.map(s => [s.id, s])), [suppliers])
  const itemsByPO = useMemo(() => {
    const m = new Map<string, POItem[]>()
    items.forEach(it => {
      if (!m.has(it.purchase_order_id)) m.set(it.purchase_order_id, [])
      m.get(it.purchase_order_id)!.push(it)
    })
    return m
  }, [items])

  async function handleConfirm(poId: string, supplierName: string, total: number) {
    if (!confirm(`${supplierName} へ ${fmtYen(total)} の発注書を発行しますか？\n（発注済みになり、編集不可になります。送付済みの記録は、印刷やFAX送信済みボタンを押した時点で付きます）`)) return
    setBusy(poId)
    const r = await confirmPoolPO(poId)
    setBusy(null)
    if (!r.ok) { alert("確定失敗: " + r.error); return }
    alert(`✅ ${supplierName} への発注書を発行しました。`)
    fetchData()
  }

  async function handleDiscard(poId: string, supplierName: string) {
    if (!confirm(`${supplierName} の下書き発注書を破棄しますか？\n（明細も全て削除されます）`)) return
    setBusy(poId)
    const r = await discardPoolPO(poId)
    setBusy(null)
    if (!r.ok) { alert("削除失敗: " + r.error); return }
    fetchData()
  }

  async function handleConfirmAll() {
    const targets = pos.filter(p => p.supplier_id) // 仕入先未定は一括確定の対象外
    if (targets.length === 0) return
    if (!confirm(`プール中の ${targets.length}社 すべての発注書を発行しますか？\n※仕入先未定のものは対象外です。\n※送付済みの記録は、印刷やFAX送信済みボタンを押した時点で付きます。`)) return
    setBusy("all")
    let success = 0, fail = 0
    for (const po of targets) {
      const r = await confirmPoolPO(po.id)
      if (r.ok) success++; else fail++
    }
    setBusy(null)
    alert(`完了: ${success}社 発行 / 失敗 ${fail}社`)
    fetchData()
  }

  async function assignSupplier(poId: string, supplierId: string) {
    if (!supplierId) return
    await supabase.from("purchase_orders").update({ supplier_id: supplierId }).eq("id", poId)
    fetchData()
  }

  // 「仕入先未定」PO内の1明細だけを、選んだ仕入先の下書きPOへ移動する
  async function assignItemSupplier(item: POItem, supplierId: string) {
    if (!supplierId) return
    setBusy(item.id)
    try {
      // 1. 移動先の下書きPOを探す（既存があれば流用、無ければ新規作成）
      const { data: existing } = await supabase
        .from("purchase_orders")
        .select("id,total_amount")
        .eq("supplier_id", supplierId)
        .eq("status", "下書き")
        .order("created_at", { ascending: false })
        .limit(1)

      let targetPoId: string
      let targetExistingTotal = 0
      if (existing && existing.length > 0) {
        targetPoId = existing[0].id
        targetExistingTotal = Number(existing[0].total_amount || 0)
      } else {
        const now = new Date()
        const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`
        const rand = Math.floor(Math.random() * 9000) + 1000
        const { data: newPo, error } = await supabase
          .from("purchase_orders")
          .insert({
            po_number: `POOL-${stamp}-${rand}`,
            supplier_id: supplierId,
            status: "下書き",
            total_amount: 0,
            note: "発注プール（医院注文から集約）",
          })
          .select()
          .single()
        if (error || !newPo) { alert("移動先の発注書作成に失敗: " + (error?.message || "")); return }
        targetPoId = newPo.id
      }

      // 2. 明細を移動
      const fromPoId = item.purchase_order_id
      const { error: moveErr } = await supabase.from("purchase_order_items").update({ purchase_order_id: targetPoId }).eq("id", item.id)
      if (moveErr) { alert("移動失敗: " + moveErr.message); return }

      // 3. 移動元・移動先それぞれの合計金額を再計算
      const itemTotal = Number(item.quantity) * Number(item.unit_price || 0)
      await supabase.from("purchase_orders").update({ total_amount: targetExistingTotal + itemTotal }).eq("id", targetPoId)

      const { data: remaining } = await supabase.from("purchase_order_items").select("quantity,unit_price").eq("purchase_order_id", fromPoId)
      if (remaining && remaining.length > 0) {
        const newFromTotal = remaining.reduce((s, r) => s + Number(r.quantity) * Number(r.unit_price || 0), 0)
        await supabase.from("purchase_orders").update({ total_amount: newFromTotal }).eq("id", fromPoId)
      } else {
        // 明細が空になった「仕入先未定」POは片付ける
        await supabase.from("purchase_orders").delete().eq("id", fromPoId)
      }

      fetchData()
    } finally {
      setBusy(null)
    }
  }

  async function updateItemQty(itemId: string, newQty: number) {
    if (newQty <= 0) return
    await supabase.from("purchase_order_items").update({ quantity: newQty }).eq("id", itemId)
    fetchData()
  }

  async function deleteItem(itemId: string) {
    if (!confirm("この明細行を削除しますか？")) return
    await supabase.from("purchase_order_items").delete().eq("id", itemId)
    fetchData()
  }

  if (loading) return <p className="text-center py-12 text-gray-400">読み込み中…</p>

  const totalAcrossAll = pos.reduce((s, p) => s + Number(p.total_amount || 0), 0)
  const totalItems = items.length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900" style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: 0 }}>
          🛒 発注プール
          <span className="ml-2 text-xs font-normal text-gray-400">
            {pos.length}仕入先 / {totalItems}明細 / 合計 {fmtYen(totalAcrossAll)}
          </span>
        </h1>
        <div className="flex items-center gap-2">
          <Link href="/admin/purchase-orders" className="text-xs text-gray-500 underline">← 発注書一覧</Link>
          {pos.filter(p => p.supplier_id).length > 0 && (
            <button
              onClick={handleConfirmAll}
              disabled={busy === "all"}
              className="px-3 py-2 bg-emerald-600 text-white text-sm font-bold rounded hover:bg-emerald-700 disabled:opacity-50">
              {busy === "all" ? "処理中…" : `🚀 全部一括発注確定 (${pos.filter(p => p.supplier_id).length}社)`}
            </button>
          )}
        </div>
      </div>

      <div className="bg-blue-50 rounded p-2 text-xs text-gray-700" style={{ border: "1px solid #c7d2fe" }}>
        💡 注文の「→発注」ボタンを押すと、不足商品が仕入先ごとに集約されます。<br />
        半日 or 1日溜めた後、各仕入先の「✓ 発注確定」ボタンで発注書を発行（FAX/メール送付）。
      </div>

      {pos.length === 0 ? (
        <div className="bg-white rounded-lg p-8 text-center" style={{ border: "1px solid #e8eaed" }}>
          <p className="text-gray-400 text-sm">プール中の下書き発注書はありません</p>
          <p className="text-[12px] text-gray-400 mt-2">
            注文一覧で「→発注」ボタンを押すと、ここに不足商品が仕入先別に集約されます
          </p>
          <Link href="/admin/orders" className="inline-block mt-3 text-xs text-blue-600 underline">→ 注文一覧へ</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {pos.map(po => {
            const supplier = po.supplier_id ? supplierById.get(po.supplier_id) : null
            const isUnassigned = !po.supplier_id
            const supplierName = isUnassigned ? "仕入先未定" : (supplier?.name || "(削除済み仕入先)")
            const poItems = itemsByPO.get(po.id) || []
            const total = poItems.reduce((s, it) => s + Number(it.quantity) * Number(it.unit_price || 0), 0)
            return (
              <div key={po.id} className="bg-white rounded-lg overflow-hidden" style={{ border: isUnassigned ? "2px solid #fdba74" : "2px solid #e8eaed" }}>
                {/* ヘッダ */}
                <div className={"px-3 py-2 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2 " + (isUnassigned ? "bg-orange-50" : "bg-gradient-to-r from-amber-50 to-yellow-50")}>
                  <div className="flex items-center gap-3">
                    <span className="text-base font-bold text-gray-900">{isUnassigned ? "⚠️" : "🏭"} {supplierName}</span>
                    <span className="text-[12px] text-gray-500 font-mono">{po.po_number}</span>
                    <span className="text-xs text-gray-600">{poItems.length}品 / {fmtYen(total)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isUnassigned ? (
                      <>
                        <select
                          defaultValue=""
                          onChange={e => assignSupplier(po.id, e.target.value)}
                          className="px-2 py-1 border border-orange-300 rounded text-xs bg-white">
                          <option value="">仕入先を選択…</option>
                          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </>
                    ) : (
                      <button
                        onClick={() => handleConfirm(po.id, supplierName, total)}
                        disabled={busy === po.id || poItems.length === 0}
                        className="px-3 py-1.5 bg-emerald-600 text-white text-sm font-bold rounded hover:bg-emerald-700 disabled:opacity-50">
                        ✓ 発注確定 (FAX)
                      </button>
                    )}
                    <Link href={`/admin/purchase-orders/${po.id}`} className="text-xs text-blue-600 underline">編集</Link>
                    <button
                      onClick={() => handleDiscard(po.id, supplierName)}
                      disabled={busy === po.id}
                      className="text-xs text-red-600 underline disabled:opacity-50">
                      破棄
                    </button>
                  </div>
                </div>
                {/* 明細 */}
                <div className="overflow-x-auto">
                <table className="w-full text-[13px]" style={{ minWidth: 640 }}>
                  <thead className="bg-gray-50">
                    <tr className="text-[12px] text-gray-500">
                      <th className="px-2 py-1 text-left">商品名</th>
                      <th className="px-2 py-1 text-left">納品先（医院）</th>
                      <th className="px-2 py-1 text-right w-16">数量</th>
                      <th className="px-2 py-1 text-right w-24">単価</th>
                      <th className="px-2 py-1 text-right w-24">小計</th>
                      {isUnassigned && <th className="px-2 py-1 text-left w-40">仕入先</th>}
                      <th className="px-2 py-1 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {poItems.length === 0 ? (
                      <tr><td colSpan={isUnassigned ? 7 : 6} className="px-4 py-4 text-center text-gray-400">明細なし</td></tr>
                    ) : poItems.map(it => (
                      <tr key={it.id} className="border-t border-gray-100">
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {it.product_name || "(商品名なし)"}
                          {it.product_id && manufacturerByProduct.has(it.product_id) && (
                            <span style={{ marginLeft: 6, fontSize: 11, color: "#888" }}>［{manufacturerByProduct.get(it.product_id)}］</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-[12px] text-gray-500 whitespace-nowrap">{it.note || "—"}</td>
                        <td className="px-2 py-1.5 text-right">
                          <input type="number"
                            defaultValue={it.quantity}
                            onBlur={e => { const v = Number(e.target.value); if (v !== it.quantity) updateItemQty(it.id, v) }}
                            className="w-12 px-1 py-0.5 border border-gray-200 rounded text-right text-xs" />
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmtYen(it.unit_price || 0)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-bold">{fmtYen(Number(it.quantity) * Number(it.unit_price || 0))}</td>
                        {isUnassigned && (
                          <td className="px-2 py-1.5">
                            <select
                              defaultValue=""
                              disabled={busy === it.id}
                              onChange={e => assignItemSupplier(it, e.target.value)}
                              className="w-full px-1.5 py-0.5 border border-orange-300 rounded text-[11px] bg-white">
                              <option value="">この商品の仕入先…</option>
                              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </td>
                        )}
                        <td className="px-2 py-1.5 text-center">
                          <button onClick={() => deleteItem(it.id)} className="text-red-500 text-sm">×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
