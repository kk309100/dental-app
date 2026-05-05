"use client"

import { use, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
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

  async function fetchData() {
    setLoading(true)
    const { data: s } = await supabase.from("stocktakes").select("*").eq("id", stId).single()
    if (!s) { setLoading(false); return }
    setSt(s as Stocktake)
    const { data: it } = await supabase.from("stocktake_items").select("*").eq("stocktake_id", stId)
    const { data: ps } = await supabase.from("products").select("id,name,product_code,manufacturer,category,cost,location,active").limit(50000)
    setItems((it as Item[]) || [])
    const m = new Map<string, Product>()
    ;(ps as Product[] | null)?.forEach(p => m.set(p.id, p))
    setProducts(m)
    setLoading(false)
  }

  const norm = (v: string) => String(v || "").toLowerCase().normalize("NFKC")
  const enriched = useMemo(() => items.map(i => ({ ...i, product: products.get(i.product_id) })), [items, products])

  const filtered = useMemo(() => {
    return enriched.filter(i => {
      if (!i.product) return false
      if (filterMode === "uncounted" && i.counted_stock !== null) return false
      if (filterMode === "diff" && (i.counted_stock === null || i.counted_stock === i.system_stock)) return false
      if (filterMode === "match" && (i.counted_stock === null || i.counted_stock !== i.system_stock)) return false
      if (!search) return true
      const target = norm([i.product.name, i.product.product_code, i.product.manufacturer, i.product.location].filter(Boolean).join(" "))
      return target.includes(norm(search))
    })
  }, [enriched, filterMode, search])

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
          {!isFinalized && <button onClick={finalize} className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 font-bold">✓ 確定</button>}
          <Link href="/admin/stocktakes" className="text-xs text-gray-500 underline">← 一覧</Link>
        </div>
      </div>

      <div className="flex gap-1.5 items-center bg-gray-50 p-2 rounded-lg flex-wrap no-print" style={{ border: "1px solid #e8eaed" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="商品名・コード・棚番号で検索"
          className="flex-1 min-w-[200px] px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white" />
        <select value={filterMode} onChange={e => setFilterMode(e.target.value as typeof filterMode)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="uncounted">未カウント ({stats.total - stats.counted})</option>
          <option value="diff">差異あり ({stats.diff})</option>
          <option value="match">一致 ({stats.counted - stats.diff})</option>
          <option value="all">すべて ({stats.total})</option>
        </select>
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
          .print-area { max-height: none !important; overflow: visible !important; }
          @page { size: A4; margin: 10mm; }
        }
      `}</style>
    </div>
  )
}
