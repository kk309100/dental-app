"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { calcTax, fmtYen, ymd } from "@/lib/invoice"
import { generateQuoteNumber, defaultExpiryDate } from "@/lib/quote"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"

export default function CreateQuotePageWrapper() {
  return (
    <Suspense fallback={<p className="text-gray-400 text-center py-12">読み込み中…</p>}>
      <CreateQuotePage />
    </Suspense>
  )
}

type Clinic = { id: string; name: string; corporate_name?: string | null }
type Product = { id: string; name: string; price: number | null; cost: number | null }

type Line = {
  productId: string | null
  productName: string
  quantity: number
  cost: number       // 仕入価格
  listPrice: number  // 定価
  price: number      // 販売価格（実際の単価）
}

type ViewMode = "internal" | "customer"

function CreateQuotePage() {
  const router = useRouter()
  const sp = useSearchParams()
  const fromOrderId = sp.get("from_order")
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [clinicId, setClinicId] = useState("")
  const [issueDate, setIssueDate] = useState(ymd(new Date()))
  const [expiryDate, setExpiryDate] = useState(defaultExpiryDate(new Date()))
  const [lines, setLines] = useState<Line[]>([{ productId: null, productName: "", quantity: 1, cost: 0, listPrice: 0, price: 0 }])
  const [notes, setNotes] = useState("")
  const [error, setError] = useState("")
  const [viewMode, setViewMode] = useState<ViewMode>("internal")

  // 一括掛け率 / 一括粗利率
  const [bulkRate, setBulkRate] = useState<string>("80")  // 80% など

  const [productSearch, setProductSearch] = useState("")
  const [openLineIdx, setOpenLineIdx] = useState<number | null>(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [c, p] = await Promise.all([
      supabase.from("clinics").select("id,name,corporate_name").order("name").limit(50000),
      supabase.from("products").select("id,name,price,cost").order("name").limit(50000),
    ])
    setClinics(c.data || [])
    setProducts((p.data as Product[]) || [])

    // ?from_order=xxx で注文から見積コピー
    if (fromOrderId) {
      const { data: o } = await supabase.from("orders").select("clinic_id").eq("id", fromOrderId).single()
      const { data: items } = await supabase.from("order_items").select("product_id,product_name,quantity,price").eq("order_id", fromOrderId)
      if (o?.clinic_id) setClinicId(o.clinic_id)
      if (items && items.length > 0) {
        // 商品マスタから cost と listPrice を引く
        const productMap = new Map((p.data as Product[] || []).map(pp => [pp.id, pp]))
        setLines(items.map((it: any) => {
          const prod = it.product_id ? productMap.get(it.product_id) : null
          return {
            productId: it.product_id,
            productName: it.product_name || "",
            quantity: Number(it.quantity || 1),
            cost: Number(prod?.cost || 0),
            listPrice: Number(prod?.price || it.price || 0),
            price: Number(it.price || 0),
          }
        }))
        setNotes(`注文 #${fromOrderId.slice(0, 8)} から作成`)
      }
    }
    setLoading(false)
  }

  const filteredProducts = useMemo(() => {
    const k = productSearch.toLowerCase().normalize("NFKC")
    if (!k) return products.slice(0, 50)
    return products.filter((p) => p.name.toLowerCase().normalize("NFKC").includes(k)).slice(0, 50)
  }, [products, productSearch])

  function updateLine(idx: number, partial: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, ...partial } : l))
  }
  function addLine() {
    setLines((prev) => [...prev, { productId: null, productName: "", quantity: 1, cost: 0, listPrice: 0, price: 0 }])
  }
  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx))
  }
  function pickProduct(idx: number, p: Product) {
    const cost = Number(p.cost || 0)
    const listPrice = Number(p.price || 0)
    updateLine(idx, {
      productId: p.id,
      productName: p.name,
      cost,
      listPrice,
      price: listPrice,  // 初期値は定価。ユーザーが粗利/掛け率で調整
    })
    setOpenLineIdx(null)
    setProductSearch("")
  }

  // 計算ヘルパー
  const calcGross = (cost: number, price: number) => price - cost
  const calcGrossRate = (cost: number, price: number) => price > 0 ? Math.round((price - cost) / price * 1000) / 10 : 0
  const calcMarkup = (listPrice: number, price: number) => listPrice > 0 ? Math.round(price / listPrice * 1000) / 10 : 0

  // 粗利率から販売価格を逆算
  function priceFromGrossRate(cost: number, grossRate: number): number {
    if (grossRate >= 100) return Math.round(cost * 100)
    return Math.round(cost / (1 - grossRate / 100))
  }
  // 掛け率から販売価格を逆算
  function priceFromMarkup(listPrice: number, markup: number): number {
    return Math.round(listPrice * markup / 100)
  }

  // 各行の編集ハンドラ
  function setLinePrice(idx: number, price: number) { updateLine(idx, { price }) }
  function setLineGrossRate(idx: number, rate: number) {
    const l = lines[idx]
    updateLine(idx, { price: priceFromGrossRate(l.cost, rate) })
  }
  function setLineMarkup(idx: number, markup: number) {
    const l = lines[idx]
    updateLine(idx, { price: priceFromMarkup(l.listPrice, markup) })
  }

  // 一括掛け率（全行）
  function applyBulkMarkup() {
    const r = Number(bulkRate)
    if (!r || r <= 0) return
    setLines(prev => prev.map(l => ({ ...l, price: priceFromMarkup(l.listPrice, r) })))
  }
  // 一括粗利率（全行）
  function applyBulkGrossRate() {
    const r = Number(bulkRate)
    if (!r || r <= 0 || r >= 100) return
    setLines(prev => prev.map(l => ({ ...l, price: priceFromGrossRate(l.cost, r) })))
  }

  const subtotal = lines.reduce((s, l) => s + (l.price || 0) * (l.quantity || 0), 0)
  const totalCost = lines.reduce((s, l) => s + (l.cost || 0) * (l.quantity || 0), 0)
  const totalGross = subtotal - totalCost
  const totalGrossRate = subtotal > 0 ? Math.round(totalGross / subtotal * 1000) / 10 : 0
  const tax = calcTax(subtotal)
  const total = subtotal + tax

  async function createQuote() {
    setError("")
    if (!clinicId) { setError("医院を選択してください"); return }
    const validLines = lines.filter((l) => l.productName.trim() && l.quantity > 0)
    if (validLines.length === 0) { setError("明細を1件以上入力してください"); return }

    setSubmitting(true)
    try {
      const quote_number = await generateQuoteNumber(new Date(issueDate))
      const { data: q, error: e1 } = await supabase
        .from("quotes")
        .insert({
          clinic_id: clinicId,
          quote_number,
          issue_date: issueDate,
          expiry_date: expiryDate || null,
          subtotal, tax, total,
          status: "draft",
          notes: notes || null,
        })
        .select()
        .single()
      if (e1 || !q) throw new Error(e1?.message || "見積書作成失敗")

      const itemsPayload = validLines.map((l, i) => ({
        quote_id: q.id,
        product_id: l.productId,
        product_name: l.productName,
        quantity: l.quantity,
        price: l.price,
        sort_order: i,
      }))
      const { error: e2 } = await supabase.from("quote_items").insert(itemsPayload)
      if (e2) throw new Error("明細保存失敗: " + e2.message)

      router.push(`/admin/quotes/${q.id}`)
    } catch (e) {
      setError((e as Error).message)
      setSubmitting(false)
    }
  }

  if (loading) return <p className="text-center py-12 text-gray-400">読み込み中…</p>

  const isInternal = viewMode === "internal"

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Link href="/admin/quotes" className="text-xs text-gray-500 underline">← 見積書一覧</Link>
        <h1 className="text-lg font-bold text-gray-900">見積書を作成</h1>
        {/* 表示モード切替 */}
        <div className="flex bg-gray-100 rounded-lg p-0.5 text-xs">
          <button onClick={() => setViewMode("internal")}
            className={"px-3 py-1.5 rounded font-bold " + (isInternal ? "bg-white shadow text-gray-900" : "text-gray-500")}>
            🔒 社内詳細（仕入・粗利あり）
          </button>
          <button onClick={() => setViewMode("customer")}
            className={"px-3 py-1.5 rounded font-bold " + (!isInternal ? "bg-white shadow text-gray-900" : "text-gray-500")}>
            🤝 得意先表示
          </button>
        </div>
      </div>

      {error && <div className="text-xs px-3 py-2 rounded bg-red-50 text-red-700" style={{ border: "1px solid #fcc" }}>{error}</div>}

      {/* 医院 + 日付 */}
      <div className="bg-white rounded-lg p-3 grid grid-cols-1 sm:grid-cols-3 gap-3" style={{ border: "1px solid #e8eaed" }}>
        <div>
          <label className="block text-[11px] text-gray-700 font-bold mb-1">① 医院</label>
          <select value={clinicId} onChange={(e) => setClinicId(e.target.value)} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
            <option value="">医院を選択</option>
            {clinics.map((c) => (
              <option key={c.id} value={c.id}>{c.corporate_name ? `${c.corporate_name} ${c.name}` : c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-gray-700 font-bold mb-1">② 発行日</label>
          <input type="date" value={issueDate}
            onChange={(e) => { setIssueDate(e.target.value); setExpiryDate(defaultExpiryDate(new Date(e.target.value))) }}
            className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        </div>
        <div>
          <label className="block text-[11px] text-gray-700 font-bold mb-1">有効期限</label>
          <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        </div>
      </div>

      {/* 一括操作（社内モードのみ） */}
      {isInternal && (
        <div className="bg-amber-50 rounded-lg p-2 flex items-center gap-2 text-xs flex-wrap" style={{ border: "1px solid #fde68a" }}>
          <span className="text-amber-900 font-bold">一括操作:</span>
          <input type="number" value={bulkRate} onChange={(e) => setBulkRate(e.target.value)}
            className="w-20 px-2 py-1 border border-amber-200 rounded text-sm" />
          <span className="text-gray-600">%</span>
          <button onClick={applyBulkMarkup} className="px-3 py-1 bg-blue-600 text-white rounded font-bold">📐 全行 定価×{bulkRate}%</button>
          <button onClick={applyBulkGrossRate} className="px-3 py-1 bg-emerald-600 text-white rounded font-bold">💰 全行 粗利率{bulkRate}%</button>
          <span className="text-[10px] text-gray-500 ml-2">※ 仕入価格 / 定価から販売価格を逆算します</span>
        </div>
      )}

      {/* 明細 */}
      <div className="bg-white rounded-lg overflow-hidden" style={{ border: "1px solid #e8eaed" }}>
        <div className="p-2 bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-700">
          ③ 明細 {isInternal ? "（社内詳細）" : "（得意先表示）"}
        </div>
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr className="text-[10px] text-gray-500">
              <th className="px-2 py-1.5 text-left w-8">#</th>
              <th className="px-2 py-1.5 text-left">商品名</th>
              <th className="px-2 py-1.5 text-right w-16">数量</th>
              {isInternal && <th className="px-2 py-1.5 text-right w-24">仕入価格</th>}
              <th className="px-2 py-1.5 text-right w-24">定価</th>
              <th className="px-2 py-1.5 text-right w-24">販売価格</th>
              {isInternal && <th className="px-2 py-1.5 text-right w-20">粗利</th>}
              {isInternal && <th className="px-2 py-1.5 text-right w-20">粗利%</th>}
              <th className="px-2 py-1.5 text-right w-20">掛け%</th>
              <th className="px-2 py-1.5 text-right w-24">小計</th>
              <th className="px-2 py-1.5 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const gross = calcGross(l.cost, l.price)
              const grossRate = calcGrossRate(l.cost, l.price)
              const markup = calcMarkup(l.listPrice, l.price)
              const lineSubtotal = l.price * l.quantity
              const grossWarn = isInternal && l.cost > 0 && grossRate < 20
              return (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-2 py-1 text-gray-400">{i + 1}</td>
                  <td className="px-2 py-1 relative">
                    <input
                      value={l.productName}
                      onChange={(e) => { updateLine(i, { productName: e.target.value }); setOpenLineIdx(i); setProductSearch(e.target.value) }}
                      onFocus={() => { setOpenLineIdx(i); setProductSearch(l.productName) }}
                      placeholder="商品名（マスタ候補）"
                      className="w-full px-2 py-1 border border-gray-200 rounded text-xs"
                    />
                    {openLineIdx === i && filteredProducts.length > 0 && (
                      <div style={dropdown}>
                        {filteredProducts.map((p) => (
                          <button key={p.id} onClick={() => pickProduct(i, p)} style={dropItem}>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{p.name}</div>
                            <div style={{ fontSize: 10, color: "#888" }}>
                              定価 {fmtYen(p.price || 0)} / 仕入 {fmtYen(p.cost || 0)}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" value={l.quantity}
                      onChange={(e) => updateLine(i, { quantity: Number(e.target.value) || 0 })}
                      className="w-full px-1 py-0.5 border border-gray-200 rounded text-right text-xs" />
                  </td>
                  {isInternal && (
                    <td className="px-2 py-1">
                      <input type="number" value={l.cost}
                        onChange={(e) => updateLine(i, { cost: Number(e.target.value) || 0 })}
                        className="w-full px-1 py-0.5 border border-gray-200 rounded text-right text-xs bg-gray-50"
                        title="仕入価格（商品マスタから自動）" />
                    </td>
                  )}
                  <td className="px-2 py-1">
                    <input type="number" value={l.listPrice}
                      onChange={(e) => updateLine(i, { listPrice: Number(e.target.value) || 0 })}
                      className="w-full px-1 py-0.5 border border-gray-200 rounded text-right text-xs"
                      title="定価（商品マスタから自動、編集可）" />
                  </td>
                  <td className="px-2 py-1">
                    <input type="number" value={l.price}
                      onChange={(e) => setLinePrice(i, Number(e.target.value) || 0)}
                      className="w-full px-1 py-0.5 border border-blue-300 rounded text-right text-xs font-bold bg-blue-50"
                      title="得意先に出る販売価格" />
                  </td>
                  {isInternal && (
                    <td className={"px-2 py-1 text-right tabular-nums " + (gross < 0 ? "text-red-600 font-bold" : "text-gray-700")}>
                      {fmtYen(gross)}
                    </td>
                  )}
                  {isInternal && (
                    <td className="px-2 py-1">
                      <input type="number" value={grossRate}
                        onChange={(e) => setLineGrossRate(i, Number(e.target.value) || 0)}
                        className={"w-full px-1 py-0.5 border rounded text-right text-xs " + (grossWarn ? "border-red-300 bg-red-50 text-red-700 font-bold" : "border-gray-200")}
                        title="粗利率%。編集すると販売価格が逆算される"
                        step="0.1" />
                    </td>
                  )}
                  <td className="px-2 py-1">
                    <input type="number" value={markup}
                      onChange={(e) => setLineMarkup(i, Number(e.target.value) || 0)}
                      className="w-full px-1 py-0.5 border border-gray-200 rounded text-right text-xs"
                      title="掛け率%（販売価格÷定価）。編集すると販売価格が逆算される"
                      step="0.1" />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums font-bold">{fmtYen(lineSubtotal)}</td>
                  <td className="px-2 py-1 text-center">
                    <button onClick={() => removeLine(i)} className="text-red-500 text-sm">×</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-gray-50">
            <tr className="border-t-2 border-gray-300">
              <td colSpan={isInternal ? 9 : 6} className="px-2 py-2 text-right text-xs font-bold text-gray-500">税抜小計</td>
              <td className="px-2 py-2 text-right text-sm font-bold tabular-nums">{fmtYen(subtotal)}</td>
              <td></td>
            </tr>
            {isInternal && totalCost > 0 && (
              <>
                <tr>
                  <td colSpan={9} className="px-2 py-1 text-right text-[10px] text-gray-500">仕入合計 / 粗利合計（社内のみ）</td>
                  <td className="px-2 py-1 text-right text-[11px] tabular-nums">
                    <span className="text-gray-500">{fmtYen(totalCost)}</span> /
                    <span className={totalGross >= 0 ? "text-emerald-700 font-bold ml-1" : "text-red-600 font-bold ml-1"}>
                      {fmtYen(totalGross)} ({totalGrossRate}%)
                    </span>
                  </td>
                  <td></td>
                </tr>
              </>
            )}
            <tr>
              <td colSpan={isInternal ? 9 : 6} className="px-2 py-1 text-right text-xs text-gray-500">消費税 (10%)</td>
              <td className="px-2 py-1 text-right text-xs tabular-nums">{fmtYen(tax)}</td>
              <td></td>
            </tr>
            <tr className="border-t-2 border-gray-300">
              <td colSpan={isInternal ? 9 : 6} className="px-2 py-2 text-right text-sm font-bold">合計（税込）</td>
              <td className="px-2 py-2 text-right text-base font-bold tabular-nums">{fmtYen(total)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        <div className="p-2 border-t border-gray-100 bg-gray-50">
          <button onClick={addLine} className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded hover:bg-gray-100">＋ 行を追加</button>
        </div>
      </div>

      {/* 備考 */}
      <div className="bg-white rounded-lg p-3" style={{ border: "1px solid #e8eaed" }}>
        <label className="block text-[11px] text-gray-700 font-bold mb-1">④ 備考</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" />
      </div>

      {/* 作成ボタン */}
      <div className="flex items-center justify-end gap-2 pt-2 sticky bottom-2 bg-gray-50/80 backdrop-blur p-2 rounded-lg">
        <Link href="/admin/quotes" className="text-xs text-gray-500 hover:bg-gray-100 px-3 py-2 rounded">キャンセル</Link>
        <button onClick={createQuote} disabled={submitting}
          className="px-5 py-2 text-sm font-bold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
          {submitting ? "作成中…" : "✓ 見積書を作成"}
        </button>
      </div>
    </div>
  )
}

const dropdown: React.CSSProperties = { position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #ddd", borderRadius: 6, maxHeight: 240, overflowY: "auto", zIndex: 20, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }
const dropItem: React.CSSProperties = { display: "block", width: "100%", textAlign: "left", padding: "6px 10px", border: "none", background: "#fff", cursor: "pointer", borderBottom: "1px solid #f3f4f6" }
