"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { fetchAllClinicPrices, makeClinicPriceMap, clinicPriceKey, bulkUpsertClinicPrices, type ClinicPrice } from "@/lib/pricing"

export default function NewOrderPageWrapper() {
  return (
    <Suspense fallback={<p className="text-gray-400 text-center py-12">読み込み中…</p>}>
      <NewOrderPage />
    </Suspense>
  )
}

type Clinic = { id: string; name: string; corporate_name?: string | null }
type Product = { id: string; name: string; product_code: string | null; price: number | null; stock: number | null; manufacturer?: string | null; category?: string | null }
type Row = { product_id: string | null; product_name: string; quantity: number; price: number; note?: string }
type RecentOrder = { id: string; clinic_id: string; created_at: string; total_price: number; delivery_number: string | null }

const SALES_REP_KEY = "dental-app:sales_rep"
const RECENT_CLINIC_KEY = "dental-app:recent_clinic"
const DRAFT_KEY = "dental-app:order_draft"

// 半角・全角・カナ・ひらがな・大文字小文字を統一して検索可能にする
function nfkc(s: string) { return String(s || "").normalize("NFKC").toLowerCase() }
function kata(s: string) { return s.replace(/[ぁ-ん]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60)) }
function searchKey(s: string) { return kata(nfkc(s)) }

