"use client"

// 仕入先請求書 ↔ 仕入入荷 付け合わせ画面
//
// - サマリー（一致/差異/漏れ件数・金額）
// - 状態フィルタ
// - 各明細表示 + 手動マッチ調整
// - [自動再マッチ] [確定] アクション

import { use, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { runAutoMatch, setManualMatch } from "@/lib/supplier-invoice-match"

type SI = {
  id: string; supplier_id: string
  invoice_number: string | null; invoice_date: string | null
  period_start: string | null; period_end: string | null
  total_amount: number | null; computed_total: number | null
  pdf_filename: string | null; status: string
  matched_at: string | null
  notes: string | null
}
type Item = {
  id: string; supplier_invoice_id: string
  line_no: number | null
  delivery_date: string | null; delivery_number: string | null
  supplier_product_code: string | null; product_name: string | null
  quantity: number; unit_price: number; amount: number
  matched_stock_receipt_id: string | null
  matched_product_id: string | null
  match_status: string; match_score: number | null; match_note: string | null
}
type Receipt = {
  id: string; product_id: string | null; quantity: number
  unit_price: number | null; created_at: string; memo: string | null
  supplier_invoice_item_id: string | null
}
type Product = { id: string; name: string; product_code: string | null }
type Supplier = { id: string; name: string }

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  matched: { label: "✅ 一致", color: "#15803d", bg: "#dcfce7" },
  qty_mismatch: { label: "⚠ 数量ズレ", color: "#92400e", bg: "#fef3c7" },
  price_mismatch: { label: "⚠ 単価ズレ", color: "#92400e", bg: "#fef3c7" },
  amount_mismatch: { label: "⚠ 金額ズレ", color: "#92400e", bg: "#fef3c7" },
  no_product: { label: "❌ 商品マスタ無", color: "#b91c1c", bg: "#fee2e2" },
  unmatched: { label: "❌ 入荷記録無", color: "#b91c1c", bg: "#fee2e2" },
  manual_ok: { label: "✓ 手動OK", color: "#1e40af", bg: "#dbeafe" },
}

