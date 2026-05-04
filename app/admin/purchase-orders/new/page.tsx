"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"

type Supplier = { id: string; name: string }
type Product = { id: string; name: string; product_code: string | null; cost: number | null; default_supplier_id?: string | null }
type Row = { product_id: string | null; product_name: string; quantity: number; unit_price: number; note?: string }

export default function NewPOWrapper() {
  return (
    <Suspense fallback={<p className="text-gray-400 text-center py-12">読み込み中…</p>}>
      <NewPOPage />
    </Suspense>
  )
}

function NewPOPage() {
  const router = useRouter()
  const sp = useSearchParams()
  const initialSupplier = sp.get("supplier") || ""

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [supplierId, setSupplierId] = useState(initialSupplier)
  const [orderedAt, setOrderedAt] = useState(new Date().toISOString().slice(0, 10))
  const [expectedAt, setExpectedAt] = useState("")
  const [sentMethod, setSentMethod] = useState("FAX")
  const [note, setNote] = useState("")
  const [rows, setRows] = useState<Row[]>([{ product_id: null, product_name: "", quantity: 1, unit_price: 0 }])
  const [saving, setSaving] = useState(false)

  // 自動提案からのデータ
  useEffect(() => {
    const draft = typeof window !== "undefined" ? sessionStorage.getItem("po:draft") : null
    if (draft) {
      try {
        const d = JSON.parse(draft)
        if (d.supplier_id) setSupplierId(d.supplier_id)
        if (d.rows) setRows(d.rows)
        if (d.note) setNote(d.note)
        sessionStorage.removeItem("po:draft")
      } catch { /* ignore */ }
    }
  }, [])

  useEffect(() => {
    (async () => {
      const [s, p] = await Promise.all([
        supabase.from("suppliers").select("id,name").order("name"),
        supabase.from("products").select("id,name,product_code,cost,default_supplier_id").order("name"),
      ])
      setSuppliers((s.data as Supplier[]) || [])
      setProducts((p.data as Product[]) || [])
    })()
  }, [])

  const productByName = useMemo(() => new Map(products.map(p => [p.name, p])), [products])

  function updateRow(idx: number, patch: Partial<Row>) {
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  function pickProduct(idx: number, name: string) {
    const p = productByName.get(name)
    if (p) updateRow(idx, { product_id: p.id, product_name: p.name, unit_price: Number(p.cost || 0) })
    else updateRow(idx, { product_id: null, product_name: name })
  }
  const addRow = () => setRows(prev => [...prev, { product_id: null, product_name: "", quantity: 1, unit_price: 0 }])
  const removeRow = (idx: number) => setRows(prev => prev.length === 1 ? [{ product_id: null, product_name: "", quantity: 1, unit_price: 0 }] : prev.filter((_, i) => i !== idx))

  const total = useMemo(() => rows.reduce((s, r) => s + Number(r.quantity || 0) * Number(r.unit_price || 0), 0), [rows])

  async function generatePoNumber() {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, "0")
    const d = String(now.getDate()).padStart(2, "0")
    const { data } = await supabase.from("purchase_orders").select("id").gte("created_at", `${y}-${m}-${d}T00:00:00`).lte("created_at", `${y}-${m}-${d}T23:59:59`)
    const count = (data?.length || 0) + 1
    return `PO-${y}${m}${d}-${String(count).padStart(3, "0")}`
  }

  async function save(asDraft = false) {
    if (!supplierId) { alert("仕入先を選択してください"); return }
    const valid = rows.filter(r => r.product_name && Number(r.quantity) > 0)
    if (valid.length === 0) { alert("商品を1行以上入力してください"); return }
    setSaving(true)
    const poNumber = await generatePoNumber()
    const { data: po, error: poErr } = await supabase.from("purchase_orders").insert([{
      po_number: poNumber,
      supplier_id: supplierId,
      status: asDraft ? "下書き" : "発注済",
      ordered_at: asDraft ? null : new Date(orderedAt + "T12:00:00").toISOString(),
      expected_at: expectedAt || null,
      total_amount: total,
      sent_method: asDraft ? null : sentMethod,
      sent_at: asDraft ? null : new Date().toISOString(),
      note: note || null,
    }]).select().single()
    if (poErr || !po) { alert("発注書作成失敗: " + (poErr?.message || "")); setSaving(false); return }
    const items = valid.map(r => ({
      purchase_order_id: po.id,
      product_id: r.product_id,
      product_name: r.product_name,
      quantity: Number(r.quantity),
      unit_price: Number(r.unit_price),
      note: r.note || null,
    }))
    const { error: ie } = await supabase.from("purchase_order_items").insert(items)
    if (ie) { alert("明細作成失敗: " + ie.message); setSaving(false); return }
    alert(`発注書を${asDraft ? "下書き保存" : "発注済として作成"}しました（${poNumber}）`)
    router.push(`/admin/purchase-orders/${po.id}`)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900">新規発注書</h1>
        <Link href="/admin/purchase-orders" className="text-xs text-gray-500 underline">← 一覧</Link>
      </div>

      <div className="bg-white rounded-lg p-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center" style={{ border: "1px solid #e8eaed" }}>
        <label className="sm:col-span-1 text-xs font-bold text-gray-700">仕入先 *</label>
        <select value={supplierId} onChange={e => setSupplierId(e.target.value)}
          className="sm:col-span-5 px-2 py-2 border border-gray-200 rounded text-sm bg-white">
          <option value="">選択してください</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="sm:col-span-1 text-xs font-bold text-gray-700">発注日</label>
        <input type="date" value={orderedAt} onChange={e => setOrderedAt(e.target.value)}
          className="sm:col-span-2 px-2 py-2 border border-gray-200 rounded text-sm bg-white" />
        <label className="sm:col-span-1 text-xs font-bold text-gray-700">納期</label>
        <input type="date" value={expectedAt} onChange={e => setExpectedAt(e.target.value)}
          className="sm:col-span-2 px-2 py-2 border border-gray-200 rounded text-sm bg-white" />
      </div>

      <div className="bg-white rounded-lg overflow-hidden" style={{ border: "1px solid #e8eaed" }}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-xs text-gray-500">
              <th className="px-2 py-2 text-left w-10">#</th>
              <th className="px-2 py-2 text-left">商品名</th>
              <th className="px-2 py-2 text-right w-24">数量</th>
              <th className="px-2 py-2 text-right w-28">仕入単価</th>
              <th className="px-2 py-2 text-right w-28">金額</th>
              <th className="px-2 py-2 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx} className="border-t border-gray-100">
                <td className="px-2 py-1 text-xs text-gray-400">{idx + 1}</td>
                <td className="px-2 py-1">
                  <input list="po-product-list" value={r.product_name}
                    onChange={e => pickProduct(idx, e.target.value)}
                    placeholder="商品名"
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm" />
                </td>
                <td className="px-2 py-1">
                  <input type="number" value={r.quantity}
                    onChange={e => updateRow(idx, { quantity: Number(e.target.value) })}
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm text-right" min={0} />
                </td>
                <td className="px-2 py-1">
                  <input type="number" value={r.unit_price}
                    onChange={e => updateRow(idx, { unit_price: Number(e.target.value) })}
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm text-right" min={0} />
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-gray-700">
                  {fmtYen(Number(r.quantity || 0) * Number(r.unit_price || 0))}
                </td>
                <td className="px-2 py-1 text-center">
                  <button onClick={() => removeRow(idx)} className="text-gray-400 hover:text-red-500">×</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 border-t border-gray-200">
              <td colSpan={4} className="px-2 py-2 text-right text-xs font-bold text-gray-500">合計</td>
              <td className="px-2 py-2 text-right text-base font-bold text-gray-900 tabular-nums">{fmtYen(total)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        <datalist id="po-product-list">
          {products.map(p => <option key={p.id} value={p.name}>{p.product_code || ""}</option>)}
        </datalist>
        <div className="p-2 border-t border-gray-100 bg-gray-50">
          <button onClick={addRow} className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded hover:bg-gray-100">＋ 行を追加</button>
        </div>
      </div>

      <div className="bg-white rounded-lg p-3 flex flex-wrap gap-3 items-center" style={{ border: "1px solid #e8eaed" }}>
        <label className="text-xs font-bold text-gray-700">送付方法</label>
        <select value={sentMethod} onChange={e => setSentMethod(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm">
          {["FAX", "メール", "電話", "Web", "その他"].map(m => <option key={m}>{m}</option>)}
        </select>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="備考"
          className="flex-1 min-w-[200px] px-2 py-1.5 border border-gray-200 rounded text-sm" />
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Link href="/admin/purchase-orders" className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">キャンセル</Link>
        <button onClick={() => save(true)} disabled={saving}
          className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50">
          {saving ? "保存中…" : "下書き保存"}
        </button>
        <button onClick={() => save(false)} disabled={saving || !supplierId}
          className="px-5 py-2 text-sm font-bold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:bg-gray-300">
          {saving ? "保存中…" : "✓ 発注書を発行"}
        </button>
      </div>
    </div>
  )
}
