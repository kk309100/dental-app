"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase, fetchAll } from "@/lib/supabase"
import Barcode from "react-barcode"

export default function BarcodePage() {
  const [products, setProducts] = useState<any[]>([])
  const [generating, setGenerating] = useState(false)
  const [genMsg, setGenMsg] = useState("")
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [printMode, setPrintMode] = useState(false)   // 印刷プレビュー中か

  useEffect(() => { fetchProducts() }, [])

  async function fetchProducts() {
    const data = await fetchAll(
      "products",
      "id,name,product_code,manufacturer,barcode,active",
      (q) => q.order("name", { ascending: true })
    )
    setProducts(data || [])
  }

  async function autoGenerate() {
    setGenerating(true)
    setGenMsg("")
    const noBarcode = products.filter(p => !p.barcode)
    if (noBarcode.length === 0) {
      setGenMsg("すべての商品にバーコードが設定済みです")
      setGenerating(false)
      return
    }
    let success = 0
    for (const p of noBarcode) {
      const code = p.product_code
        ? p.product_code.replace(/[^A-Za-z0-9\-]/g, "").slice(0, 20)
        : "P" + p.id.replace(/-/g, "").slice(0, 12).toUpperCase()
      const { error } = await supabase.from("products").update({ barcode: code }).eq("id", p.id)
      if (!error) success++
    }
    setGenMsg(`${success}件のバーコードを生成しました`)
    await fetchProducts()
    setGenerating(false)
  }

  // 検索フィルタ済み（バーコードあり商品のみ）
  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase()
    return products.filter(p => {
      if (!p.barcode) return false
      if (!kw) return true
      return (
        (p.name || "").toLowerCase().includes(kw) ||
        (p.product_code || "").toLowerCase().includes(kw) ||
        (p.manufacturer || "").toLowerCase().includes(kw) ||
        (p.barcode || "").toLowerCase().includes(kw)
      )
    })
  }, [products, search])

  const withBarcode = products.filter(p => p.barcode)
  const withoutBarcode = products.filter(p => !p.barcode)

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll() { setSelected(new Set(filtered.map(p => p.id))) }
  function clearAll() { setSelected(new Set()) }

  // 印刷対象：選択あれば選択のみ、なければ表示中全件
  const printTargets = useMemo(() => {
    if (selected.size > 0) return filtered.filter(p => selected.has(p.id))
    return filtered
  }, [filtered, selected])

  function handlePrint() {
    setPrintMode(true)
    setTimeout(() => {
      window.print()
      setPrintMode(false)
    }, 300)
  }

  return (
    <main style={{ padding: 20 }}>
      {/* ===== 印刷時は印刷ターゲットのみ表示 ===== */}
      <div className="print-only">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {printTargets.map(p => (
            <div key={p.id} style={{ width: 180, border: "1px solid #ccc", padding: "6px 4px", textAlign: "center", pageBreakInside: "avoid" }}>
              <p style={{ fontSize: 10, margin: "0 0 2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</p>
              {p.product_code && <p style={{ fontSize: 9, margin: "0 0 2px", color: "#666" }}>{p.product_code}</p>}
              <Barcode value={p.barcode} width={1.1} height={40} fontSize={8} margin={1} />
            </div>
          ))}
        </div>
      </div>

      {/* ===== 通常表示（no-print） ===== */}
      <div className="no-print">
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>バーコード管理</h1>

        {/* ステータス */}
        <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ padding: "8px 16px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: "#16a34a" }}>設定済み</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#15803d" }}>{withBarcode.length}件</div>
          </div>
          <div style={{ padding: "8px 16px", background: "#fef9c3", border: "1px solid #fde047", borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: "#ca8a04" }}>未設定</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#a16207" }}>{withoutBarcode.length}件</div>
          </div>
        </div>

        {/* 操作バー */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={autoGenerate} disabled={generating || withoutBarcode.length === 0}
            style={{ padding: "7px 14px", background: generating ? "#ccc" : "#2563eb", color: "#fff", border: "none", borderRadius: 7, cursor: generating ? "not-allowed" : "pointer", fontSize: 13 }}>
            {generating ? "生成中…" : `未設定 ${withoutBarcode.length}件 を自動生成`}
          </button>

          <div style={{ width: 1, height: 28, background: "#e2e8f0" }} />

          <button onClick={selectAll}
            style={{ padding: "7px 12px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 7, cursor: "pointer", fontSize: 13 }}>
            全選択 ({filtered.length})
          </button>
          <button onClick={clearAll} disabled={selected.size === 0}
            style={{ padding: "7px 12px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 7, cursor: "pointer", fontSize: 13, opacity: selected.size === 0 ? 0.5 : 1 }}>
            選択解除
          </button>

          <div style={{ width: 1, height: 28, background: "#e2e8f0" }} />

          <button onClick={handlePrint}
            style={{ padding: "7px 16px", background: "#111", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13 }}>
            🖨 {selected.size > 0 ? `選択 ${selected.size}件を印刷` : `表示中 ${filtered.length}件を印刷`}
          </button>

          {genMsg && <span style={{ fontSize: 13, color: "#15803d", fontWeight: 600 }}>{genMsg}</span>}
        </div>

        {/* 検索 */}
        <div style={{ marginBottom: 14 }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="商品名・商品コード・メーカー・バーコードで検索…"
            style={{
              width: "100%", maxWidth: 480, padding: "8px 12px",
              border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14, outline: "none",
            }}
          />
          {search && (
            <span style={{ marginLeft: 10, fontSize: 13, color: "#64748b" }}>
              {filtered.length}件ヒット
            </span>
          )}
        </div>

        {/* バーコード一覧 */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {filtered.map((p) => {
            const isSelected = selected.has(p.id)
            return (
              <div
                key={p.id}
                onClick={() => toggleSelect(p.id)}
                style={{
                  width: 190, border: `2px solid ${isSelected ? "#2563eb" : "#e2e8f0"}`,
                  padding: "8px 6px", borderRadius: 10, background: isSelected ? "#eff6ff" : "#fff",
                  textAlign: "center", cursor: "pointer", position: "relative",
                  boxShadow: isSelected ? "0 0 0 1px #93c5fd" : "none",
                  transition: "border-color 0.1s, background 0.1s",
                }}
              >
                {/* チェックマーク */}
                <div style={{
                  position: "absolute", top: 6, right: 6,
                  width: 18, height: 18, borderRadius: 4,
                  border: `2px solid ${isSelected ? "#2563eb" : "#cbd5e1"}`,
                  background: isSelected ? "#2563eb" : "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, color: "#fff", fontWeight: 700,
                }}>
                  {isSelected ? "✓" : ""}
                </div>

                <p style={{ fontSize: 11, marginBottom: 2, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 20 }}>
                  {p.name}
                </p>
                {p.product_code && (
                  <p style={{ fontSize: 9, marginBottom: 2, color: "#888" }}>{p.product_code}</p>
                )}
                <Barcode
                  value={p.barcode}
                  width={1.1}
                  height={42}
                  fontSize={8}
                  margin={1}
                />
              </div>
            )
          })}
          {filtered.length === 0 && (
            <p style={{ color: "#94a3b8", fontSize: 14, padding: 20 }}>
              {search ? "検索結果がありません" : "バーコード設定済みの商品がありません"}
            </p>
          )}
        </div>
      </div>

      <style jsx global>{`
        .print-only { display: none; }
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body { background: #fff; margin: 0; }
          @page { margin: 10mm; }
        }
      `}</style>
    </main>
  )
}
