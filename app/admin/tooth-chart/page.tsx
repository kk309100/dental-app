"use client"

// 歯式図から注文する機能
//
// 背景: ルーチェブラケット・エンパワー等、歯の位置ごとに商品コードが
// 分かれる商品は、毎回32本の中から該当商品を探すのが大変。
// あらかじめ「歯の位置 → 商品」の対応をテンプレートとして1回だけ登録
// しておけば、次回からは歯式図をクリックするだけで注文明細を作れる。
//
// 位置コードは実際の商品名の表記（例: "U1R" "L3L"）に合わせて
// 上顎(U)/下顎(L) + 右(R)/左(L) + 歯番号(1〜8、中切歯側が1、奥歯側が8)
// の32区分とする。

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { supabase, fetchAll as fetchAllRows } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { bulkUpsertClinicPrices } from "@/lib/pricing"

type Clinic = { id: string; name: string; corporate_name?: string | null; clinic_code?: string | null }
type Product = { id: string; name: string; product_code: string | null; price: number | null }
type Template = { id: string; name: string; created_at: string }
type TemplateItem = { id: string; template_id: string; position: string; product_id: string | null; product_name: string | null }

function nfkc(s: string) { return String(s || "").normalize("NFKC").toLowerCase() }
function kata(s: string) { return s.replace(/[ぁ-ん]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60)) }
function searchKey(s: string) { return kata(nfkc(s)) }

// 上顎右8〜1・上顎左1〜8、下顎右8〜1・下顎左1〜8 の順（中央が前歯）
const UPPER_R = [8, 7, 6, 5, 4, 3, 2, 1].map(n => `U${n}R`)
const UPPER_L = [1, 2, 3, 4, 5, 6, 7, 8].map(n => `U${n}L`)
const LOWER_R = [8, 7, 6, 5, 4, 3, 2, 1].map(n => `L${n}R`)
const LOWER_L = [1, 2, 3, 4, 5, 6, 7, 8].map(n => `L${n}L`)
const ALL_POSITIONS = [...UPPER_R, ...UPPER_L, ...LOWER_R, ...LOWER_L]

function positionLabel(pos: string): string {
  const arch = pos[0] === "U" ? "上" : "下"
  const side = pos[pos.length - 1] === "R" ? "右" : "左"
  const num = pos.slice(1, -1)
  return `${arch}顎${side}${num}`
}

