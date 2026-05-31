"use client"

import { useEffect, useState } from "react"
import { supabase, fetchAll } from "@/lib/supabase"
import Barcode from "react-barcode"

export default function BarcodePage() {
  const [products, setProducts] = useState<any[]>([])
  const [generating, setGenerating] = useState(false)
  const [genMsg, setGenMsg] = useState("")

  useEffect(() => { fetchProducts() }, [])

  async function fetchProducts() {
    const data = await fetchAll(
      "products",
      "id,name,product_code,barcode,active",
      (q) => q.order("name", { ascending: true })
    )
    setProducts(data || [])
  }

  // バーコード未設定の商品に自動生成して付与
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
      // product_code があればそれを使用、なければ ID から8桁数字を生成
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

  const withBarcode = products.filter(p => p.barcode)
  const withoutBarcode = products.filter(p => !p.barcode)

  return (
    <main style={{ padding: 20 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>バーコード管理</h1>

      {/* ステータス */}
      <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ padding: "10px 20px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: "#16a34a" }}>設定済み</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#15803d" }}>{withBarcode.length}件</div>
        </div>
        <div style={{ padding: "10px 20px", background: "#fef9c3", border: "1px solid #fde047", borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: "#ca8a04" }}>未設定</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#a16207" }}>{withoutBarcode.length}件</div>
        </div>
      </div>

      {/* 操作ボタン */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <button
          onClick={autoGenerate}
          disabled={generating || withoutBarcode.length === 0}
          style={{
            padding: "8px 18px", background: generating ? "#ccc" : "#2563eb",
            color: "#fff", border: "none", borderRadius: 8, cursor: generating ? "not-allowed" : "pointer", fontSize: 14,
          }}
        >
          {generating ? "生成中…" : `未設定 ${withoutBarcode.length}件 を自動生成`}
        </button>
        <button
          onClick={() => window.print()}
          style={{ padding: "8px 18px", background: "#111", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}
        >
          🖨 印刷
        </button>
        {genMsg && <span style={{ fontSize: 13, color: "#15803d", fontWeight: 600 }}>{genMsg}</span>}
      </div>

      {/* バーコード一覧 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        {products.filter(p => p.barcode).map((p) => (
          <div
            key={p.id}
            style={{
              width: 200, border: "1px solid #ddd", padding: "10px 8px",
              borderRadius: 8, background: "#fff", textAlign: "center",
            }}
          >
            <p style={{ fontSize: 11, marginBottom: 4, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {p.name}
            </p>
            <Barcode
              value={p.barcode}
              width={1.2}
              height={45}
              fontSize={9}
              margin={2}
            />
          </div>
        ))}
      </div>

      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff; }
        }
      `}</style>
    </main>
  )
}
