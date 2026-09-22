"use client"

// 自社管理在庫（院内消耗品など、実際に数を数えて管理している商品）の実数を、
// Excel/CSVファイルから商品マスタ(products.stock)へ直接反映する。
//
// 「棚卸」機能（/admin/stocktakes）は全商品を対象にした本格的な実地棚卸用だが、
// こちらはファイルに載っている商品だけをピンポイントで更新する軽量版。

import { useMemo, useState } from "react"
import Link from "next/link"
import { supabase, fetchAll } from "@/lib/supabase"

type Product = { id: string; name: string; product_code: string | null; manufacturer: string | null; stock: number | null }

type ImportRow = { name: string; qty: number }
type Outcome =
  | { kind: "matched"; row: ImportRow; product: Product }
  | { kind: "ambiguous"; row: ImportRow; candidates: Product[]; chosen: string }
  | { kind: "unmatched"; row: ImportRow; chosen: string }

const norm = (v: string) => String(v || "").toLowerCase().normalize("NFKC").replace(/\s+/g, "")

export default function StockImportPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [fileName, setFileName] = useState("")
  const [parsing, setParsing] = useState(false)
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<{ updated: number } | null>(null)

  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

  async function ensureProducts() {
    if (products.length > 0) return products
    setLoadingProducts(true)
    // 商品は1万件を超えるため、Supabase既定の1000件上限に引っかからないよう fetchAll でページング取得する
    const ps = await fetchAll("products", "id,name,product_code,manufacturer,stock")
    setLoadingProducts(false)
    setProducts(ps as Product[])
    return ps as Product[]
  }

  async function handleFile(file: File) {
    setFileName(file.name)
    setResult(null)
    setOutcomes(null)
    setParsing(true)
    try {
      const ps = await ensureProducts()
      const XLSX = await import("xlsx")
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: "array" })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" })

      // 「商品名」「数量」を含む列見出しの行を探す（列の並び順・シート形式に多少の幅を持たせる）
      let headerRowIdx = -1, nameCol = -1, qtyCol = -1
      for (let r = 0; r < Math.min(rows.length, 20); r++) {
        const nCol = rows[r].findIndex(c => String(c).trim() === "商品名")
        if (nCol === -1) continue
        const qCol = rows[r].findIndex(c => String(c).includes("数量"))
        if (qCol === -1) continue
        headerRowIdx = r; nameCol = nCol; qtyCol = qCol
        break
      }
      if (headerRowIdx === -1) {
        alert("「商品名」「数量」の列見出しが見つかりませんでした。ファイルの形式を確認してください。")
        return
      }

      const importRows: ImportRow[] = []
      for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const name = String(rows[r][nameCol] || "").trim()
        const qtyRaw = rows[r][qtyCol]
        if (!name) continue
        const qty = Number(qtyRaw)
        if (qtyRaw === "" || isNaN(qty)) continue
        importRows.push({ name, qty })
      }
      if (importRows.length === 0) { alert("取り込める行が見つかりませんでした。"); return }

      const byName = new Map<string, Product[]>()
      ps.forEach(p => {
        const k = norm(p.name)
        if (!byName.has(k)) byName.set(k, [])
        byName.get(k)!.push(p)
      })

      const result: Outcome[] = importRows.map(row => {
        const cands = byName.get(norm(row.name)) || []
        if (cands.length === 1) return { kind: "matched", row, product: cands[0] }
        if (cands.length > 1) return { kind: "ambiguous", row, candidates: cands, chosen: "" }
        return { kind: "unmatched", row, chosen: "" }
      })
      setOutcomes(result)
    } catch (e) {
      alert("読み込みに失敗しました: " + (e as Error).message)
    } finally {
      setParsing(false)
    }
  }

  async function apply() {
    if (!outcomes) return
    const targets: { productId: string; qty: number }[] = []
    outcomes.forEach(o => {
      if (o.kind === "matched") targets.push({ productId: o.product.id, qty: o.row.qty })
      else if (o.chosen) targets.push({ productId: o.chosen, qty: o.row.qty })
    })
    if (targets.length === 0) { alert("反映できる行がありません"); return }
    if (!confirm(`${targets.length}件の商品の在庫数を、ファイルの実数で上書きします。よろしいですか？`)) return

    setApplying(true)
    try {
      let updated = 0
      for (const t of targets) {
        const p = productById.get(t.productId)
        const before = Number(p?.stock || 0)
        if (before === t.qty) continue
        const { error } = await supabase.from("products").update({ stock: t.qty }).eq("id", t.productId)
        if (error) continue
        await supabase.from("stock_movements").insert({
          product_id: t.productId,
          movement_type: "在庫確認(Excel取込)",
          quantity: t.qty - before,
          before_stock: before,
          after_stock: t.qty,
          ref_type: "stock_import",
          reason: fileName,
        })
        updated++
      }
      setResult({ updated })
      setOutcomes(null)
      setProducts([]) // 次回開いたときに最新の在庫で再取得する
    } finally {
      setApplying(false)
    }
  }

  const matchedList = outcomes?.filter((o): o is Extract<Outcome, { kind: "matched" }> => o.kind === "matched") || []
  const ambiguousList = outcomes?.filter((o): o is Extract<Outcome, { kind: "ambiguous" }> => o.kind === "ambiguous") || []
  const unmatchedList = outcomes?.filter((o): o is Extract<Outcome, { kind: "unmatched" }> => o.kind === "unmatched") || []
  const resolvedCount = ambiguousList.filter(o => o.chosen).length + unmatchedList.filter(o => o.chosen).length

  return (
    <div className="space-y-3">
      <div className="flex items-center flex-wrap gap-3">
        <h1 className="text-lg font-bold text-gray-900" style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: 0 }}>
          📥 自社管理在庫の取込
          <span className="ml-2 text-xs font-normal text-gray-400">Excel/CSVに載っている商品だけ、在庫数を直接反映します</span>
        </h1>
        <Link href="/admin/inventory" className="text-xs text-blue-600 underline">在庫管理へ</Link>
      </div>

      <div className="rounded-lg p-4 space-y-3" style={{ border: "1px solid #e5e7eb", background: "#fff" }}>
        <p className="text-sm text-gray-600">
          「商品名」「数量」の列見出しを含むExcel/CSVに対応しています。ファイルに載っている商品だけが対象で、それ以外の商品マスタには一切触れません。
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold cursor-pointer bg-purple-600 text-white hover:bg-purple-700">
            {parsing || loadingProducts ? "読込中…" : "📄 ファイルを選択"}
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={parsing || loadingProducts}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = "" }} />
          </label>
          {fileName && <span className="text-sm text-gray-500">{fileName}</span>}
        </div>
      </div>

      {result && (
        <div className="rounded-lg p-4" style={{ border: "1px solid #86efac", background: "#f0fdf4" }}>
          <p className="text-sm font-bold text-emerald-700">✅ {result.updated}件の在庫数を反映しました</p>
        </div>
      )}

      {outcomes && (
        <div className="rounded-lg p-4 space-y-3" style={{ border: "1px solid #e5e7eb", background: "#fff" }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-bold text-gray-900">
              自動一致 {matchedList.length}件 ／ 要確認 {ambiguousList.length + unmatchedList.length}件（うち選択済み {resolvedCount}件）
            </p>
            <div className="flex gap-2">
              <button onClick={apply} disabled={applying}
                className="text-sm px-3 py-1.5 bg-purple-600 text-white rounded font-bold hover:bg-purple-700 disabled:opacity-50">
                {applying ? "反映中…" : `この内容を反映（${matchedList.length + resolvedCount}件）`}
              </button>
              <button onClick={() => setOutcomes(null)} className="text-sm px-3 py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-50">キャンセル</button>
            </div>
          </div>

          {matchedList.length > 0 && (
            <div className="overflow-auto rounded border" style={{ maxHeight: 260 }}>
              <table className="w-full text-xs">
                <thead className="sticky top-0" style={{ background: "#f9fafb" }}>
                  <tr>
                    <th className="text-left p-2">商品名</th>
                    <th className="text-right p-2">現在庫</th>
                    <th className="text-right p-2">実数（反映後）</th>
                  </tr>
                </thead>
                <tbody>
                  {matchedList.map((o, i) => {
                    const before = Number(o.product.stock || 0)
                    const diff = o.row.qty - before
                    return (
                      <tr key={i} className="border-t">
                        <td className="p-2">{o.product.name}</td>
                        <td className="p-2 text-right text-gray-500">{before}</td>
                        <td className="p-2 text-right font-bold">
                          {o.row.qty}
                          {diff !== 0 && <span className={"ml-1 text-[11px] " + (diff > 0 ? "text-emerald-600" : "text-red-600")}>({diff > 0 ? "+" : ""}{diff})</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {(ambiguousList.length > 0 || unmatchedList.length > 0) && (
            <div className="overflow-auto rounded border border-amber-200" style={{ maxHeight: 320 }}>
              <table className="w-full text-xs">
                <thead className="sticky top-0" style={{ background: "#fffbeb" }}>
                  <tr>
                    <th className="text-left p-2">ファイル上の商品名</th>
                    <th className="text-right p-2 w-16">実数</th>
                    <th className="text-left p-2">対応する商品を選択</th>
                  </tr>
                </thead>
                <tbody>
                  {ambiguousList.map((o, idx) => (
                    <tr key={"amb" + idx} className="border-t">
                      <td className="p-2">{o.row.name}</td>
                      <td className="p-2 text-right">{o.row.qty}</td>
                      <td className="p-2">
                        <select value={o.chosen} onChange={e => {
                          const v = e.target.value
                          setOutcomes(prev => prev!.map(x => x === o ? { ...x, chosen: v } : x))
                        }} className="w-full px-1.5 py-1 border border-gray-200 rounded text-[11px]">
                          <option value="">－ 選択してください（{o.candidates.length}件同名）－</option>
                          {o.candidates.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.product_code || "(コードなし)"} / {c.manufacturer || "-"} / 現在庫{c.stock ?? 0}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                  {unmatchedList.map((o, idx) => (
                    <UnmatchedRow key={"un" + idx} outcome={o} products={products}
                      onChoose={id => setOutcomes(prev => prev!.map(x => x === o ? { ...x, chosen: id } : x))} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function UnmatchedRow({ outcome, products, onChoose }: {
  outcome: { row: ImportRow; chosen: string }
  products: Product[]
  onChoose: (productId: string) => void
}) {
  const [q, setQ] = useState("")
  const chosenProduct = useMemo(() => products.find(p => p.id === outcome.chosen) || null, [outcome.chosen, products])
  const results = useMemo(() => {
    if (!q.trim()) return []
    const k = norm(q)
    return products.filter(p => norm(p.name).includes(k)).slice(0, 15)
  }, [q, products])

  return (
    <tr className="border-t bg-amber-50/40">
      <td className="p-2">{outcome.row.name}<div className="text-[10px] text-amber-700">一致する商品名が見つかりません</div></td>
      <td className="p-2 text-right">{outcome.row.qty}</td>
      <td className="p-2" style={{ position: "relative" }}>
        {chosenProduct ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-emerald-700 font-bold">✓ {chosenProduct.name}</span>
            <button onClick={() => onChoose("")} className="text-[10px] text-gray-400 underline">変更</button>
          </div>
        ) : (
          <>
            <input lang="ja" value={q} onChange={e => setQ(e.target.value)}
              placeholder="🔍 商品マスターから検索"
              className="w-full px-1.5 py-1 border border-gray-200 rounded text-[11px]" />
            {results.length > 0 && (
              <div className="absolute z-10 left-2 right-2 mt-0.5 bg-white border border-gray-200 rounded shadow-lg" style={{ maxHeight: 200, overflowY: "auto" }}>
                {results.map(p => (
                  <div key={p.id} onClick={() => { onChoose(p.id); setQ("") }}
                    className="px-2 py-1 text-[11px] hover:bg-purple-50 cursor-pointer border-b border-gray-50">
                    {p.name}<span className="text-gray-400 ml-1">（{p.product_code || "コードなし"}・現在庫{p.stock ?? 0}）</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </td>
    </tr>
  )
}