export default function ToothChartPage() {
  const router = useRouter()

  const [templates, setTemplates] = useState<Template[]>([])
  const [templateId, setTemplateId] = useState("")
  const [templateItems, setTemplateItems] = useState<TemplateItem[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [loading, setLoading] = useState(true)

  const [mode, setMode] = useState<"order" | "edit">("order")
  const [newTemplateName, setNewTemplateName] = useState("")

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    // products は1万件超あるため、Supabase既定の1000件上限に引っかからないよう fetchAll でページング取得する
    const [t, p, c] = await Promise.all([
      supabase.from("tooth_chart_templates").select("*").order("created_at", { ascending: false }),
      fetchAllRows("products", "id,name,product_code,price", (q: any) => q.order("name")),
      supabase.from("clinics").select("id,name,corporate_name,clinic_code").order("name").limit(50000),
    ])
    setTemplates((t.data as Template[]) || [])
    setProducts((p as Product[]) || [])
    setClinics((c.data as Clinic[]) || [])
    setLoading(false)
  }

  async function loadTemplateItems(tid: string) {
    if (!tid) { setTemplateItems([]); return }
    const { data } = await supabase.from("tooth_chart_template_items").select("*").eq("template_id", tid)
    setTemplateItems((data as TemplateItem[]) || [])
  }

  useEffect(() => { loadTemplateItems(templateId) }, [templateId])

  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const itemByPosition = useMemo(() => new Map(templateItems.map(it => [it.position, it])), [templateItems])

  async function createTemplate() {
    const name = newTemplateName.trim()
    if (!name) { alert("テンプレート名を入力してください"); return }
    const { data, error } = await supabase.from("tooth_chart_templates").insert({ name }).select().single()
    if (error || !data) { alert("作成失敗: " + error?.message); return }
    setNewTemplateName("")
    await fetchAll()
    setTemplateId(data.id)
    setMode("edit")
  }

  async function deleteTemplate(tid: string, name: string) {
    if (!confirm(`テンプレート「${name}」を削除しますか？`)) return
    await supabase.from("tooth_chart_template_items").delete().eq("template_id", tid)
    const { error } = await supabase.from("tooth_chart_templates").delete().eq("id", tid)
    if (error) { alert("削除失敗: " + error.message); return }
    if (templateId === tid) setTemplateId("")
    await fetchAll()
  }

  async function assignProduct(position: string, product: Product | null) {
    if (!templateId) return
    const { error } = await supabase.from("tooth_chart_template_items").upsert({
      template_id: templateId,
      position,
      product_id: product?.id || null,
      product_name: product?.name || null,
    }, { onConflict: "template_id,position" })
    if (error) { alert("保存失敗: " + error.message); return }
    await loadTemplateItems(templateId)
  }

  // ── 注文モード ──────────────────────────────────────
  type CartLine = { position: string; productId: string | null; productName: string; quantity: number; price: number }
  const [cart, setCart] = useState<Record<string, CartLine>>({})
  const [clinicId, setClinicId] = useState("")
  const [clinicQuery, setClinicQuery] = useState("")
  const [clinicOpen, setClinicOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  // クリックするたびに数量を1ずつ増やす。取り消す場合はカート側の「×」で行う。
  function clickTooth(position: string) {
    const item = itemByPosition.get(position)
    if (!item || !item.product_id) { alert(`「${positionLabel(position)}」にはまだ商品が割り当てられていません。テンプレート編集で設定してください。`); return }
    const product = productById.get(item.product_id)
    setCart(prev => {
      const existing = prev[position]
      if (existing) {
        return { ...prev, [position]: { ...existing, quantity: existing.quantity + 1 } }
      }
      return {
        ...prev,
        [position]: {
          position,
          productId: item.product_id,
          productName: item.product_name || product?.name || "(不明)",
          quantity: 1,
          price: Number(product?.price || 0),
        },
      }
    })
  }

  function updateCartLine(position: string, patch: Partial<CartLine>) {
    setCart(prev => prev[position] ? { ...prev, [position]: { ...prev[position], ...patch } } : prev)
  }

  function removeCartLine(position: string) {
    setCart(prev => {
      if (!prev[position]) return prev
      const next = { ...prev }
      delete next[position]
      return next
    })
  }

  const cartLines = ALL_POSITIONS.map(p => cart[p]).filter((l): l is CartLine => !!l)
  const cartTotal = cartLines.reduce((s, l) => s + l.price * l.quantity, 0)

  const selectedClinic = clinics.find(c => c.id === clinicId)
  const filteredClinics = useMemo(() => {
    const k = searchKey(clinicQuery)
    if (!k) return clinics.slice(0, 50)
    return clinics.filter(c => searchKey(`${c.name} ${c.corporate_name || ""} ${c.clinic_code || ""}`).includes(k)).slice(0, 50)
  }, [clinics, clinicQuery])

  async function generateDeliveryNumber() {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, "0")
    const d = String(now.getDate()).padStart(2, "0")
    const { data } = await supabase.from("orders").select("id")
      .gte("created_at", `${y}-${m}-${d}T00:00:00`).lte("created_at", `${y}-${m}-${d}T23:59:59`)
    const count = (data?.length || 0) + 1
    const rand = Math.floor(Math.random() * 900) + 100
    return `DN-${y}${m}${d}-${String(count).padStart(4, "0")}-${rand}`
  }

  async function createOrder() {
    if (!clinicId) { alert("医院を選択してください"); return }
    if (cartLines.length === 0) { alert("歯式図から商品を選択してください"); return }
    setSaving(true)
    try {
      const total = cartTotal
      const deliveryNumber = await generateDeliveryNumber()
      const { data: order, error: oe } = await supabase.from("orders").insert({
        clinic_id: clinicId, status: "注文受付", total_price: total,
        delivery_number: deliveryNumber, source: "admin",
        note: `歯式図から作成（${cartLines.map(l => positionLabel(l.position)).join("・")}）`,
      }).select().single()
      if (oe || !order) throw new Error(oe?.message || "注文作成失敗")

      const items = cartLines.map(l => ({
        order_id: order.id, product_id: l.productId, product_name: l.productName,
        quantity: l.quantity, price: l.price,
      }))
      const { error: ie } = await supabase.from("order_items").insert(items)
      if (ie) throw new Error(ie.message)

      await bulkUpsertClinicPrices(clinicId, cartLines.map(l => ({ product_id: l.productId, price: l.price })))

      alert(`✅ 注文を作成しました（${deliveryNumber}）`)
      router.push("/admin/orders")
    } catch (e) {
      alert("エラー: " + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-center py-12 text-gray-400">読み込み中…</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Link href="/admin/orders" className="text-xs text-gray-500 underline">← 注文一覧</Link>
          <h1 className="text-lg font-bold text-gray-900">🦷 歯式図から注文</h1>
        </div>
        <div className="flex bg-gray-100 rounded-lg p-0.5 text-xs">
          <button onClick={() => setMode("order")} className={"px-3 py-1.5 rounded font-bold " + (mode === "order" ? "bg-white shadow text-gray-900" : "text-gray-500")}>🛒 注文する</button>
          <button onClick={() => setMode("edit")} className={"px-3 py-1.5 rounded font-bold " + (mode === "edit" ? "bg-white shadow text-gray-900" : "text-gray-500")}>⚙️ テンプレート編集</button>
        </div>
      </div>

      {/* テンプレート選択 */}
      <div className="bg-white rounded-lg p-3 flex items-center gap-2 flex-wrap" style={{ border: "1px solid #e8eaed" }}>
        <label className="text-[11px] text-gray-700 font-bold">テンプレート</label>
        <select value={templateId} onChange={e => { setTemplateId(e.target.value); setCart({}) }} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white min-w-[220px]">
          <option value="">選択してください</option>
          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {templateId && mode === "edit" && (
          <button onClick={() => deleteTemplate(templateId, templates.find(t => t.id === templateId)?.name || "")}
            className="text-[11px] px-2 py-1.5 rounded border border-red-200 bg-red-50 text-red-700 hover:bg-red-100">🗑 このテンプレートを削除</button>
        )}
        <div className="flex items-center gap-1 ml-auto">
          <input value={newTemplateName} onChange={e => setNewTemplateName(e.target.value)} placeholder="新しいテンプレート名（例：エンパワー2クリア 022）"
            className="px-2 py-1.5 border border-gray-200 rounded text-sm w-64" />
          <button onClick={createTemplate} className="text-[11px] px-3 py-1.5 rounded bg-emerald-600 text-white font-bold hover:bg-emerald-700">＋ 作成</button>
        </div>
      </div>

      {!templateId ? (
        <div className="bg-white rounded-lg p-8 text-center text-gray-400 text-sm" style={{ border: "1px solid #e8eaed" }}>
          テンプレートを選択するか、新しく作成してください
        </div>
      ) : mode === "edit" ? (
        <TemplateEditor
          positions={ALL_POSITIONS}
          itemByPosition={itemByPosition}
          products={products}
          onAssign={assignProduct}
        />
      ) : (
        <>
          {/* 医院選択 */}
          <div className="bg-white rounded-lg p-3" style={{ border: "1px solid #e8eaed", position: "relative" }}>
            <label className="block text-[11px] text-gray-700 font-bold mb-1">① 医院</label>
            <input lang="ja"
              value={clinicOpen ? clinicQuery : (selectedClinic?.name || "")}
              onChange={e => { setClinicQuery(e.target.value); setClinicOpen(true) }}
              onFocus={() => { setClinicQuery(""); setClinicOpen(true) }}
              onBlur={() => setTimeout(() => setClinicOpen(false), 150)}
              placeholder="🔍 医院名・医院コードで検索"
              className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white sm:max-w-sm" />
            {clinicOpen && (
              <div className="absolute z-20 left-3 right-3 sm:right-auto sm:w-96 mt-1 bg-white border border-gray-200 rounded shadow-lg" style={{ maxHeight: 220, overflowY: "auto" }}>
                {filteredClinics.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-400">該当する医院なし</div>
                ) : filteredClinics.map(c => (
                  <button key={c.id} type="button"
                    onMouseDown={e => { e.preventDefault(); setClinicId(c.id); setClinicQuery(""); setClinicOpen(false) }}
                    className={"w-full text-left px-3 py-2 text-sm border-t border-gray-100 hover:bg-blue-50 " + (clinicId === c.id ? "bg-blue-50" : "")}>
                    {c.name}{c.clinic_code && <span className="text-gray-400 ml-1">#{c.clinic_code}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 歯式図 */}
          <ToothChart itemByPosition={itemByPosition} cart={cart} onClickTooth={clickTooth} />

          {/* カート */}
          <div className="bg-white rounded-lg overflow-hidden" style={{ border: "1px solid #e8eaed" }}>
            <div className="p-2 bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-700">② 選択した商品（{cartLines.length}件）</div>
            {cartLines.length === 0 ? (
              <div className="px-3 py-6 text-center text-gray-400 text-sm">歯式図の歯をクリックして選択してください</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr className="text-[10px] text-gray-500">
                    <th className="px-2 py-1.5 text-left w-16">位置</th>
                    <th className="px-2 py-1.5 text-left">商品名</th>
                    <th className="px-2 py-1.5 text-right w-16">数量</th>
                    <th className="px-2 py-1.5 text-right w-24">単価</th>
                    <th className="px-2 py-1.5 text-right w-24">小計</th>
                    <th className="px-2 py-1.5 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {cartLines.map(l => (
                    <tr key={l.position} className="border-t border-gray-100">
                      <td className="px-2 py-1 font-bold text-gray-600">{positionLabel(l.position)}</td>
                      <td className="px-2 py-1">{l.productName}</td>
                      <td className="px-2 py-1">
                        <input type="number" min={1} value={l.quantity}
                          onChange={e => updateCartLine(l.position, { quantity: Number(e.target.value) || 1 })}
                          className="w-14 px-1 py-0.5 border border-gray-200 rounded text-right text-xs" />
                      </td>
                      <td className="px-2 py-1">
                        <input type="number" value={l.price}
                          onChange={e => updateCartLine(l.position, { price: Number(e.target.value) || 0 })}
                          className="w-20 px-1 py-0.5 border border-gray-200 rounded text-right text-xs" />
                      </td>
                      <td className="px-2 py-1 text-right font-bold">{fmtYen(l.price * l.quantity)}</td>
                      <td className="px-2 py-1 text-center">
                        <button onClick={() => removeCartLine(l.position)} className="text-red-500 text-sm" title="この明細を削除">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr className="border-t-2 border-gray-300">
                    <td colSpan={4} className="px-2 py-2 text-right text-xs font-bold text-gray-500">合計</td>
                    <td className="px-2 py-2 text-right text-sm font-bold tabular-nums">{fmtYen(cartTotal)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          <div className="flex justify-end pt-1">
            <button onClick={createOrder} disabled={saving || cartLines.length === 0 || !clinicId}
              className="px-5 py-2.5 text-sm font-bold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
              {saving ? "作成中…" : "✓ この内容で注文を作成"}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── 歯式図（クリックできる歯の一覧） ──────────────────────
function ToothChart({
  itemByPosition, cart, onClickTooth,
}: {
  itemByPosition: Map<string, TemplateItem>
  cart: Record<string, { quantity: number }>
  onClickTooth: (position: string) => void
}) {
  function Row({ positions, reverse }: { positions: string[]; reverse?: boolean }) {
    return (
      <div className="flex gap-1" style={{ flexDirection: reverse ? "row-reverse" : "row" }}>
        {positions.map(pos => {
          const assigned = !!itemByPosition.get(pos)?.product_id
          const selected = !!cart[pos]
          const num = pos.slice(1, -1)
          return (
            <button key={pos} onClick={() => onClickTooth(pos)}
              title={`${positionLabel(pos)}${assigned ? "" : "（未設定）"}`}
              className="flex flex-col items-center justify-center rounded-md border text-[11px] font-bold transition-colors"
              style={{
                width: 34, height: 34,
                background: selected ? "#059669" : assigned ? "#fff" : "#f3f4f6",
                color: selected ? "#fff" : assigned ? "#111827" : "#9ca3af",
                borderColor: selected ? "#059669" : assigned ? "#d1d5db" : "#e5e7eb",
                cursor: "pointer",
              }}>
              {num}
              {selected && <span style={{ fontSize: 8 }}>×{cart[pos].quantity}</span>}
            </button>
          )
        })}
      </div>
    )
  }
  return (
    <div className="bg-white rounded-lg p-4" style={{ border: "1px solid #e8eaed" }}>
      <div className="flex items-center justify-center gap-6 mb-2">
        <span className="text-[11px] text-gray-500 font-bold">上顎弓</span>
      </div>
      <div className="flex items-center justify-center gap-1 mb-1 flex-wrap">
        <span className="text-[11px] text-gray-400 font-bold" style={{ width: UPPER_R.length * 34 + (UPPER_R.length - 1) * 4, textAlign: "center" }}>右</span>
        <div className="mx-1" style={{ width: 1 }} />
        <span className="text-[11px] text-gray-400 font-bold" style={{ width: UPPER_L.length * 34 + (UPPER_L.length - 1) * 4, textAlign: "center" }}>左</span>
      </div>
      <div className="flex items-center justify-center gap-1 mb-3 flex-wrap">
        <Row positions={UPPER_R} />
        <div className="w-px bg-gray-300 self-stretch mx-1" />
        <Row positions={UPPER_L} />
      </div>
      <div className="flex items-center justify-center gap-1 flex-wrap">
        <Row positions={LOWER_R} />
        <div className="w-px bg-gray-300 self-stretch mx-1" />
        <Row positions={LOWER_L} />
      </div>
      <div className="flex items-center justify-center gap-6 mt-2">
        <span className="text-[11px] text-gray-500 font-bold">下顎弓</span>
      </div>
      <p className="text-[10px] text-gray-400 text-center mt-3">
        白＝商品が設定されている歯　グレー＝未設定　緑＝選択中（クリックするたびに数量+1／削除は下のリストの×で）
      </p>
    </div>
  )
}

// ── テンプレート編集（32本それぞれに商品を割り当てる） ──────────
function TemplateEditor({
  positions, itemByPosition, products, onAssign,
}: {
  positions: string[]
  itemByPosition: Map<string, TemplateItem>
  products: Product[]
  onAssign: (position: string, product: Product | null) => void
}) {
  const [openPos, setOpenPos] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const k = searchKey(query)
    if (!k) return products.slice(0, 50)
    return products.filter(p => searchKey(`${p.name} ${p.product_code || ""}`).includes(k)).slice(0, 50)
  }, [products, query])

  return (
    <div className="bg-white rounded-lg overflow-hidden" style={{ border: "1px solid #e8eaed" }}>
      <div className="p-2 bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-700">
        32本それぞれに商品を割り当ててください（商品名で検索できます）
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-gray-100">
        {positions.map(pos => {
          const assigned = itemByPosition.get(pos)
          const isOpen = openPos === pos
          return (
            <div key={pos} className="bg-white p-2" style={{ position: "relative" }}>
              <div className="text-[11px] font-bold text-gray-500 mb-1">{positionLabel(pos)}（{pos}）</div>
              <input lang="ja"
                value={isOpen ? query : (assigned?.product_name || "")}
                onChange={e => { setQuery(e.target.value); setOpenPos(pos) }}
                onFocus={() => { setQuery(""); setOpenPos(pos) }}
                onBlur={() => setTimeout(() => setOpenPos(prev => prev === pos ? null : prev), 150)}
                placeholder="🔍 商品名で検索"
                className="w-full px-2 py-1 border border-gray-200 rounded text-xs bg-white" />
              {isOpen && (
                <div className="absolute z-20 left-2 right-2 mt-1 bg-white border border-gray-200 rounded shadow-lg" style={{ maxHeight: 220, overflowY: "auto" }}>
                  <button type="button" onMouseDown={e => { e.preventDefault(); onAssign(pos, null); setQuery(""); setOpenPos(null) }}
                    className="w-full text-left px-2 py-1.5 text-[11px] text-gray-400 hover:bg-gray-50">（未設定にする）</button>
                  {filtered.length === 0 ? (
                    <div className="px-2 py-1.5 text-[11px] text-gray-400">該当商品なし</div>
                  ) : filtered.map(p => (
                    <button key={p.id} type="button"
                      onMouseDown={e => { e.preventDefault(); onAssign(pos, p); setQuery(""); setOpenPos(null) }}
                      className="w-full text-left px-2 py-1.5 text-[11px] border-t border-gray-100 hover:bg-blue-50">
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