export default function MatchPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = use(params)

  const [invoice, setInvoice] = useState<SI | null>(null)
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [matching, setMatching] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [pickItemId, setPickItemId] = useState<string | null>(null)
  const [pickQuery, setPickQuery] = useState("")

  useEffect(() => { fetchData() }, [invoiceId])

  async function fetchData() {
    setLoading(true)
    const { data: inv } = await supabase.from("supplier_invoices").select("*").eq("id", invoiceId).single()
    if (!inv) { setLoading(false); return }
    setInvoice(inv as SI)

    const [{ data: sup }, { data: itms }, { data: prods }] = await Promise.all([
      supabase.from("suppliers").select("id,name").eq("id", inv.supplier_id).single(),
      supabase.from("supplier_invoice_items").select("*").eq("supplier_invoice_id", invoiceId).order("line_no").limit(50000),
      supabase.from("products").select("id,name,product_code").limit(50000),
    ])
    setSupplier(sup as Supplier | null)
    setItems((itms as Item[]) || [])
    setProducts((prods as Product[]) || [])

    // 期間内の stock_receipts を取得（マッチ調整時の候補表示用）
    let q = supabase.from("stock_receipts").select("id,product_id,quantity,unit_price,created_at,memo,supplier_invoice_item_id")
      .eq("supplier_id", inv.supplier_id).limit(50000)
    if (inv.period_start) q = q.gte("created_at", inv.period_start)
    if (inv.period_end) q = q.lte("created_at", inv.period_end + "T23:59:59")
    const { data: rcpts } = await q
    setReceipts((rcpts as Receipt[]) || [])

    setLoading(false)
  }

  async function handleAutoMatch() {
    setMatching(true)
    try {
      // 既存マッチをリセット
      await supabase.from("supplier_invoice_items").update({
        matched_product_id: null, matched_stock_receipt_id: null,
        match_status: "unmatched", match_score: null, match_note: null,
      }).eq("supplier_invoice_id", invoiceId)

      const result = await runAutoMatch(invoiceId)
      alert(`自動マッチ完了\n  一致: ${result.matched}件\n  数量ズレ: ${result.qty_mismatch}件\n  単価ズレ: ${result.price_mismatch}件\n  商品マスタ無: ${result.no_product}件\n  入荷記録無: ${result.unmatched}件`)
      await fetchData()
    } catch (e) {
      alert("自動マッチ失敗: " + (e as Error).message)
    } finally {
      setMatching(false)
    }
  }

  async function handleConfirm() {
    if (!confirm("この月分を確定しますか？確定後は変更不可になります。")) return
    await supabase.from("supplier_invoices").update({
      status: "確定", confirmed_at: new Date().toISOString(),
    }).eq("id", invoiceId)
    await fetchData()
  }

  async function handlePickProduct(itemId: string, productId: string) {
    if (!invoice) return
    await setManualMatch(itemId, productId, invoice.supplier_id, true)
    setPickItemId(null); setPickQuery("")
    await fetchData()
  }

  // サマリー
  const summary = useMemo(() => {
    const c = { matched: 0, qty_mismatch: 0, price_mismatch: 0, amount_mismatch: 0, no_product: 0, unmatched: 0, manual_ok: 0 }
    const sumByStatus = { matched: 0, issue: 0, missing: 0 }
    items.forEach(it => {
      const s = it.match_status as keyof typeof c
      if (typeof c[s] === "number") c[s]++
      if (s === "matched" || s === "manual_ok") sumByStatus.matched += Number(it.amount || 0)
      else if (s === "qty_mismatch" || s === "price_mismatch" || s === "amount_mismatch") sumByStatus.issue += Number(it.amount || 0)
      else sumByStatus.missing += Number(it.amount || 0)
    })
    return { ...c, ...sumByStatus, total: items.length }
  }, [items])

  // 「請求書になし、入荷だけある」検出
  const orphanReceipts = useMemo(() => {
    const claimedIds = new Set(items.map(it => it.matched_stock_receipt_id).filter(Boolean) as string[])
    return receipts.filter(r => !claimedIds.has(r.id))
  }, [items, receipts])

  const filteredItems = useMemo(() => {
    if (statusFilter === "all") return items
    if (statusFilter === "issue") return items.filter(it => ["qty_mismatch", "price_mismatch", "amount_mismatch"].includes(it.match_status))
    if (statusFilter === "missing") return items.filter(it => ["no_product", "unmatched"].includes(it.match_status))
    return items.filter(it => it.match_status === statusFilter)
  }, [items, statusFilter])

  // 商品ピッカー検索
  const pickCandidates = useMemo(() => {
    if (!pickQuery) return products.slice(0, 30)
    const k = pickQuery.toLowerCase().normalize("NFKC")
    return products.filter(p => {
      const target = `${p.name} ${p.product_code || ""}`.toLowerCase().normalize("NFKC")
      return target.includes(k)
    }).slice(0, 30)
  }, [products, pickQuery])

  if (loading) return <p className="text-center py-12 text-gray-400">読み込み中…</p>
  if (!invoice) return <p className="text-center py-12 text-red-500">請求書が見つかりません</p>

  const productMap = new Map(products.map(p => [p.id, p]))
  const receiptMap = new Map(receipts.map(r => [r.id, r]))

  return (
    <div className="space-y-3">
      {/* ヘッダ */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-gray-900">
            🔍 {supplier?.name || "(仕入先)"} 月次請求書 付け合わせ
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {invoice.invoice_number && <span className="mr-3">No.{invoice.invoice_number}</span>}
            {invoice.period_start && invoice.period_end && (
              <span className="mr-3">期間: {invoice.period_start} 〜 {invoice.period_end}</span>
            )}
            <span>請求額: <strong>{fmtYen(invoice.total_amount || 0)}</strong></span>
            <span className="ml-3 text-[10px] px-2 py-0.5 rounded font-bold"
              style={{ background: invoice.status === "確定" ? "#dbeafe" : invoice.status === "OK" ? "#dcfce7" : "#fef3c7", color: invoice.status === "確定" ? "#1e40af" : invoice.status === "OK" ? "#15803d" : "#92400e" }}>
              {invoice.status}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/supplier-invoices" className="text-xs text-gray-500 underline">← 一覧</Link>
          <button onClick={handleAutoMatch} disabled={matching || invoice.status === "確定"}
            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded hover:bg-blue-700 disabled:opacity-40">
            {matching ? "🔄 マッチ中..." : "🔄 自動再マッチ"}
          </button>
          {invoice.status !== "確定" && (
            <button onClick={handleConfirm}
              className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded hover:bg-emerald-700">
              ✓ この月分を確定
            </button>
          )}
        </div>
      </div>

      {/* サマリー */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-white rounded-lg p-3" style={{ border: "1px solid #d1fae5" }}>
          <p className="text-[10px] text-gray-500">✅ 一致</p>
          <p className="text-2xl font-bold text-emerald-700">{summary.matched + summary.manual_ok}<span className="text-xs font-normal ml-1">件</span></p>
          <p className="text-[10px] text-gray-500">{fmtYen(summary.matched)}</p>
        </div>
        <div className="bg-white rounded-lg p-3" style={{ border: "1px solid #fde68a" }}>
          <p className="text-[10px] text-gray-500">⚠ 差異あり</p>
          <p className="text-2xl font-bold text-amber-700">
            {summary.qty_mismatch + summary.price_mismatch + summary.amount_mismatch}<span className="text-xs font-normal ml-1">件</span>
          </p>
          <p className="text-[10px] text-gray-500">{fmtYen(summary.issue)}</p>
        </div>
        <div className="bg-white rounded-lg p-3" style={{ border: "1px solid #fecaca" }}>
          <p className="text-[10px] text-gray-500">❌ 請求書のみ</p>
          <p className="text-2xl font-bold text-red-700">{summary.no_product + summary.unmatched}<span className="text-xs font-normal ml-1">件</span></p>
          <p className="text-[10px] text-gray-500">{fmtYen(summary.missing)}</p>
        </div>
        <div className="bg-white rounded-lg p-3" style={{ border: "1px solid #c7d2fe" }}>
          <p className="text-[10px] text-gray-500">📦 入荷のみ（請求書に無い）</p>
          <p className="text-2xl font-bold text-indigo-700">{orphanReceipts.length}<span className="text-xs font-normal ml-1">件</span></p>
          <p className="text-[10px] text-gray-500">{fmtYen(orphanReceipts.reduce((s, r) => s + Number(r.unit_price || 0) * Number(r.quantity), 0))}</p>
        </div>
      </div>

      {/* フィルタ */}
      <div className="flex gap-1 items-center bg-gray-50 p-2 rounded-lg flex-wrap text-xs" style={{ border: "1px solid #e8eaed" }}>
        <span className="text-gray-500 mr-2">フィルタ:</span>
        <button onClick={() => setStatusFilter("all")} className={"px-2 py-1 rounded " + (statusFilter === "all" ? "bg-gray-700 text-white" : "bg-white border border-gray-200")}>全て ({summary.total})</button>
        <button onClick={() => setStatusFilter("matched")} className={"px-2 py-1 rounded " + (statusFilter === "matched" ? "bg-emerald-600 text-white" : "bg-white border border-emerald-200 text-emerald-700")}>一致 ({summary.matched})</button>
        <button onClick={() => setStatusFilter("manual_ok")} className={"px-2 py-1 rounded " + (statusFilter === "manual_ok" ? "bg-blue-600 text-white" : "bg-white border border-blue-200 text-blue-700")}>手動OK ({summary.manual_ok})</button>
        <button onClick={() => setStatusFilter("issue")} className={"px-2 py-1 rounded " + (statusFilter === "issue" ? "bg-amber-600 text-white" : "bg-white border border-amber-200 text-amber-700")}>差異 ({summary.qty_mismatch + summary.price_mismatch + summary.amount_mismatch})</button>
        <button onClick={() => setStatusFilter("missing")} className={"px-2 py-1 rounded " + (statusFilter === "missing" ? "bg-red-600 text-white" : "bg-white border border-red-200 text-red-700")}>漏れ ({summary.no_product + summary.unmatched})</button>
      </div>

      {/* 明細表 */}
      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0", maxHeight: "calc(100vh - 360px)" }}>
        <table className="w-full text-xs">
          <thead className="bg-gray-100 sticky top-0">
            <tr className="text-[11px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-2 py-1.5 text-left w-8">#</th>
              <th className="px-2 py-1.5 text-left w-24">納品日</th>
              <th className="px-2 py-1.5 text-left w-20">伝票No</th>
              <th className="px-2 py-1.5 text-left w-20">商品コード</th>
              <th className="px-2 py-1.5 text-left">商品名</th>
              <th className="px-2 py-1.5 text-right w-12">数量</th>
              <th className="px-2 py-1.5 text-right w-20">単価</th>
              <th className="px-2 py-1.5 text-right w-24">金額</th>
              <th className="px-2 py-1.5 text-left w-32">マッチ状態</th>
              <th className="px-2 py-1.5 text-left">照合先 (入荷記録)</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">該当行なし</td></tr>
            ) : filteredItems.map((it, i) => {
              const sl = STATUS_LABEL[it.match_status] || STATUS_LABEL.unmatched
              const matchedReceipt = it.matched_stock_receipt_id ? receiptMap.get(it.matched_stock_receipt_id) : null
              const matchedProduct = it.matched_product_id ? productMap.get(it.matched_product_id) : null
              return (
                <tr key={it.id} className={"border-b border-gray-100 " + (i % 2 === 0 ? "" : "bg-gray-50/40")}>
                  <td className="px-2 py-1 text-gray-400">{it.line_no || i + 1}</td>
                  <td className="px-2 py-1 text-[11px]">{it.delivery_date || "—"}</td>
                  <td className="px-2 py-1 font-mono text-[10px] text-gray-600">{it.delivery_number || "—"}</td>
                  <td className="px-2 py-1 font-mono text-[10px] text-gray-600">{it.supplier_product_code || "—"}</td>
                  <td className="px-2 py-1">{it.product_name}</td>
                  <td className="px-2 py-1 text-right">{it.quantity}</td>
                  <td className="px-2 py-1 text-right">{fmtYen(it.unit_price)}</td>
                  <td className="px-2 py-1 text-right font-bold">{fmtYen(it.amount)}</td>
                  <td className="px-2 py-1">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-block"
                      style={{ background: sl.bg, color: sl.color }}>
                      {sl.label}
                    </span>
                    {it.match_note && <p className="text-[9px] text-gray-500 mt-0.5">{it.match_note}</p>}
                  </td>
                  <td className="px-2 py-1 text-[11px]">
                    {matchedProduct ? (
                      <div>
                        <span className="font-bold">{matchedProduct.name}</span>
                        {matchedReceipt && (
                          <span className="text-gray-500 ml-2">
                            {new Date(matchedReceipt.created_at).toLocaleDateString("ja-JP")} ×{matchedReceipt.quantity} @{fmtYen(matchedReceipt.unit_price || 0)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <button onClick={() => { setPickItemId(it.id); setPickQuery(it.product_name || "") }}
                        className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100">
                        🔍 商品を選択
                      </button>
                    )}
                    {matchedProduct && it.match_status !== "matched" && (
                      <button onClick={() => { setPickItemId(it.id); setPickQuery("") }}
                        className="text-[9px] text-blue-600 underline ml-2">変更</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 入荷だけある（請求書に無い）リスト */}
      {orphanReceipts.length > 0 && (
        <details className="bg-indigo-50 rounded-lg p-2" style={{ border: "1px solid #c7d2fe" }}>
          <summary className="text-xs font-bold text-indigo-900 cursor-pointer">
            📦 入荷だけある（この月の請求書に載っていない） {orphanReceipts.length}件
          </summary>
          <table className="w-full text-xs mt-2">
            <thead className="bg-white">
              <tr className="text-[10px] text-gray-500">
                <th className="px-2 py-1 text-left">入荷日</th>
                <th className="px-2 py-1 text-left">商品</th>
                <th className="px-2 py-1 text-right">数量</th>
                <th className="px-2 py-1 text-right">単価</th>
                <th className="px-2 py-1 text-right">小計</th>
                <th className="px-2 py-1 text-left">メモ</th>
              </tr>
            </thead>
            <tbody>
              {orphanReceipts.map(r => {
                const p = r.product_id ? productMap.get(r.product_id) : null
                return (
                  <tr key={r.id} className="border-t border-indigo-100">
                    <td className="px-2 py-1">{new Date(r.created_at).toLocaleDateString("ja-JP")}</td>
                    <td className="px-2 py-1">{p?.name || "(削除済)"}</td>
                    <td className="px-2 py-1 text-right">{r.quantity}</td>
                    <td className="px-2 py-1 text-right">{fmtYen(r.unit_price || 0)}</td>
                    <td className="px-2 py-1 text-right font-bold">{fmtYen(Number(r.unit_price || 0) * Number(r.quantity))}</td>
                    <td className="px-2 py-1 text-[10px] text-gray-500">{r.memo || ""}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="text-[10px] text-gray-600 mt-2">
            これらは「入荷したけど月次請求書に明細が載っていない」もの。仕入先側の漏れ or システム側に重複登録の可能性。
          </p>
        </details>
      )}

      {/* 商品ピッカーモーダル */}
      {pickItemId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => { setPickItemId(null); setPickQuery("") }}>
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="p-3 border-b border-gray-100">
              <h3 className="text-sm font-bold mb-2">この明細を自社商品マスタの商品と紐付け</h3>
              <input autoFocus value={pickQuery} onChange={e => setPickQuery(e.target.value)}
                placeholder="商品名・コードで検索"
                className="w-full px-3 py-2 border border-gray-200 rounded text-sm" />
              <p className="text-[10px] text-gray-500 mt-1">
                💡 ここで紐付けると、次回以降の同じ仕入先側コード/名前は自動マッチされます
              </p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {pickCandidates.length === 0 ? (
                <p className="p-6 text-center text-gray-400 text-sm">該当なし</p>
              ) : pickCandidates.map(p => (
                <button key={p.id}
                  onClick={() => handlePickProduct(pickItemId, p.id)}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-100 text-sm">
                  <span className="font-bold">{p.name}</span>
                  {p.product_code && <span className="text-gray-500 ml-2 text-xs">#{p.product_code}</span>}
                </button>
              ))}
            </div>
            <div className="p-2 border-t border-gray-100 text-right">
              <button onClick={() => { setPickItemId(null); setPickQuery("") }} className="text-xs text-gray-500 underline">閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