function NewOrderPage() {
  const router = useRouter()
  const search = useSearchParams()
  const copyFromId = search.get("copy") // 過去注文コピー
  const initialClinicId = search.get("clinic")

  const [clinics, setClinics] = useState<Clinic[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([])
  const [clinicQuery, setClinicQuery] = useState("")
  const [clinicId, setClinicId] = useState("")
  const [rows, setRows] = useState<Row[]>([{ product_id: null, product_name: "", quantity: 1, price: 0 }])
  const [status, setStatus] = useState<string>("注文受付")
  const [note, setNote] = useState("")
  const [salesRep, setSalesRep] = useState("")
  const [saving, setSaving] = useState(false)
  const [showRecent, setShowRecent] = useState(false)
  const [productSearch, setProductSearch] = useState("")
  const [showProductPicker, setShowProductPicker] = useState<number | null>(null)
  const [showClinicPicker, setShowClinicPicker] = useState(false)
  const [clinicSearchInPicker, setClinicSearchInPicker] = useState("")
  // 医院別価格マスタ（pickProduct 時の単価自動補完に使う）
  const [clinicPrices, setClinicPrices] = useState<ClinicPrice[]>([])
  const clinicPriceMap = useMemo(() => makeClinicPriceMap(clinicPrices), [clinicPrices])

  // 初期ロード: 営業マン名を localStorage から復元
  useEffect(() => {
    if (typeof window === "undefined") return
    setSalesRep(localStorage.getItem(SALES_REP_KEY) || "")
  }, [])

  useEffect(() => {
    (async () => {
      const [c, p, cp] = await Promise.all([
        supabase.from("clinics").select("id,name,corporate_name").order("name").limit(50000),
        supabase.from("products").select("id,name,product_code,price,stock,manufacturer,category").order("name").limit(50000),
        fetchAllClinicPrices(),  // 医院別価格マスタ
      ])
      setClinics((c.data as Clinic[]) || [])
      setProducts((p.data as Product[]) || [])
      setClinicPrices(cp)

      // 過去注文コピー処理
      if (copyFromId) {
        const { data: srcOrder } = await supabase.from("orders").select("*").eq("id", copyFromId).single()
        const { data: srcItems } = await supabase.from("order_items").select("*").eq("order_id", copyFromId)
        if (srcOrder) {
          setClinicId(srcOrder.clinic_id)
          const cl = (c.data as Clinic[] | null)?.find(x => x.id === srcOrder.clinic_id)
          if (cl) setClinicQuery(cl.name)
        }
        if (srcItems && srcItems.length > 0) {
          setRows(srcItems.map((it: any) => ({
            product_id: it.product_id,
            product_name: it.product_name || "",
            quantity: Number(it.quantity || 1),
            price: Number(it.price || 0),
          })))
        }
      } else if (initialClinicId) {
        setClinicId(initialClinicId)
        const cl = (c.data as Clinic[] | null)?.find(x => x.id === initialClinicId)
        if (cl) setClinicQuery(cl.name)
      } else {
        // 直近選択した医院を復元
        const recent = typeof window !== "undefined" ? localStorage.getItem(RECENT_CLINIC_KEY) : null
        if (recent) {
          const cl = (c.data as Clinic[] | null)?.find(x => x.id === recent)
          if (cl) { setClinicId(cl.id); setClinicQuery(cl.name) }
        }
      }
    })()
  }, [copyFromId, initialClinicId])

  // 医院IDが決まったらその医院の最近の注文を取得（コピー候補表示用）
  useEffect(() => {
    if (!clinicId) { setRecentOrders([]); return }
    (async () => {
      const { data } = await supabase
        .from("orders")
        .select("id,clinic_id,created_at,total_price,delivery_number")
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: false })
        .limit(8)
      setRecentOrders((data as RecentOrder[]) || [])
    })()
  }, [clinicId])

  const clinicByName = useMemo(() => {
    const m = new Map<string, Clinic>()
    clinics.forEach(c => m.set(c.name, c))
    return m
  }, [clinics])

  // 商品ピッカー: NFKC + カタカナ統一で検索
  const filteredProducts = useMemo(() => {
    if (!productSearch) return products.slice(0, 50)
    const k = searchKey(productSearch)
    return products.filter(p => {
      const target = searchKey([p.name, p.product_code, p.manufacturer, p.category].filter(Boolean).join(" "))
      return target.includes(k)
    }).slice(0, 50)
  }, [products, productSearch])

  function pickClinic(name: string) {
    setClinicQuery(name)
    const c = clinicByName.get(name)
    if (c) {
      setClinicId(c.id)
      if (typeof window !== "undefined") localStorage.setItem(RECENT_CLINIC_KEY, c.id)
    } else {
      setClinicId("")
    }
  }

  function updateRow(idx: number, patch: Partial<Row>) {
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  function pickProduct(idx: number, p: Product) {
    // ★ 医院別単価マスタから優先取得 → 無ければ商品標準価格
    const clinicPrice = clinicId ? clinicPriceMap.get(clinicPriceKey(clinicId, p.id)) : undefined
    const finalPrice = clinicPrice !== undefined ? clinicPrice : Number(p.price || 0)
    updateRow(idx, {
      product_id: p.id,
      product_name: p.name,
      price: finalPrice,
    })
    setShowProductPicker(null)
    setProductSearch("")
  }

  function addRow() {
    setRows(prev => [...prev, { product_id: null, product_name: "", quantity: 1, price: 0 }])
  }

  function removeRow(idx: number) {
    setRows(prev => prev.length === 1
      ? [{ product_id: null, product_name: "", quantity: 1, price: 0 }]
      : prev.filter((_, i) => i !== idx)
    )
  }

  function clearAll() {
    if (!confirm("入力中の内容をすべてクリアしますか？")) return
    setRows([{ product_id: null, product_name: "", quantity: 1, price: 0 }])
    setNote("")
    setStatus("注文受付")
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
    // 当日件数 + ランダム3桁で衝突回避
    const { data } = await supabase
      .from("orders")
      .select("id")
      .gte("created_at", `${y}-${m}-${d}T00:00:00`)
      .lte("created_at", `${y}-${m}-${d}T23:59:59`)
    const count = (data?.length || 0) + 1
    const rand = Math.floor(Math.random() * 900) + 100
    return `DN-${dateStr}-${String(count).padStart(4, "0")}-${rand}`
  }

  async function copyFromRecent(orderId: string) {
    const { data: srcItems } = await supabase.from("order_items").select("*").eq("order_id", orderId)
    if (srcItems && srcItems.length > 0) {
      setRows(srcItems.map((it: any) => ({
        product_id: it.product_id,
        product_name: it.product_name || "",
        quantity: Number(it.quantity || 1),
        price: Number(it.price || 0),
      })))
      setShowRecent(false)
    }
  }

  async function save() {
    if (!clinicId) { alert("医院を選択してください"); return }
    const validRows = rows.filter(r => r.product_name && Number(r.quantity) > 0)
    if (validRows.length === 0) { alert("商品を1行以上入力してください"); return }
    setSaving(true)
    if (typeof window !== "undefined") localStorage.setItem(SALES_REP_KEY, salesRep)

    const deliveryNumber = await generateDeliveryNumber()
    const orderInsert: Record<string, unknown> = {
      clinic_id: clinicId,
      status,
      total_price: total,
      delivery_number: deliveryNumber,
    }
    // 新スキーマ: sales_rep / note / source / delivered_at
    if (salesRep) orderInsert.sales_rep = salesRep
    if (note) orderInsert.note = note
    orderInsert.source = "admin"
    if (status === "納品済み") orderInsert.delivered_at = new Date().toISOString()

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert([orderInsert])
      .select()
      .single()
    if (orderError || !order) {
      // 新スキーマ列が無い場合のフォールバック
      const { data: order2, error: e2 } = await supabase
        .from("orders")
        .insert([{ clinic_id: clinicId, status, total_price: total, delivery_number: deliveryNumber }])
        .select()
        .single()
      if (e2 || !order2) {
        alert("注文作成エラー: " + (e2?.message || orderError?.message || ""))
        setSaving(false); return
      }
      const items = validRows.map(r => ({
        order_id: order2.id, product_id: r.product_id, product_name: r.product_name,
        quantity: Number(r.quantity), price: Number(r.price),
      }))
      const { error: ie } = await supabase.from("order_items").insert(items)
      if (ie) { alert("明細エラー: " + ie.message); setSaving(false); return }
      // ★ 医院別単価マスタを学習
      await bulkUpsertClinicPrices(clinicId, validRows.map(r => ({ product_id: r.product_id, price: Number(r.price) })))
      alert(`注文を作成しました（${deliveryNumber}）※新スキーマ未適用のため、営業マン名等は保存されていません`)
      router.push("/admin/orders"); return
    }

    const items = validRows.map(r => ({
      order_id: order.id, product_id: r.product_id, product_name: r.product_name,
      quantity: Number(r.quantity), price: Number(r.price),
    }))
    const { error: ie } = await supabase.from("order_items").insert(items)
    if (ie) { alert("明細エラー: " + ie.message); setSaving(false); return }

    // ★ 医院別単価マスタを最新価格で学習（次回同じ医院×商品はこの単価が自動補完される）
    await bulkUpsertClinicPrices(clinicId, validRows.map(r => ({ product_id: r.product_id, price: Number(r.price) })))

    alert(`注文を作成しました（${deliveryNumber}）`)
    router.push("/admin/orders")
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827" }}>
          新規注文
          <span className="ml-2 text-xs font-normal text-gray-400">医院を選び、商品を入力</span>
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={clearAll} className="text-xs text-gray-500 hover:text-red-500 underline">クリア</button>
          <Link href="/admin/orders" className="text-xs text-gray-500 underline">← 一覧</Link>
        </div>
      </div>

      {/* ヘッダ: 医院・営業マン・ステータス */}
      <div className="bg-white rounded-lg p-3 space-y-2" style={{ border: "1px solid #e8eaed" }}>
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
          <label className="sm:col-span-1 text-xs font-bold text-gray-700">医院</label>
          {/* 医院ピッカー: クリックでモーダル展開、検索可能 */}
          <button
            type="button"
            onClick={() => { setShowClinicPicker(true); setClinicSearchInPicker("") }}
            className="sm:col-span-6 px-3 py-2 border border-gray-200 rounded text-sm bg-white text-left hover:bg-blue-50 flex items-center justify-between"
          >
            <span className={clinicId ? "text-gray-900 font-bold" : "text-gray-400"}>
              {clinicId ? clinicQuery : "🔍 医院を選択（クリック）"}
            </span>
            <span className="text-gray-400 text-xs">▼</span>
          </button>
          <label className="sm:col-span-1 text-xs font-bold text-gray-700">担当</label>
          <input
            value={salesRep}
            onChange={e => setSalesRep(e.target.value)}
            placeholder="営業マン名"
            className="sm:col-span-2 px-3 py-2 border border-gray-200 rounded text-sm bg-white"
          />
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="sm:col-span-2 px-2 py-2 border border-gray-200 rounded text-sm bg-white"
          >
            {["注文受付", "確認中", "準備中", "納品済み"].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {clinicId && recentOrders.length > 0 && (
          <div>
            <button onClick={() => setShowRecent(s => !s)} className="text-xs text-blue-600 hover:underline">
              {showRecent ? "▼" : "▶"} この医院の過去注文（{recentOrders.length}件）からコピー
            </button>
            {showRecent && (
              <div className="mt-2 space-y-1 bg-gray-50 p-2 rounded">
                {recentOrders.map(o => (
                  <button
                    key={o.id}
                    onClick={() => copyFromRecent(o.id)}
                    className="block w-full text-left text-xs px-2 py-1.5 bg-white border border-gray-200 rounded hover:bg-blue-50"
                  >
                    <span className="text-gray-500">{new Date(o.created_at).toLocaleDateString("ja-JP")}</span>
                    <span className="ml-2 font-bold text-gray-700">{o.delivery_number || o.id.slice(0, 8)}</span>
                    <span className="ml-2 text-gray-600">{fmtYen(o.total_price)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 商品行: PC table / モバイル card */}
      <div className="bg-white rounded-lg overflow-hidden" style={{ border: "1px solid #e8eaed" }}>
        {/* PC: テーブル */}
        <table className="w-full text-sm hidden sm:table">
          <thead className="bg-gray-50">
            <tr style={{ fontSize: 12, fontWeight: 700 }} className="text-gray-500">
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
                  <div className="flex items-center gap-1">
                    <input
                      value={r.product_name}
                      onChange={e => updateRow(idx, { product_name: e.target.value, product_id: null })}
                      placeholder="商品名（手入力 or 🔍）"
                      className="flex-1 px-2 py-1 border border-gray-200 rounded text-sm"
                    />
                    <button
                      onClick={() => { setShowProductPicker(idx); setProductSearch("") }}
                      className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
                      title="商品マスタから選択"
                    >🔍</button>
                  </div>
                </td>
                <td className="px-2 py-1">
                  <input type="number" value={r.quantity}
                    onChange={e => updateRow(idx, { quantity: Number(e.target.value) })}
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm text-right" min={0} />
                </td>
                <td className="px-2 py-1">
                  <input type="number" value={r.price}
                    onChange={e => updateRow(idx, { price: Number(e.target.value) })}
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm text-right" min={0} />
                </td>
                <td className="px-2 py-1 text-right text-sm tabular-nums text-gray-700">
                  {fmtYen(Number(r.price || 0) * Number(r.quantity || 0))}
                </td>
                <td className="px-2 py-1 text-center">
                  <button onClick={() => removeRow(idx)} className="text-gray-400 hover:text-red-500 text-sm">×</button>
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

        {/* モバイル: カード */}
        <div className="sm:hidden divide-y divide-gray-100">
          {rows.map((r, idx) => (
            <div key={idx} className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400 font-bold">商品 #{idx + 1}</span>
                <button onClick={() => removeRow(idx)} className="text-xs text-red-500">削除</button>
              </div>
              <div className="flex items-center gap-1">
                <input
                  value={r.product_name}
                  onChange={e => updateRow(idx, { product_name: e.target.value, product_id: null })}
                  placeholder="商品名"
                  className="flex-1 px-3 py-2 border border-gray-200 rounded text-base"
                />
                <button
                  onClick={() => { setShowProductPicker(idx); setProductSearch("") }}
                  className="px-3 py-2 text-base bg-gray-100 hover:bg-gray-200 rounded"
                >🔍</button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label style={{ fontSize: 12 }} className="text-gray-500">数量</label>
                  <input type="number" value={r.quantity}
                    onChange={e => updateRow(idx, { quantity: Number(e.target.value) })}
                    className="w-full px-2 py-2 border border-gray-200 rounded text-base text-right" min={0} />
                </div>
                <div>
                  <label style={{ fontSize: 12 }} className="text-gray-500">単価</label>
                  <input type="number" value={r.price}
                    onChange={e => updateRow(idx, { price: Number(e.target.value) })}
                    className="w-full px-2 py-2 border border-gray-200 rounded text-base text-right" min={0} />
                </div>
                <div>
                  <label style={{ fontSize: 12 }} className="text-gray-500">金額</label>
                  <div className="px-2 py-2 text-base text-right font-bold text-gray-900 tabular-nums">
                    {fmtYen(Number(r.price || 0) * Number(r.quantity || 0))}
                  </div>
                </div>
              </div>
            </div>
          ))}
          <div className="bg-gray-50 px-3 py-3 flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500">合計</span>
            <span className="text-lg font-bold text-gray-900 tabular-nums">{fmtYen(total)}</span>
          </div>
        </div>

        <div className="p-2 border-t border-gray-100 bg-gray-50">
          <button onClick={addRow} className="w-full sm:w-auto px-3 py-2 sm:py-1.5 bg-white border border-gray-200 rounded text-sm hover:bg-gray-100">＋ 行を追加</button>
        </div>
      </div>

      {/* メモ */}
      <div className="bg-white rounded-lg p-3" style={{ border: "1px solid #e8eaed" }}>
        <label className="text-xs font-bold text-gray-700">メモ（社内連絡・特記事項）</label>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
          placeholder="例: 至急配達 / 段ボール厳重梱包 / 領収書同梱 等"
          className="mt-1 w-full px-3 py-2 border border-gray-200 rounded text-sm bg-white"
        />
      </div>

      {/* 保存 */}
      <div className="flex items-center justify-end gap-2 pt-2 sticky bottom-2 bg-gray-50/80 backdrop-blur p-2 rounded-lg">
        <Link href="/admin/orders" className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">キャンセル</Link>
        <button
          onClick={save}
          disabled={saving || !clinicId || rows.filter(r => r.product_name && r.quantity > 0).length === 0}
          className="px-5 py-3 sm:py-2 text-sm font-bold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {saving ? "保存中…" : "✓ 注文を作成"}
        </button>
      </div>

      {/* 医院ピッカー モーダル */}
      {showClinicPicker && (() => {
        const k = searchKey(clinicSearchInPicker)
        const filteredClinics = !k ? clinics : clinics.filter(c => {
          const target = searchKey(`${c.name} ${c.corporate_name || ""}`)
          return target.includes(k)
        })
        return (
          <div
            className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-2"
            onClick={() => setShowClinicPicker(false)}
          >
            <div
              className="bg-white rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-3 border-b border-gray-100">
                <h3 className="text-sm font-bold mb-2">🏥 医院を選択</h3>
                <input
                  autoFocus
                  value={clinicSearchInPicker}
                  onChange={e => setClinicSearchInPicker(e.target.value)}
                  placeholder="医院名・法人名で検索（カナ/半角全角OK）"
                  className="w-full px-3 py-2 border border-gray-200 rounded text-sm"
                />
                <p style={{ fontSize: 12 }} className="text-gray-500 mt-1">{filteredClinics.length}/{clinics.length}件</p>
              </div>
              <div className="flex-1 overflow-y-auto">
                {filteredClinics.length === 0 ? (
                  <p className="p-6 text-center text-gray-400 text-sm">該当医院なし</p>
                ) : (
                  filteredClinics.map(c => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setClinicId(c.id)
                        setClinicQuery(c.name)
                        setShowClinicPicker(false)
                        setClinicSearchInPicker("")
                        if (typeof window !== "undefined") localStorage.setItem(RECENT_CLINIC_KEY, c.id)
                      }}
                      className={"w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-100 " + (clinicId === c.id ? "bg-blue-100" : "")}
                    >
                      <p className="text-sm font-bold text-gray-900">{c.name}</p>
                      {c.corporate_name && <p className="text-xs text-gray-500">{c.corporate_name}</p>}
                    </button>
                  ))
                )}
              </div>
              <div className="p-2 border-t border-gray-100 flex items-center justify-between">
                <Link href="/admin/clinics" className="text-xs text-gray-500 underline">医院マスタで追加 →</Link>
                <button onClick={() => setShowClinicPicker(false)} className="text-xs text-gray-500 underline">閉じる</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* 商品ピッカー モーダル */}
      {showProductPicker !== null && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-2"
          onClick={() => setShowProductPicker(null)}
        >
          <div
            className="bg-white rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-3 border-b border-gray-100">
              <input
                autoFocus
                value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
                placeholder="商品名・コード・メーカー・カテゴリで検索（カナ/半角全角OK）"
                className="w-full px-3 py-2 border border-gray-200 rounded text-sm"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredProducts.length === 0 ? (
                <p className="p-6 text-center text-gray-400 text-sm">該当商品なし</p>
              ) : (
                filteredProducts.map(p => {
                  const clinicSpecificPrice = clinicId ? clinicPriceMap.get(clinicPriceKey(clinicId, p.id)) : undefined
                  const standardPrice = Number(p.price || 0)
                  const hasClinicPrice = clinicSpecificPrice !== undefined && clinicSpecificPrice !== standardPrice
                  return (
                  <button
                    key={p.id}
                    onClick={() => pickProduct(showProductPicker, p)}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-100"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-gray-900">{p.name}</p>
                        <p className="text-xs text-gray-500">
                          {p.product_code && <span className="mr-2">#{p.product_code}</span>}
                          {p.manufacturer && <span className="mr-2">{p.manufacturer}</span>}
                          {p.category && <span>{p.category}</span>}
                        </p>
                      </div>
                      <div className="text-right">
                        {hasClinicPrice ? (
                          <>
                            <p className="text-sm font-bold text-emerald-700 tabular-nums">
                              💡 ¥{clinicSpecificPrice!.toLocaleString()}
                              <span className="ml-1 font-normal text-emerald-600" style={{ fontSize: 11 }}>医院別</span>
                            </p>
                            <p style={{ fontSize: 11 }} className="text-gray-400 line-through tabular-nums">標準 ¥{standardPrice.toLocaleString()}</p>
                          </>
                        ) : (
                          <p className="text-sm font-bold text-gray-900 tabular-nums">¥{standardPrice.toLocaleString()}</p>
                        )}
                        <p className={"text-xs " + ((p.stock || 0) > 0 ? "text-gray-500" : "text-red-500")}>
                          在庫 {p.stock || 0}
                        </p>
                      </div>
                    </div>
                  </button>
                  )
                })
              )}
            </div>
            <div className="p-2 border-t border-gray-100 text-right">
              <button onClick={() => setShowProductPicker(null)} className="text-xs text-gray-500 underline">閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
