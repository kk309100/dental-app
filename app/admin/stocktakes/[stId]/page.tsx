"use client"

import { use, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase, fetchAll } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { downloadCSV, toCSV } from "@/lib/csv"

type Stocktake = { id: string; taken_on: string; status: string; note: string | null; finalized_at: string | null }
type Item = { id: string; product_id: string; system_stock: number; counted_stock: number | null; diff: number | null; reason: string | null; note: string | null }
type Product = { id: string; name: string; product_code: string | null; manufacturer: string | null; category: string | null; cost: number | null; location: string | null; active: boolean | null }

const REASONS = ["", "破損", "紛失", "売上未計上", "仕入未計上", "サンプル/試供品", "その他"]

export default function StocktakeDetailPage({ params }: { params: Promise<{ stId: string }> }) {
  const { stId } = use(params)
  const router = useRouter()
  const [st, setSt] = useState<Stocktake | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [products, setProducts] = useState<Map<string, Product>>(new Map())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterMode, setFilterMode] = useState<"all" | "uncounted" | "diff" | "match">("uncounted")

  useEffect(() => { fetchData() }, [stId])

  async function fetchData(opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoading(true)
    const { data: s } = await supabase.from("stocktakes").select("*").eq("id", stId).single()
    if (!s) { if (!opts?.silent) setLoading(false); return }
    setSt(s as Stocktake)
    // 明細・商品ともに1万件を超えうるため、Supabase既定の1000件上限に引っかからないよう fetchAll でページング取得する
    const it = await fetchAll("stocktake_items", "*", (q: any) => q.eq("stocktake_id", stId))
    const ps = await fetchAll("products", "id,name,product_code,manufacturer,category,cost,location,active")
    setItems((it as Item[]) || [])
    const m = new Map<string, Product>()
    ;(ps as Product[] | null)?.forEach(p => m.set(p.id, p))
    setProducts(m)
    if (!opts?.silent) setLoading(false)
  }

  const norm = (v: string) => String(v || "").toLowerCase().normalize("NFKC").replace(/\s+/g, "")
  const enriched = useMemo(() => items.map(i => ({ ...i, product: products.get(i.product_id) })), [items, products])

  // ── Excel/CSVから実数を取り込む ──────────────────────────────
  type ImportRow = { name: string; qty: number }
  type ImportOutcome =
    | { kind: "matched"; row: ImportRow; itemId: string }
    | { kind: "ambiguous"; row: ImportRow; candidates: { itemId: string; product: Product }[]; chosen: string }
    | { kind: "unmatched"; row: ImportRow; chosen: string }
  const [importing, setImporting] = useState(false)
  const [importOutcomes, setImportOutcomes] = useState<ImportOutcome[] | null>(null)
  const [importApplying, setImportApplying] = useState(false)
  const productList = useMemo(() => Array.from(products.values()), [products])
  const itemIdByProductId = useMemo(() => {
    const m = new Map<string, string>()
    items.forEach(i => m.set(i.product_id, i.id))
    return m
  }, [items])

  async function handleImportFile(file: File) {
    setImporting(true)
    try {
      const XLSX = await import("xlsx")
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: "array" })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" })

      // 「商品名」「棚卸数量」（無ければ「数量」）を含む行をヘッダー行として探す
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

      // 現在の棚卸の明細を商品名(正規化)でインデックス化
      const byName = new Map<string, { itemId: string; product: Product }[]>()
      enriched.forEach(i => {
        if (!i.product) return
        const k = norm(i.product.name)
        if (!byName.has(k)) byName.set(k, [])
        byName.get(k)!.push({ itemId: i.id, product: i.product })
      })

      const outcomes: ImportOutcome[] = importRows.map(row => {
        const cands = byName.get(norm(row.name)) || []
        if (cands.length === 1) return { kind: "matched", row, itemId: cands[0].itemId }
        if (cands.length > 1) return { kind: "ambiguous", row, candidates: cands, chosen: "" }
        return { kind: "unmatched", row, chosen: "" }
      })
      setImportOutcomes(outcomes)
    } catch (e) {
      alert("読み込みに失敗しました: " + (e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  async function applyImport() {
    if (!importOutcomes) return
    const targets: { itemId: string; qty: number }[] = []
    importOutcomes.forEach(o => {
      if (o.kind === "matched") targets.push({ itemId: o.itemId, qty: o.row.qty })
      else if (o.chosen) targets.push({ itemId: o.chosen, qty: o.row.qty })
    })
    if (targets.length === 0) { alert("反映できる行がありません"); return }
    if (!confirm(`${targets.length}件の実数をこの棚卸に反映します。よろしいですか？`)) return
    setImportApplying(true)
    try {
      for (const t of targets) {
        await supabase.from("stocktake_items").update({ counted_stock: t.qty }).eq("id", t.itemId)
      }
      await fetchData({ silent: true })
      setImportOutcomes(null)
      alert(`✅ ${targets.length}件の実数を反映しました。`)
    } finally {
      setImportApplying(false)
    }
  }

  // 実地で数えやすいよう 棚 → メーカー → 商品名 の順に並べる
  const sorted = useMemo(() => [...enriched].sort((a, b) =>
    (a.product?.location || "￿").localeCompare(b.product?.location || "￿", "ja") ||
    (a.product?.manufacturer || "").localeCompare(b.product?.manufacturer || "", "ja") ||
    (a.product?.name || "").localeCompare(b.product?.name || "", "ja")
  ), [enriched])

  const filtered = useMemo(() => {
    return sorted.filter(i => {
      if (!i.product) return false
      if (filterMode === "uncounted" && i.counted_stock !== null) return false
      if (filterMode === "diff" && (i.counted_stock === null || i.counted_stock === i.system_stock)) return false
      if (filterMode === "match" && (i.counted_stock === null || i.counted_stock !== i.system_stock)) return false
      if (!search) return true
      const target = norm([i.product.name, i.product.product_code, i.product.manufacturer, i.product.location].filter(Boolean).join(" "))
      return target.includes(norm(search))
    })
  }, [sorted, filterMode, search])

  const stats = useMemo(() => ({
    total: items.length,
    counted: items.filter(i => i.counted_stock !== null).length,
    diff: items.filter(i => i.counted_stock !== null && i.counted_stock !== i.system_stock).length,
    diffValue: items.reduce((s, i) => {
      if (i.counted_stock === null) return s
      const p = products.get(i.product_id)
      return s + (i.counted_stock - i.system_stock) * Number(p?.cost || 0)
    }, 0),
  }), [items, products])

  async function updateItem(id: string, patch: Partial<Item>) {
    const { error } = await supabase.from("stocktake_items").update(patch).eq("id", id)
    if (error) { alert("更新失敗: " + error.message); return }
    setItems(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)))
  }

  async function finalize() {
    if (!st) return
    if (!confirm(`棚卸を確定します。各商品の在庫を実数値で書き換え、stock_movements に履歴を残します。\n\n進捗: ${stats.counted}/${stats.total} 件カウント済み\n差異: ${stats.diff} 件\n差額: ${fmtYen(stats.diffValue)}\n\n続行しますか？`)) return

    // 1) 各商品の stock を更新 + 移動履歴
    const updates = items.filter(i => i.counted_stock !== null && i.counted_stock !== i.system_stock)
    for (const i of updates) {
      const diff = (i.counted_stock as number) - i.system_stock
      await supabase.from("products").update({ stock: i.counted_stock }).eq("id", i.product_id)
      await supabase.from("stock_movements").insert({
        product_id: i.product_id,
        movement_type: "棚卸調整",
        quantity: diff,
        before_stock: i.system_stock,
        after_stock: i.counted_stock,
        ref_type: "stocktake_item",
        ref_id: i.id,
        reason: i.reason || "",
      })
    }
    // 2) 棚卸ヘッダを確定
    await supabase.from("stocktakes").update({
      status: "確定",
      finalized_at: new Date().toISOString(),
    }).eq("id", st.id)
    alert(`棚卸を確定しました。${updates.length} 件の在庫を更新しました。`)
    router.push("/admin/stocktakes")
  }

  function exportCSV() {
    const csv = toCSV(
      enriched.map(i => ({
        商品名: i.product?.name || "",
        商品コード: i.product?.product_code || "",
        棚番号: i.product?.location || "",
        メーカー: i.product?.manufacturer || "",
        カテゴリ: i.product?.category || "",
        システム在庫: i.system_stock,
        実数: i.counted_stock ?? "",
        差異: i.counted_stock !== null ? (i.counted_stock - i.system_stock) : "",
        理由: i.reason || "",
        備考: i.note || "",
      })),
      ["商品名", "商品コード", "棚番号", "メーカー", "カテゴリ", "システム在庫", "実数", "差異", "理由", "備考"]
    )
    downloadCSV(`棚卸_${st?.taken_on || ""}.csv`, csv)
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>
  if (!st) return <p className="text-red-600 text-center py-12">棚卸が見つかりません</p>
  const isFinalized = st.status === "確定"

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2 no-print">
        <div>
          <h1 className="text-lg font-bold text-gray-900">
            棚卸 {new Date(st.taken_on).toLocaleDateString("ja-JP")}
            <span className={"ml-2 text-xs font-normal px-2 py-0.5 rounded " + (isFinalized ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800")}>{st.status}</span>
          </h1>
          <p className="text-xs text-gray-400">進捗 {stats.counted}/{stats.total} ・ 差異 {stats.diff} 件 ・ 差額 <span className={stats.diffValue >= 0 ? "text-emerald-700" : "text-red-600"}>{fmtYen(stats.diffValue)}</span></p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()} className="text-xs px-3 py-1.5 bg-gray-100 border border-gray-200 rounded hover:bg-gray-200">🖨 印刷（カウント用紙）</button>
          <button onClick={exportCSV} className="text-xs px-3 py-1.5 bg-gray-100 border border-gray-200 rounded hover:bg-gray-200">📤 CSV</button>
          {!isFinalized && (
            <label className="text-xs px-3 py-1.5 bg-purple-50 border border-purple-200 text-purple-700 rounded hover:bg-purple-100 cursor-pointer font-bold">
              {importing ? "読込中…" : "📥 Excel/CSV取込"}
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={importing}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = "" }} />
            </label>
          )}
          {!isFinalized && <button onClick={finalize} className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 font-bold">✓ 確定</button>}
          <Link href="/admin/stocktakes" className="text-xs text-gray-500 underline">← 一覧</Link>
        </div>
      </div>

      <div className="flex gap-1.5 items-center bg-gray-50 p-2 rounded-lg flex-wrap no-print" style={{ border: "1px solid #e8eaed" }}>
        <input lang="ja" value={search} onChange={e => setSearch(e.target.value)} placeholder="商品名・コード・棚番号で検索"
          className="flex-1 min-w-[200px] px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <select value={filterMode} onChange={e => setFilterMode(e.target.value as typeof filterMode)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="uncounted">未カウント ({stats.total - stats.counted})</option>
          <option value="diff">差異あり ({stats.diff})</option>
          <option value="match">一致 ({stats.counted - stats.diff})</option>
          <option value="all">すべて ({stats.total})</option>
        </select>
      </div>

      {importOutcomes && (() => {
        const matchedCount = importOutcomes.filter(o => o.kind === "matched").length
        const ambiguous = importOutcomes.filter((o): o is Extract<ImportOutcome, { kind: "ambiguous" }> => o.kind === "ambiguous")
        const unmatched = importOutcomes.filter((o): o is Extract<ImportOutcome, { kind: "unmatched" }> => o.kind === "unmatched")
        const resolvedCount = ambiguous.filter(o => o.chosen).length + unmatched.filter(o => o.chosen).length
        return (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 space-y-2 no-print">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm font-bold text-purple-900">
                取込プレビュー：自動一致 {matchedCount}件 ／ 要確認 {ambiguous.length + unmatched.length}件（うち選択済み {resolvedCount}件）
              </p>
              <div className="flex gap-2">
                <button onClick={applyImport} disabled={importApplying}
                  className="text-xs px-3 py-1.5 bg-purple-600 text-white rounded font-bold hover:bg-purple-700 disabled:opacity-50">
                  {importApplying ? "反映中…" : `この内容を反映（${matchedCount + resolvedCount}件）`}
                </button>
                <button onClick={() => setImportOutcomes(null)} className="text-xs px-3 py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-50">キャンセル</button>
              </div>
            </div>
            {(ambiguous.length > 0 || unmatched.length > 0) && (
              <div className="bg-white rounded border border-purple-200 overflow-auto" style={{ maxHeight: 320 }}>
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr className="text-[11px] text-gray-500">
                      <th className="px-2 py-1 text-left">Excel上の商品名</th>
                      <th className="px-2 py-1 text-right w-16">実数</th>
                      <th className="px-2 py-1 text-left">対応する商品を選択</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ambiguous.map((o, idx) => (
                      <tr key={"amb" + idx} className="border-t border-gray-100">
                        <td className="px-2 py-1.5">{o.row.name}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{o.row.qty}</td>
                        <td className="px-2 py-1.5">
                          <select value={o.chosen} onChange={e => {
                            const v = e.target.value
                            setImportOutcomes(prev => prev!.map(x => x === o ? { ...x, chosen: v } : x))
                          }} className="w-full px-1.5 py-1 border border-gray-200 rounded text-[11px]">
                            <option value="">－ 選択してください（{o.candidates.length}件同名）－</option>
                            {o.candidates.map(c => (
                              <option key={c.itemId} value={c.itemId}>
                                {c.product.product_code || "(コードなし)"} / {c.product.manufacturer || "-"} / {c.product.location || "棚番号なし"}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                    {unmatched.map((o, idx) => (
                      <UnmatchedRow key={"un" + idx} outcome={o} productList={productList} itemIdByProductId={itemIdByProductId} norm={norm}
                        onChoose={itemId => setImportOutcomes(prev => prev!.map(x => x === o ? { ...x, chosen: itemId } : x))} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })()}

      {/* 印刷時だけ出るタイトル（カウント用紙） */}
      <div className="print-only" style={{ display: "none" }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>棚卸表 {new Date(st.taken_on).toLocaleDateString("ja-JP")}{st.note ? `（${st.note}）` : ""}</div>
        <div style={{ fontSize: 10, color: "#555", marginBottom: 6 }}>{filtered.length}品目　実数欄に数えた数を記入してください　担当：＿＿＿＿＿＿</div>
      </div>
      <div className="bg-white rounded overflow-auto print-area" style={{ border: "1px solid #d0d0d0" }}>
        <table className="w-full text-xs">
          <thead className="bg-gray-100 sticky top-0">
            <tr className="text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-2 py-1.5 text-left w-20">棚</th>
              <th className="px-2 py-1.5 text-left">商品</th>
              <th className="px-2 py-1.5 text-right w-16">システム</th>
              <th className="px-2 py-1.5 text-right w-20">実数</th>
              <th className="px-2 py-1.5 text-right w-16">差異</th>
              <th className="px-2 py-1.5 text-left w-32 no-print">理由</th>
              <th className="px-2 py-1.5 text-left no-print">備考</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">該当なし</td></tr>
            ) : filtered.map(i => {
              const diff = i.counted_stock !== null ? i.counted_stock - i.system_stock : null
              return (
                <tr key={i.id} className={"border-b border-gray-100 " + (diff && diff !== 0 ? "bg-amber-50/40" : "")}>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-gray-600">{i.product?.location || "—"}</td>
                  <td className="px-2 py-1.5">
                    <div className="font-bold">{i.product?.name}</div>
                    <div className="text-[10px] text-gray-500">{i.product?.product_code} {i.product?.manufacturer}</div>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{i.system_stock}</td>
                  <td className="px-1 py-1">
                    <input type="number" defaultValue={i.counted_stock ?? ""}
                      disabled={isFinalized}
                      onBlur={(e) => {
                        const v = e.target.value === "" ? null : Number(e.target.value)
                        updateItem(i.id, { counted_stock: v })
                      }}
                      className="w-full px-1.5 py-0.5 border border-gray-200 rounded text-sm text-right disabled:bg-gray-100" />
                  </td>
                  <td className={"px-2 py-1.5 text-right tabular-nums font-bold " + (diff === null ? "text-gray-300" : diff === 0 ? "text-emerald-600" : diff > 0 ? "text-blue-600" : "text-red-600")}>
                    {diff === null ? "—" : (diff > 0 ? "+" : "") + diff}
                  </td>
                  <td className="px-1 py-1 no-print">
                    <select defaultValue={i.reason || ""} disabled={isFinalized}
                      onChange={(e) => updateItem(i.id, { reason: e.target.value || null })}
                      className="w-full px-1 py-0.5 border border-gray-200 rounded text-xs disabled:bg-gray-100">
                      {REASONS.map(r => <option key={r} value={r}>{r || "(未選択)"}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1 no-print">
                    <input defaultValue={i.note || ""} disabled={isFinalized}
                      onBlur={(e) => updateItem(i.id, { note: e.target.value || null })}
                      className="w-full px-1.5 py-0.5 border border-gray-200 rounded text-xs disabled:bg-gray-100" />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .print-area { max-height: none !important; overflow: visible !important; border: none !important; }
          .print-area tr { break-inside: avoid; }
          .print-area input[type=number] { border: 1px solid #999 !important; height: 22px; background: #fff !important; }
          @page { size: A4; margin: 10mm; }
        }
      `}</style>
    </div>
  )
}

// 未一致行用：候補が全商品（1万件超）になるため、セレクトボックスではなく
// 入力しながら絞り込む検索欄にする（全件をDOMに並べるとページが重くなるため）。
// 検索対象は今の棚卸のスナップショットではなく、商品マスター全体（productList）から探す。
// 選んだ商品にこの棚卸の明細（stocktake_item）が無い場合（棚卸作成後に登録された商品など）は
// その場で反映できないため、その旨を伝える。
function UnmatchedRow({ outcome, productList, itemIdByProductId, norm, onChoose }: {
  outcome: { row: { name: string; qty: number }; chosen: string }
  productList: { id: string; name: string; product_code: string | null; manufacturer: string | null }[]
  itemIdByProductId: Map<string, string>
  norm: (v: string) => string
  onChoose: (itemId: string) => void
}) {
  const [q, setQ] = useState("")
  const [notInStocktake, setNotInStocktake] = useState<string | null>(null)
  const chosenProduct = useMemo(() => {
    if (!outcome.chosen) return null
    const itemId = outcome.chosen
    // itemId から逆引き（表示用）
    for (const p of productList) {
      if (itemIdByProductId.get(p.id) === itemId) return p
    }
    return null
  }, [outcome.chosen, productList, itemIdByProductId])
  const results = useMemo(() => {
    if (!q.trim()) return []
    const k = norm(q)
    return productList.filter(p => norm(p.name).includes(k)).slice(0, 15)
  }, [q, productList, norm])

  function pick(p: { id: string; name: string }) {
    const itemId = itemIdByProductId.get(p.id)
    if (!itemId) {
      setNotInStocktake(p.name)
      return
    }
    setNotInStocktake(null)
    onChoose(itemId)
    setQ("")
  }

  return (
    <tr className="border-t border-gray-100 bg-amber-50/40">
      <td className="px-2 py-1.5">{outcome.row.name}<div className="text-[10px] text-amber-700">DentHubに一致する商品名が見つかりません</div></td>
      <td className="px-2 py-1.5 text-right tabular-nums">{outcome.row.qty}</td>
      <td className="px-2 py-1.5" style={{ position: "relative" }}>
        {chosenProduct ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-emerald-700 font-bold">✓ {chosenProduct.name}</span>
            <button onClick={() => onChoose("")} className="text-[10px] text-gray-400 underline">変更</button>
          </div>
        ) : (
          <>
            <input lang="ja" value={q} onChange={e => { setQ(e.target.value); setNotInStocktake(null) }}
              placeholder="🔍 商品マスターから検索してこの実数を割り当てる"
              className="w-full px-1.5 py-1 border border-gray-200 rounded text-[11px]" />
            {notInStocktake && (
              <p className="text-[10px] text-red-600 mt-0.5">「{notInStocktake}」はこの棚卸の対象になっていません（棚卸作成後に登録された商品の可能性）。棚卸を作り直してください。</p>
            )}
            {results.length > 0 && (
              <div className="absolute z-10 left-2 right-2 mt-0.5 bg-white border border-gray-200 rounded shadow-lg" style={{ maxHeight: 200, overflowY: "auto" }}>
                {results.map(p => (
                  <div key={p.id} onClick={() => pick(p)}
                    className="px-2 py-1 text-[11px] hover:bg-purple-50 cursor-pointer border-b border-gray-50">
                    {p.name}<span className="text-gray-400 ml-1">（{p.product_code || "コードなし"}）</span>
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
