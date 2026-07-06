"use client"

import { useEffect, useRef, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

const C = {
  primary: "#22a648",
  blue:    "#2563eb",
  red:     "#ef4444",
  border:  "#e5e7eb",
  bg:      "#f3f4f6",
  text:    "#111827",
  sub:     "#6b7280",
}

type ParsedProduct = {
  product_name: string
  maker: string
  barcode: string
  cost: number
  price: number
  category: string
  selected: boolean
}

const CATEGORY_MAP: Record<string, string> = {
  "歯列矯正装置":         "矯正",
  "根管治療、穿刺、穿削": "根管治療",
  "予防":                 "予防",
  "他、診療用器具":       "診療器具",
  "歯科合着、接着材料":   "接着材料",
  "他の診療室用機械装置": "機械装置",
  "薬品":                 "薬品",
  "他の研削材、研磨材":   "研削材",
  "電気治療、診断用装置": "電気治療",
  "印象材料":             "印象材料",
  "ダイヤモンド研削材":   "研削材",
  "他の歯科材料":         "歯科材料",
  "サニタリー":           "サニタリー",
  "他の鋼製器具":         "鋼製器具",
  "技工用器具":           "技工",
  "滅菌器、消毒器":       "滅菌・消毒",
  "咬合・印象採得用器具": "印象",
  "切断、切削器具":       "切削器具",
  "X線装置、フィルム":    "X線",
  "ユニフォーム":         "ユニフォーム",
}

export default function ImportPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [clinicId, setClinicId]       = useState("")
  const [products, setProducts]       = useState<ParsedProduct[]>([])
  const [importing, setImporting]     = useState(false)
  const [result, setResult]           = useState<{ ok: number; skip: number } | null>(null)
  const [catFilter, setCatFilter]     = useState("すべて")
  const [search, setSearch]           = useState("")
  const [step, setStep]               = useState<"upload" | "select" | "done">("upload")

  useEffect(() => { init() }, [])

  async function init() {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) { router.push("/login"); return }
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", userData.user.id).single()
    if (!profile) { router.push("/login"); return }
    if (profile.role === "admin") { router.push("/admin"); return }
    setClinicId(profile.clinic_id)
  }

  function parseCSV(text: string): ParsedProduct[] {
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) return []
    const header = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim())
    const idx = (name: string) => header.indexOf(name)

    const seen = new Set<string>()
    const result: ParsedProduct[] = []

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map(c => c.replace(/^"|"$/g, "").trim())
      const barcode = cols[idx("商品コード")] || ""
      const name    = cols[idx("商品名")] || ""
      if (!name || seen.has(barcode + name)) continue
      seen.add(barcode + name)
      result.push({
        product_name: name,
        maker:    cols[idx("メーカー")] || "",
        barcode,
        cost:     parseFloat(cols[idx("原価")] || "0") || 0,
        price:    parseFloat(cols[idx("単価")] || "0") || 0,
        category: cols[idx("カテゴリ")] || "",
        selected: true,
      })
    }
    return result
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const parsed = parseCSV(text)
      setProducts(parsed)
      setStep("select")
      setResult(null)
    }
    reader.readAsText(file, "utf-8")
  }

  const categories = useMemo(() => {
    const cats = Array.from(new Set(products.map(p => p.category))).sort()
    return ["すべて", ...cats]
  }, [products])

  const filtered = useMemo(() => {
    const k = search.toLowerCase()
    return products.filter(p =>
      (catFilter === "すべて" || p.category === catFilter) &&
      (!k || p.product_name.toLowerCase().includes(k) || p.maker.toLowerCase().includes(k))
    )
  }, [products, catFilter, search])

  const selectedCount = products.filter(p => p.selected).length

  function toggleProduct(idx: number, all = false) {
    setProducts(prev => {
      const next = [...prev]
      if (all) {
        const filteredIdxs = new Set(filtered.map(f => prev.indexOf(f)))
        const allSelected = filtered.every(f => f.selected)
        next.forEach((p, i) => { if (filteredIdxs.has(i)) next[i] = { ...p, selected: !allSelected } })
      } else {
        next[idx] = { ...next[idx], selected: !next[idx].selected }
      }
      return next
    })
  }

  function toggleCategoryAll(cat: string, val: boolean) {
    setProducts(prev => prev.map(p => p.category === cat ? { ...p, selected: val } : p))
  }

  async function doImport() {
    const toImport = products.filter(p => p.selected)
    if (toImport.length === 0) { alert("商品を選択してください"); return }
    if (!confirm(`${toImport.length}件を在庫リストに追加しますか？`)) return
    setImporting(true)

    // 既存のbarcodeを取得して重複スキップ
    const { data: existing } = await supabase
      .from("clinic_inventory_items")
      .select("barcode")
      .eq("clinic_id", clinicId)
    const existingBarcodes = new Set((existing || []).map((e: any) => e.barcode))

    let ok = 0, skip = 0
    const BATCH = 50
    const rows = toImport
      .filter(p => {
        if (existingBarcodes.has(p.barcode)) { skip++; return false }
        return true
      })
      .map(p => ({
        clinic_id:    clinicId,
        product_name: p.product_name,
        maker:        p.maker || null,
        barcode:      p.barcode || null,
        stock_quantity: 0,
        min_stock:    0,
        category:     CATEGORY_MAP[p.category] || p.category || null,
      }))

    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await supabase.from("clinic_inventory_items").insert(rows.slice(i, i + BATCH))
      if (!error) ok += Math.min(BATCH, rows.length - i)
    }

    setResult({ ok, skip })
    setStep("done")
    setImporting(false)
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every(p => p.selected)

  if (step === "done") {
    return (
      <div style={{ maxWidth: 480, margin: "60px auto", padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
        <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: "bold", color: C.text }}>インポート完了</h2>
        <p style={{ color: C.sub, fontSize: 14, margin: "0 0 24px" }}>
          {result?.ok}件追加 / {result?.skip}件スキップ（重複）
        </p>
        <button onClick={() => router.push("/inventory")} style={{
          padding: "12px 28px", borderRadius: 10, border: "none",
          background: C.primary, color: "#fff", fontWeight: "bold", fontSize: 16, cursor: "pointer",
        }}>在庫一覧へ</button>
      </div>
    )
  }

  return (
    <div style={{ background: C.bg, minHeight: "100vh" }}>
      {/* ヘッダー */}
      <div style={{
        background: "#fff", padding: "10px 14px", borderBottom: `1px solid ${C.border}`,
        position: "sticky", top: 0, zIndex: 20, display: "flex", alignItems: "center", gap: 10,
      }}>
        <button onClick={() => router.push("/inventory")} style={{
          background: "#e8f5ec", color: C.primary, border: "1px solid #b2dfbd",
          borderRadius: 7, padding: "6px 12px", fontSize: 13, fontWeight: "bold", cursor: "pointer",
        }}>← 在庫</button>
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: "bold", color: C.text, flex: 1 }}>
          📥 商品一括インポート
        </h1>
        {step === "select" && (
          <span style={{ fontSize: 13, color: C.primary, fontWeight: "bold" }}>{selectedCount}件選択</span>
        )}
      </div>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "16px 12px 120px" }}>

        {/* Step 1: ファイルアップロード */}
        {step === "upload" && (
          <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.border}`, padding: 24, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: "bold", color: C.text }}>CSVファイルを選択</h2>
            <p style={{ color: C.sub, fontSize: 13, margin: "0 0 20px" }}>
              「inventory_import_cleaned.csv」をアップロードしてください<br />
              （UTF-8形式）
            </p>
            <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display: "none" }} />
            <button onClick={() => fileRef.current?.click()} style={{
              padding: "12px 32px", borderRadius: 10, border: `2px dashed ${C.primary}`,
              background: "#e8f5ec", color: C.primary, fontWeight: "bold", fontSize: 15, cursor: "pointer",
            }}>ファイルを選択</button>
            <div style={{ marginTop: 20, padding: "12px 16px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, fontSize: 12, color: "#92400e", textAlign: "left" }}>
              <strong>準備：</strong> ダウンロードフォルダにある <code>inventory_import_cleaned.csv</code> を使用してください。
              （得意先別売上日報から自動生成された729件の商品リスト）
            </div>
          </div>
        )}

        {/* Step 2: 商品選択 */}
        {step === "select" && (
          <>
            <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, padding: "12px 14px", marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="🔍 商品名・メーカーで絞り込み"
                  style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                <button onClick={() => toggleProduct(-1, true)} style={{
                  padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.border}`,
                  background: "#f9fafb", color: C.sub, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap",
                }}>{allFilteredSelected ? "全解除" : "全選択"}</button>
              </div>

              {/* カテゴリフィルター */}
              <div style={{ display: "flex", overflowX: "auto", gap: 6, paddingBottom: 2 }}>
                {categories.map(cat => {
                  const count = products.filter(p => cat === "すべて" || p.category === cat).length
                  const selCount = products.filter(p => (cat === "すべて" || p.category === cat) && p.selected).length
                  return (
                    <button key={cat} onClick={() => setCatFilter(cat)} style={{
                      whiteSpace: "nowrap", padding: "5px 12px", borderRadius: 999, fontSize: 12,
                      cursor: "pointer", border: "none", flexShrink: 0,
                      background: catFilter === cat ? C.blue : "#f3f4f6",
                      color: catFilter === cat ? "#fff" : C.sub,
                      fontWeight: catFilter === cat ? "bold" : "normal",
                    }}>{cat} {selCount}/{count}</button>
                  )
                })}
              </div>
            </div>

            {/* カテゴリごとの一括ON/OFF（現在のカテゴリが「すべて」以外のとき） */}
            {catFilter !== "すべて" && (
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <button onClick={() => toggleCategoryAll(catFilter, true)} style={{
                  flex: 1, padding: "8px 0", borderRadius: 8, border: `1px solid ${C.primary}`,
                  background: "#e8f5ec", color: C.primary, fontSize: 13, fontWeight: "bold", cursor: "pointer",
                }}>「{catFilter}」を全て選択</button>
                <button onClick={() => toggleCategoryAll(catFilter, false)} style={{
                  flex: 1, padding: "8px 0", borderRadius: 8, border: `1px solid ${C.border}`,
                  background: "#f9fafb", color: C.sub, fontSize: 13, cursor: "pointer",
                }}>「{catFilter}」を全て解除</button>
              </div>
            )}

            {/* 商品リスト */}
            <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
              {filtered.map((p, i) => {
                const globalIdx = products.indexOf(p)
                return (
                  <label key={globalIdx} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                    borderBottom: `1px solid ${C.border}`, cursor: "pointer",
                    background: p.selected ? "#f0fdf4" : "#fff",
                  }}>
                    <input type="checkbox" checked={p.selected} onChange={() => toggleProduct(globalIdx)}
                      style={{ width: 18, height: 18, accentColor: C.primary, cursor: "pointer", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: "bold", fontSize: 14, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.product_name}
                      </div>
                      <div style={{ fontSize: 11, color: C.sub }}>
                        {[p.maker, p.barcode ? `# ${p.barcode}` : null, p.category].filter(Boolean).join("  ·  ")}
                      </div>
                    </div>
                    {p.cost > 0 && (
                      <div style={{ fontSize: 12, color: C.sub, flexShrink: 0 }}>
                        ¥{p.cost.toLocaleString()}
                      </div>
                    )}
                  </label>
                )
              })}
              {filtered.length === 0 && (
                <p style={{ textAlign: "center", color: C.sub, padding: "30px 0" }}>商品がありません</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* 固定フッター */}
      {step === "select" && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          background: "#fff", borderTop: `1px solid ${C.border}`, padding: "12px 16px", zIndex: 30,
        }}>
          <button onClick={doImport} disabled={importing || selectedCount === 0} style={{
            width: "100%", padding: "14px 0", borderRadius: 12, border: "none",
            background: importing || selectedCount === 0 ? "#d1d5db" : C.primary,
            color: "#fff", fontWeight: "bold", fontSize: 16,
            cursor: importing || selectedCount === 0 ? "default" : "pointer",
          }}>
            {importing ? "インポート中…" : selectedCount === 0 ? "商品を選択してください" : `✅ ${selectedCount}件を在庫リストに追加する`}
          </button>
          <p style={{ textAlign: "center", fontSize: 11, color: C.sub, margin: "5px 0 0" }}>
            既存の在庫リストにある商品（バーコード一致）はスキップされます
          </p>
        </div>
      )}
    </div>
  )
}
