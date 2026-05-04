"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"

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
type Supplier = { id: string; name: string }
type OrderItem = { product_id: string | null; quantity: number; order_id: string }
type Order = { id: string; status: string }

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
}

export default function SuggestPOPage() {
  const router = useRouter()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [groupSupplier, setGroupSupplier] = useState<string>("")

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [p, s, oi, o] = await Promise.all([
      supabase.from("products").select("id,name,product_code,manufacturer,stock,reorder_level,cost,default_supplier_id"),
      supabase.from("suppliers").select("id,name").order("name"),
      supabase.from("order_items").select("product_id,quantity,order_id"),
      supabase.from("orders").select("id,status").not("status", "in", '("納品済み","キャンセル")'),
    ])
    const products = (p.data as Product[]) || []
    setSuppliers((s.data as Supplier[]) || [])
    const orders = (o.data as Order[]) || []
    const orderIds = new Set(orders.map(o => o.id))
    const items = ((oi.data as OrderItem[]) || []).filter(i => i.order_id && orderIds.has(i.order_id))

    // 商品ごとの未出庫予約数
    const reserved = new Map<string, number>()
    items.forEach(i => {
      if (!i.product_id) return
      reserved.set(i.product_id, (reserved.get(i.product_id) || 0) + Number(i.quantity || 0))
    })

    const list: Suggestion[] = []
    products.forEach(p => {
      const stock = Number(p.stock || 0)
      const reorderLv = Number(p.reorder_level || 0)
      const reservedQty = reserved.get(p.id) || 0
      const effectiveStock = stock - reservedQty
      // 推奨ロジック: (発注点 + 予約済み数) - 在庫 が正なら不足。最低でも1個。
      const shortBy = Math.max(0, (reorderLv + reservedQty) - stock)
      // 提案数: 不足量が0でも reorderLv より下回ってたら半月分くらい補充。シンプルに shortBy + reorderLv で発注。
      const suggestQty = shortBy > 0 ? Math.max(shortBy, Math.ceil(reorderLv * 0.5)) : 0
      if (suggestQty > 0 || effectiveStock < 0) {
        list.push({
          product: p,
          systemStock: stock,
          reorderLevel: reorderLv,
          reservedQty,
          shortBy: Math.max(shortBy, -effectiveStock),
          suggestQty: Math.max(suggestQty, -effectiveStock, 1),
          unitPrice: Number(p.cost || 0),
          selected: true,
        })
      }
    })
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

  async function createPOForSupplier(supId: string) {
    const target = suggestions.filter(s => s.selected && (s.supplierOverride || s.product.default_supplier_id || "") === supId && s.suggestQty > 0)
    if (target.length === 0) { alert("対象なし"); return }
    if (!confirm(`「${supplierName(supId)}」宛に ${target.length} 件の発注書を作成します。`)) return
    const draft = {
      supplier_id: supId,
      rows: target.map(s => ({
        product_id: s.product.id,
        product_name: s.product.name,
        quantity: s.suggestQty,
        unit_price: s.unitPrice,
        note: s.shortBy > 0 ? `在庫${s.systemStock}/予約${s.reservedQty}/不足${s.shortBy}` : "",
      })),
      note: "在庫不足から自動生成",
    }
    sessionStorage.setItem("po:draft", JSON.stringify(draft))
    router.push("/admin/purchase-orders/new")
  }

  if (loading) return <p className="text-gray-400 text-center py-12">在庫を分析中…</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900">
          発注書の自動提案
          <span className="ml-2 text-xs font-normal text-gray-400">在庫不足 + 予約済み数を考慮した発注候補</span>
        </h1>
        <Link href="/admin/purchase-orders" className="text-xs text-gray-500 underline">← 発注書一覧</Link>
      </div>

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
          <p className="text-xs font-bold text-blue-900 mb-1">仕入先別 発注予定</p>
          <div className="flex flex-wrap gap-2">
            {Array.from(summary.entries()).map(([sid, amt]) => (
              <button key={sid} onClick={() => sid !== "(未設定)" && createPOForSupplier(sid)}
                disabled={sid === "(未設定)"}
                className="text-xs px-3 py-1.5 bg-white border border-blue-200 rounded hover:bg-blue-100 disabled:opacity-50">
                <span className="font-bold">{supplierName(sid as string)}</span>
                <span className="ml-2 text-blue-700 tabular-nums">{fmtYen(amt)}</span>
                {sid !== "(未設定)" && <span className="ml-2 text-blue-500">→ 発注書作成</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0" }}>
        <table className="w-full text-xs">
          <thead className="bg-gray-100 sticky top-0">
            <tr className="text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-2 py-1.5 text-center w-8"></th>
              <th className="px-2 py-1.5 text-left">商品</th>
              <th className="px-2 py-1.5 text-right w-16">在庫</th>
              <th className="px-2 py-1.5 text-right w-16">予約</th>
              <th className="px-2 py-1.5 text-right w-16">発注点</th>
              <th className="px-2 py-1.5 text-right w-16">不足</th>
              <th className="px-2 py-1.5 text-right w-20">提案数</th>
              <th className="px-2 py-1.5 text-right w-24">単価</th>
              <th className="px-2 py-1.5 text-right w-24">小計</th>
              <th className="px-2 py-1.5 text-left w-44">仕入先</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-6 text-center text-gray-400">不足商品なし 🎉</td></tr>
            ) : filtered.map((s, idx) => {
              const realIdx = suggestions.indexOf(s)
              return (
                <tr key={s.product.id} className={"border-b border-gray-100 " + (idx % 2 === 0 ? "" : "bg-gray-50/30")}>
                  <td className="px-2 py-1 text-center">
                    <input type="checkbox" checked={s.selected} onChange={e => update(realIdx, { selected: e.target.checked })} />
                  </td>
                  <td className="px-2 py-1">
                    <div className="font-bold text-gray-900">{s.product.name}</div>
                    <div className="text-[10px] text-gray-500">{s.product.product_code || ""} {s.product.manufacturer || ""}</div>
                  </td>
                  <td className={"px-2 py-1 text-right tabular-nums " + (s.systemStock <= 0 ? "text-red-600 font-bold" : "text-gray-700")}>{s.systemStock}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-gray-500">{s.reservedQty || "—"}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-gray-500">{s.reorderLevel || "—"}</td>
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
                    <select value={s.supplierOverride || s.product.default_supplier_id || ""}
                      onChange={e => update(realIdx, { supplierOverride: e.target.value })}
                      className="w-full px-1.5 py-0.5 border border-gray-200 rounded text-xs">
                      <option value="">(未設定)</option>
                      {suppliers.map(sup => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
