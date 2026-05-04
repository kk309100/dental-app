"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"

type Clinic = { id: string; name: string }
type Product = { id: string; name: string; product_code: string | null; price: number | null; stock: number | null }
type Row = { product_id: string | null; product_name: string; quantity: number; price: number }

export default function NewOrderPage() {
  const router = useRouter()
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [clinicQuery, setClinicQuery] = useState("")
  const [clinicId, setClinicId] = useState("")
  const [rows, setRows] = useState<Row[]>([{ product_id: null, product_name: "", quantity: 1, price: 0 }])
  const [status, setStatus] = useState<string>("注文受付")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    (async () => {
      const [c, p] = await Promise.all([
        supabase.from("clinics").select("id,name").order("name"),
        supabase.from("products").select("id,name,product_code,price,stock").order("name"),
      ])
      setClinics((c.data as Clinic[]) || [])
      setProducts((p.data as Product[]) || [])
    })()
  }, [])

  const clinicByName = useMemo(() => new Map(clinics.map((c) => [c.name, c])), [clinics])
  const productByName = useMemo(() => new Map(products.map((p) => [p.name, p])), [products])

  function pickClinic(name: string) {
    setClinicQuery(name)
    const c = clinicByName.get(name)
    setClinicId(c?.id || "")
  }

  function updateRow(idx: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  function pickProduct(idx: number, name: string) {
    const p = productByName.get(name)
    if (p) {
      updateRow(idx, {
        product_id: p.id,
        product_name: p.name,
        price: Number(p.price || 0),
      })
    } else {
      updateRow(idx, { product_id: null, product_name: name })
    }
  }

  function addRow() {
    setRows((prev) => [...prev, { product_id: null, product_name: "", quantity: 1, price: 0 }])
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx))
  }

  const total = useMemo(
    () => rows.reduce((s, r) => s + Number(r.price || 0) * Number(r.quantity || 0), 0),
    [rows]
  )

  async function generateDeliveryNumber() {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, "0")
    const d = String(now.getDate()).padStart(2, "0")
    const dateStr = `${y}${m}${d}`
    const { data } = await supabase
      .from("orders")
      .select("id")
      .gte("created_at", `${y}-${m}-${d}T00:00:00`)
      .lte("created_at", `${y}-${m}-${d}T23:59:59`)
    const count = (data?.length || 0) + 1
    return `DN-${dateStr}-${String(count).padStart(4, "0")}`
  }

  async function save() {
    if (!clinicId) {
      alert("医院を選択してください")
      return
    }
    const validRows = rows.filter((r) => r.product_name && Number(r.quantity) > 0)
    if (validRows.length === 0) {
      alert("商品を1行以上入力してください")
      return
    }
    setSaving(true)
    const deliveryNumber = await generateDeliveryNumber()
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert([{
        clinic_id: clinicId,
        status,
        total_price: total,
        delivery_number: deliveryNumber,
      }])
      .select()
      .single()
    if (orderError || !order) {
      console.error(orderError)
      alert("注文作成エラー: " + (orderError?.message || ""))
      setSaving(false)
      return
    }
    const items = validRows.map((r) => ({
      order_id: order.id,
      product_id: r.product_id,
      product_name: r.product_name,
      quantity: Number(r.quantity),
      price: Number(r.price),
    }))
    const { error: itemError } = await supabase.from("order_items").insert(items)
    if (itemError) {
      console.error(itemError)
      alert("注文明細エラー: " + itemError.message)
      setSaving(false)
      return
    }
    alert(`注文を作成しました（${deliveryNumber}）`)
    router.push("/admin/orders")
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900">
          新規注文
          <span className="ml-2 text-xs font-normal text-gray-400">医院を選び、商品を入力</span>
        </h1>
        <Link href="/admin/orders" className="text-xs text-gray-500 underline">← 注文一覧に戻る</Link>
      </div>

      {/* 医院選択 */}
      <div className="bg-white rounded-lg p-3 space-y-2" style={{ border: "1px solid #e8eaed" }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-gray-700 w-16">医院</span>
          <input
            list="clinic-list"
            value={clinicQuery}
            onChange={(e) => pickClinic(e.target.value)}
            placeholder="医院名を入力（候補から選択）"
            className="flex-1 min-w-[240px] px-3 py-2 border border-gray-200 rounded text-sm bg-white"
          />
          <datalist id="clinic-list">
            {clinics.map((c) => <option key={c.id} value={c.name} />)}
          </datalist>
          <span className="text-xs font-bold text-gray-700">ステータス</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-2 py-2 border border-gray-200 rounded text-sm bg-white">
            {["注文受付", "確認中", "準備中", "納品済み"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {clinicQuery && !clinicId && (
          <p className="text-xs text-red-600">⚠ 「{clinicQuery}」は医院マスタにありません。<Link href="/admin/clinics" className="underline">医院マスタで追加</Link></p>
        )}
      </div>

      {/* 商品行 */}
      <div className="bg-white rounded-lg overflow-hidden" style={{ border: "1px solid #e8eaed" }}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-xs text-gray-500">
              <th className="px-2 py-2 text-left w-10">#</th>
              <th className="px-2 py-2 text-left">商品名</th>
              <th className="px-2 py-2 text-right w-24">数量</th>
              <th className="px-2 py-2 text-right w-28">単価</th>
              <th className="px-2 py-2 text-right w-28">金額</th>
              <th className="px-2 py-2 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx} className="border-t border-gray-100">
                <td className="px-2 py-1 text-xs text-gray-400">{idx + 1}</td>
                <td className="px-2 py-1">
                  <input
                    list="product-list"
                    value={r.product_name}
                    onChange={(e) => pickProduct(idx, e.target.value)}
                    placeholder="商品名（候補から選択 or 手入力）"
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm"
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    type="number"
                    value={r.quantity}
                    onChange={(e) => updateRow(idx, { quantity: Number(e.target.value) })}
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm text-right"
                    min={0}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    type="number"
                    value={r.price}
                    onChange={(e) => updateRow(idx, { price: Number(e.target.value) })}
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm text-right"
                    min={0}
                  />
                </td>
                <td className="px-2 py-1 text-right text-sm tabular-nums text-gray-700">
                  {fmtYen(Number(r.price || 0) * Number(r.quantity || 0))}
                </td>
                <td className="px-2 py-1 text-center">
                  <button onClick={() => removeRow(idx)} className="text-gray-400 hover:text-red-500 text-sm" title="削除">×</button>
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
        <datalist id="product-list">
          {products.map((p) => <option key={p.id} value={p.name}>{p.product_code || ""} ¥{p.price?.toLocaleString() || 0}</option>)}
        </datalist>
        <div className="p-2 border-t border-gray-100 bg-gray-50">
          <button onClick={addRow} className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded hover:bg-gray-100">＋ 行を追加</button>
        </div>
      </div>

      {/* 保存 */}
      <div className="flex items-center justify-end gap-2 pt-2">
        <Link href="/admin/orders" className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">キャンセル</Link>
        <button
          onClick={save}
          disabled={saving || !clinicId || rows.filter((r) => r.product_name && r.quantity > 0).length === 0}
          className="px-5 py-2 text-sm font-bold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {saving ? "保存中…" : "✓ 注文を作成"}
        </button>
      </div>
    </div>
  )
}
