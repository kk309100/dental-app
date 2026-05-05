"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { fetchSuppliersByUsage, supplierOptionLabel, type Supplier } from "@/lib/supplier-sort"
import { COMPANY } from "@/lib/company"
import Seal from "@/app/components/Seal"
import { fetchAllSupplierPrices, makeSupplierPriceMap, supplierPriceKey, bulkUpsertSupplierPrices, type SupplierPrice } from "@/lib/pricing"
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
  const [showPreview, setShowPreview] = useState(false)
  // 仕入先別価格マスタ（pickProduct 時の単価自動補完）
  const [supplierPrices, setSupplierPrices] = useState<SupplierPrice[]>([])
  const supplierPriceMap = useMemo(() => makeSupplierPriceMap(supplierPrices), [supplierPrices])

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
      const [sups, p, sp] = await Promise.all([
        fetchSuppliersByUsage("id,name"),
        supabase.from("products").select("id,name,product_code,cost,default_supplier_id").order("name").limit(50000),
        fetchAllSupplierPrices(),  // 仕入先別価格マスタ
      ])
      setSuppliers(sups)
      setProducts((p.data as Product[]) || [])
      setSupplierPrices(sp)
    })()
  }, [])

  const productByName = useMemo(() => new Map(products.map(p => [p.name, p])), [products])

  function updateRow(idx: number, patch: Partial<Row>) {
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  function pickProduct(idx: number, name: string) {
    const p = productByName.get(name)
    if (p) {
      // ★ 仕入先別単価マスタから優先取得 → 無ければ商品標準仕入価格 (cost)
      const supplierPrice = supplierId ? supplierPriceMap.get(supplierPriceKey(supplierId, p.id)) : undefined
      const finalPrice = supplierPrice !== undefined ? supplierPrice : Number(p.cost || 0)
      updateRow(idx, { product_id: p.id, product_name: p.name, unit_price: finalPrice })
    } else {
      updateRow(idx, { product_id: null, product_name: name })
    }
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
    if (ie) {
      // 明細失敗 → ヘッダもロールバック削除
      await supabase.from("purchase_orders").delete().eq("id", po.id)
      alert(`明細作成失敗: ${ie.message}\n\n発注書も取消しました。\n\n💡 RLS エラーの場合は db/migrations/2026-05-05_disable_rls_again.sql を Supabase Studio で実行してください。`)
      setSaving(false); return
    }

    // ★ 仕入先別単価マスタを最新価格で学習（次回同じ仕入先×商品はこの単価が自動補完される）
    await bulkUpsertSupplierPrices(supplierId, valid.map(r => ({ product_id: r.product_id, unit_price: Number(r.unit_price) })))

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
          {suppliers.map(s => <option key={s.id} value={s.id}>{supplierOptionLabel(s)}</option>)}
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
            {rows.map((r, idx) => {
              // この仕入先 × この商品 のマスタ単価
              const masterPrice = (supplierId && r.product_id) ? supplierPriceMap.get(supplierPriceKey(supplierId, r.product_id)) : undefined
              const masterDiffers = masterPrice !== undefined && masterPrice !== Number(r.unit_price)
              return (
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
                  {masterDiffers && (
                    <button
                      type="button"
                      onClick={() => updateRow(idx, { unit_price: masterPrice! })}
                      className="text-[10px] text-emerald-700 hover:underline mt-0.5 block w-full text-right"
                      title="この仕入先の登録単価を適用">
                      💡 マスタ ¥{masterPrice!.toLocaleString()} を適用
                    </button>
                  )}
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-gray-700">
                  {fmtYen(Number(r.quantity || 0) * Number(r.unit_price || 0))}
                </td>
                <td className="px-2 py-1 text-center">
                  <button onClick={() => removeRow(idx)} className="text-gray-400 hover:text-red-500">×</button>
                </td>
              </tr>
              )
            })}
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
        <button onClick={() => setShowPreview(true)} disabled={!supplierId || rows.filter(r => r.product_name).length === 0}
          className="px-4 py-2 text-sm bg-blue-100 text-blue-800 rounded hover:bg-blue-200 disabled:opacity-50">
          🔍 プレビュー
        </button>
        <button onClick={() => save(true)} disabled={saving}
          className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50">
          {saving ? "保存中…" : "下書き保存"}
        </button>
        <button onClick={() => save(false)} disabled={saving || !supplierId}
          className="px-5 py-2 text-sm font-bold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:bg-gray-300">
          {saving ? "保存中…" : "✓ 発注書を発行"}
        </button>
      </div>

      {/* プレビューモーダル */}
      {showPreview && (() => {
        const sup = suppliers.find(s => s.id === supplierId)
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setShowPreview(false)}>
            <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="p-3 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
                <h2 className="text-base font-bold">📄 発注書プレビュー</h2>
                <div className="flex gap-2">
                  <button onClick={() => window.print()} className="text-xs px-3 py-1.5 bg-gray-900 text-white rounded">🖨 印刷</button>
                  <button onClick={() => setShowPreview(false)} className="text-xs px-3 py-1.5 text-gray-500">閉じる</button>
                </div>
              </div>
              <div className="p-8 print-area" style={{ color: "#222", fontSize: 12 }}>
                <header style={{ borderBottom: "2px solid #111", paddingBottom: 8 }}>
                  <h1 style={{ fontSize: 28, letterSpacing: "0.3em", margin: "20px 0 4px", textAlign: "center" }}>発 注 書</h1>
                  <p style={{ textAlign: "center", margin: 0, fontSize: 11, color: "#666" }}>(プレビュー)</p>
                </header>
                <div style={{ display: "flex", gap: 20, marginTop: 24 }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontSize: 22, fontWeight: 700, borderBottom: "1px solid #111", paddingBottom: 6 }}>
                      {sup?.name || "(仕入先未選択)"} 御中
                    </p>
                  </div>
                  <div style={{ flexShrink: 0, fontSize: 11, lineHeight: 1.6, position: "relative", paddingRight: 70 }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{COMPANY.name}</p>
                    <p style={{ margin: 0 }}>〒{COMPANY.postalCode}</p>
                    <p style={{ margin: 0 }}>{COMPANY.address}</p>
                    <p style={{ margin: 0 }}>TEL {COMPANY.phone}</p>
                    {COMPANY.fax && <p style={{ margin: 0 }}>FAX {COMPANY.fax}</p>}
                    <div style={{ position: "absolute", top: 0, right: 0 }}>
                      <Seal size={64} />
                    </div>
                  </div>
                </div>
                <table style={{ width: "100%", marginTop: 18, borderCollapse: "collapse", fontSize: 12 }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: "4px 8px", background: "#f9fafb", fontSize: 11, color: "#555", width: 80, borderRight: "1px solid #eee" }}>発注日</td>
                      <td style={{ padding: "4px 8px", fontSize: 11, color: "#111", borderRight: "1px solid #eee" }}>{orderedAt ? new Date(orderedAt).toLocaleDateString("ja-JP") : "—"}</td>
                      <td style={{ padding: "4px 8px", background: "#f9fafb", fontSize: 11, color: "#555", width: 80, borderRight: "1px solid #eee" }}>納期希望</td>
                      <td style={{ padding: "4px 8px", fontSize: 11, color: "#111" }}>{expectedAt ? new Date(expectedAt).toLocaleDateString("ja-JP") : "—"}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "4px 8px", background: "#f9fafb", fontSize: 11, color: "#555", borderRight: "1px solid #eee" }}>送付方法</td>
                      <td colSpan={3} style={{ padding: "4px 8px", fontSize: 11, color: "#111" }}>{sentMethod}</td>
                    </tr>
                  </tbody>
                </table>
                <table style={{ width: "100%", marginTop: 16, borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#f3f4f6" }}>
                      <th style={{ padding: "6px 8px", textAlign: "left", borderBottom: "2px solid #ddd", fontSize: 11, color: "#555" }}>商品名</th>
                      <th style={{ padding: "6px 8px", textAlign: "right", borderBottom: "2px solid #ddd", fontSize: 11, color: "#555", width: 80 }}>数量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.filter(r => r.product_name).map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                        <td style={{ padding: "6px 8px", fontSize: 12 }}>
                          {r.product_name}
                          {r.note && <p style={{ margin: "2px 0 0", fontSize: 9, color: "#999" }}>{r.note}</p>}
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontSize: 12 }}>{r.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ marginTop: 12, fontSize: 10, color: "#666" }}>※ 単価・金額は貴社見積書にてご確認ください。</p>
                {note && (
                  <div style={{ marginTop: 16, padding: 10, background: "#f9fafb", borderRadius: 4, fontSize: 11, color: "#555" }}>
                    備考: {note}
                  </div>
                )}
              </div>
              <div className="p-3 border-t border-gray-200 sticky bottom-0 bg-white flex items-center justify-end gap-2">
                <button onClick={() => setShowPreview(false)} className="px-4 py-2 text-sm text-gray-600">閉じる</button>
                <button onClick={() => { setShowPreview(false); save(false) }} disabled={saving || !supplierId}
                  className="px-5 py-2 text-sm font-bold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:bg-gray-300">
                  {saving ? "保存中…" : "✓ この内容で発注書を発行"}
                </button>
              </div>
            </div>
            <style jsx global>{`
              @media print {
                body > div:not(.print-keep) { display: none !important; }
                .print-area { padding: 0 !important; }
              }
            `}</style>
          </div>
        )
      })()}
    </div>
  )
}
