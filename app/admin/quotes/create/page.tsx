"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { calcTax, fmtYen, fmtDate, ymd } from "@/lib/invoice"
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
type Product = { id: string; name: string; price: number | null }

type Line = {
  productId: string | null
  productName: string
  quantity: number
  price: number
}

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
  const [lines, setLines] = useState<Line[]>([{ productId: null, productName: "", quantity: 1, price: 0 }])
  const [notes, setNotes] = useState("")
  const [error, setError] = useState("")

  const [productSearch, setProductSearch] = useState("")
  const [openLineIdx, setOpenLineIdx] = useState<number | null>(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [c, p] = await Promise.all([
      supabase.from("clinics").select("id,name,corporate_name").order("name").limit(50000),
      supabase.from("products").select("id,name,price").order("name").limit(50000),
    ])
    setClinics(c.data || [])
    setProducts((p.data as Product[]) || [])

    // ?from_order=xxx で注文から見積コピー
    if (fromOrderId) {
      const { data: o } = await supabase.from("orders").select("clinic_id").eq("id", fromOrderId).single()
      const { data: items } = await supabase.from("order_items").select("product_id,product_name,quantity,price").eq("order_id", fromOrderId)
      if (o?.clinic_id) setClinicId(o.clinic_id)
      if (items && items.length > 0) {
        setLines(items.map((it: { product_id: string | null; product_name: string | null; quantity: number; price: number }) => ({
          productId: it.product_id,
          productName: it.product_name || "",
          quantity: Number(it.quantity || 1),
          price: Number(it.price || 0),
        })))
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
    setLines((prev) => [...prev, { productId: null, productName: "", quantity: 1, price: 0 }])
  }
  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx))
  }
  function pickProduct(idx: number, p: Product) {
    updateLine(idx, { productId: p.id, productName: p.name, price: p.price || 0 })
    setOpenLineIdx(null)
    setProductSearch("")
  }

  const subtotal = lines.reduce((s, l) => s + (l.price || 0) * (l.quantity || 0), 0)
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

  if (loading) return <main style={page}><p>読み込み中…</p></main>

  return (
    <main style={page}>
      <Link href="/admin/quotes"><button style={back}>← 見積書一覧</button></Link>
      <h1 style={{ fontSize: 24, margin: "0 0 16px" }}>見積書を作成</h1>

      {error && <div style={errBox}>{error}</div>}

      {/* 医院 */}
      <div style={section}>
        <p style={sectionLabel}>① 医院</p>
        <select value={clinicId} onChange={(e) => setClinicId(e.target.value)} style={input}>
          <option value="">医院を選択</option>
          {clinics.map((c) => (
            <option key={c.id} value={c.id}>{c.corporate_name ? `${c.corporate_name} ${c.name}` : c.name}</option>
          ))}
        </select>
      </div>

      {/* 日付 */}
      <div style={section}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <label style={fieldLabel}>発行日</label>
            <input type="date" value={issueDate} onChange={(e) => { setIssueDate(e.target.value); setExpiryDate(defaultExpiryDate(new Date(e.target.value))) }} style={input} />
          </div>
          <div>
            <label style={fieldLabel}>有効期限</label>
            <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} style={input} />
          </div>
        </div>
      </div>

      {/* 明細 */}
      <div style={section}>
        <p style={sectionLabel}>③ 明細</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {lines.map((l, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 70px 100px 30px", gap: 6, alignItems: "center", position: "relative" }}>
              <div>
                <input
                  value={l.productName}
                  onChange={(e) => { updateLine(i, { productName: e.target.value }); setOpenLineIdx(i); setProductSearch(e.target.value) }}
                  onFocus={() => { setOpenLineIdx(i); setProductSearch(l.productName) }}
                  placeholder="商品名（商品マスタから候補表示、自由入力もOK）"
                  style={inputSm}
                />
                {openLineIdx === i && filteredProducts.length > 0 && (
                  <div style={dropdown}>
                    {filteredProducts.map((p) => (
                      <button key={p.id} onClick={() => pickProduct(i, p)} style={dropItem}>
                        <div style={{ fontSize: 12 }}>{p.name}</div>
                        {p.price && <div style={{ fontSize: 10, color: "#888" }}>{fmtYen(p.price)}</div>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <input type="number" value={l.quantity} onChange={(e) => updateLine(i, { quantity: Number(e.target.value) || 0 })} style={{ ...inputSm, textAlign: "right" }} />
              <input type="number" value={l.price} onChange={(e) => updateLine(i, { price: Number(e.target.value) || 0 })} style={{ ...inputSm, textAlign: "right" }} placeholder="単価" />
              <button onClick={() => removeLine(i)} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 16 }}>×</button>
            </div>
          ))}
        </div>
        <button onClick={addLine} style={{ ...btnGray, marginTop: 8 }}>＋ 行を追加</button>
      </div>

      {/* 備考 */}
      <div style={section}>
        <p style={sectionLabel}>④ 備考</p>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...input, minHeight: 60, resize: "vertical", fontFamily: "inherit" }} />
      </div>

      {/* 集計 + 作成 */}
      <div style={summary}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span>税抜小計</span><span>{fmtYen(subtotal)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span>消費税</span><span>{fmtYen(tax)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #eee", paddingTop: 8, marginTop: 8 }}><strong>合計</strong><strong style={{ fontSize: 20 }}>{fmtYen(total)}</strong></div>
        <button onClick={createQuote} disabled={submitting} style={{ ...btnDark, width: "100%", marginTop: 14, padding: 14, opacity: submitting ? 0.5 : 1 }}>
          {submitting ? "作成中…" : "見積書を作成"}
        </button>
      </div>
    </main>
  )
}

const page: React.CSSProperties = { maxWidth: 720, margin: "0 auto", padding: 20 }
const back: React.CSSProperties = { padding: "6px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", marginBottom: 16, cursor: "pointer" }
const section: React.CSSProperties = { background: "#fff", border: "1px solid #eee", borderRadius: 10, padding: 16, marginBottom: 12 }
const sectionLabel: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "#444", margin: "0 0 8px" }
const input: React.CSSProperties = { width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box", background: "#fff" }
const inputSm: React.CSSProperties = { width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 12, boxSizing: "border-box", background: "#fff" }
const fieldLabel: React.CSSProperties = { display: "block", fontSize: 11, color: "#777", marginBottom: 4, fontWeight: 600 }
const btnDark: React.CSSProperties = { padding: "8px 16px", borderRadius: 8, border: "none", background: "#111", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }
const btnGray: React.CSSProperties = { padding: "5px 14px", borderRadius: 6, border: "1px solid #ddd", background: "#f7f7f7", fontSize: 12, cursor: "pointer", color: "#333" }
const summary: React.CSSProperties = { background: "#fff", border: "1px solid #eee", borderRadius: 10, padding: 16, marginBottom: 30 }
const errBox: React.CSSProperties = { padding: 10, background: "#fff5f5", border: "1px solid #fcc", borderRadius: 6, color: "#dc2626", fontSize: 12, marginBottom: 12 }
const dropdown: React.CSSProperties = { position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #ddd", borderRadius: 6, maxHeight: 180, overflowY: "auto", zIndex: 20, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }
const dropItem: React.CSSProperties = { display: "block", width: "100%", textAlign: "left", padding: "6px 10px", border: "none", background: "#fff", cursor: "pointer", borderBottom: "1px solid #f3f4f6" }
