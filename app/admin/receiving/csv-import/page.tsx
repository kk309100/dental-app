"use client"

// 仕入CSV取り込み（外部の仕入管理システムが出す「仕入日報」CSVを stock_receipts に一括登録）
//
// 想定フォーマット（列名で判定。列の並び順は問わない）:
//   仕入先コード,仕入先名,伝票日付,伝票№,仕入区分,商品コード,商品名,メーカー,単価,数量,金額,
//   高度医療項目,摘要,経費分類,商品分類,クラス,担当者名
//
// - 仕入区分が「仕入」の行だけを取り込む（値引き・入金などの調整行は対象外）
// - 商品コードで既存の products を一致させる。無ければ新規作成（トグルでON/OFF可）
// - 仕入先コードで既存の suppliers を一致させる。無ければ選択 or 新規作成
// - created_at は伝票日付をそのまま使う（月次請求書付け合わせが期間で絞り込むため）
// - 「在庫数に反映する」はデフォルトOFF：これは月次の記録を後から取り込むための機能で、
//   現在の実在庫とは無関係なことが多いため

import { useRef, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { readTextSmart, parsePurchaseCsv, type PurchaseCsvRow } from "@/lib/purchase-csv"

type Product = { id: string; name: string; product_code: string | null }
type Supplier = { id: string; name: string; supplier_code: string | null }

type ParsedRow = PurchaseCsvRow

type Resolved = ParsedRow & {
  productId: string | null   // 既存一致
  willCreate: boolean        // 新規作成される
}

export default function CsvImportPage() {
  const fileRef = useRef<HTMLInputElement>(null)

  const [fileName, setFileName] = useState("")
  const [parseError, setParseError] = useState("")
  const [rawRows, setRawRows] = useState<ParsedRow[]>([])
  const [skippedCount, setSkippedCount] = useState(0)
  const [csvSupplierName, setCsvSupplierName] = useState("")
  const [csvSupplierCode, setCsvSupplierCode] = useState("")

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [supplierId, setSupplierId] = useState("")
  const [createSupplier, setCreateSupplier] = useState(false)
  const [autoCreateProducts, setAutoCreateProducts] = useState(true)
  const [applyToStock, setApplyToStock] = useState(false)

  const [loadingMasters, setLoadingMasters] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ inserted: number; newProducts: number; newSupplier: boolean } | null>(null)

  async function loadMasters() {
    setLoadingMasters(true)
    const [{ data: sup }, { data: prod }] = await Promise.all([
      supabase.from("suppliers").select("id,name,supplier_code").order("name").limit(2000),
      supabase.from("products").select("id,name,product_code").limit(50000),
    ])
    setSuppliers((sup as Supplier[]) || [])
    setProducts((prod as Product[]) || [])
    setLoadingMasters(false)
  }

  async function handleFile(file: File) {
    setFileName(file.name)
    setParseError("")
    setRawRows([])
    setResult(null)
    setSkippedCount(0)

    if (suppliers.length === 0 && products.length === 0) await loadMasters()

    const text = await readTextSmart(file)
    const parsed = parsePurchaseCsv(text)
    if (parsed.error) { setParseError(parsed.error); return }

    setRawRows(parsed.rows)
    setSkippedCount(parsed.skippedCount)
    setCsvSupplierCode(parsed.supplierCode)
    setCsvSupplierName(parsed.supplierName)
  }

  // CSVの仕入先コードから既存仕入先を自動推定
  const autoMatchedSupplier = suppliers.find(s => s.supplier_code && csvSupplierCode && s.supplier_code.trim() === csvSupplierCode)

  const resolved: Resolved[] = rawRows.map(r => {
    const p = r.productCode ? products.find(x => x.product_code && x.product_code.trim() === r.productCode) : undefined
    return { ...r, productId: p?.id || null, willCreate: !p && autoCreateProducts }
  })

  const newProductCount = new Set(resolved.filter(r => r.willCreate).map(r => r.productCode || r.productName)).size
  const skippedNoMasterCount = resolved.filter(r => !r.productId && !r.willCreate).length
  const totalAmount = resolved.reduce((s, r) => s + (r.amount ?? ((r.unitPrice || 0) * (r.quantity || 0))), 0)
  const dates = rawRows.map(r => r.voucherDate).filter(Boolean).sort()
  const periodLabel = dates.length ? `${dates[0]} 〜 ${dates[dates.length - 1]}` : "―"

  const effectiveSupplierId = supplierId || autoMatchedSupplier?.id || ""
  const canImport = rawRows.length > 0 && (effectiveSupplierId || createSupplier) && !importing

  async function handleImport() {
    if (!confirm(
      `${resolved.length}行を取り込みます。\n` +
      `新規商品: ${newProductCount}件\n` +
      `商品マスタ未登録でスキップ: ${skippedNoMasterCount}件\n` +
      `合計金額: ${fmtYen(totalAmount)}\n` +
      (applyToStock ? "\n⚠ 在庫数にも反映します\n" : "\n（在庫数には反映しません＝月次請求書との照合用の記録のみ）\n") +
      "\nよろしいですか？"
    )) return

    setImporting(true)
    try {
      // 1) 仕入先の確定（新規作成 or 既存）
      let finalSupplierId = effectiveSupplierId
      let newSupplier = false
      if (!finalSupplierId && createSupplier) {
        const { data, error } = await supabase.from("suppliers").insert({
          name: csvSupplierName || "(名称未設定)",
          supplier_code: csvSupplierCode || null,
        }).select().single()
        if (error) throw new Error("仕入先の新規作成に失敗: " + error.message)
        finalSupplierId = data.id
        newSupplier = true
      }
      if (!finalSupplierId) throw new Error("仕入先が未確定です")

      // 2) 新規商品をまとめて作成（商品コード基準で重複排除）
      const productIdByCode = new Map<string, string>(
        products.filter(p => p.product_code).map(p => [p.product_code as string, p.id])
      )
      const toCreate = new Map<string, ParsedRow>()
      resolved.forEach(r => {
        if (r.willCreate) {
          const key = r.productCode || `__name__${r.productName}`
          if (!toCreate.has(key)) toCreate.set(key, r)
        }
      })
      for (const [key, r] of toCreate) {
        const { data, error } = await supabase.from("products").insert({
          name: r.productName,
          product_code: r.productCode || null,
          manufacturer: r.manufacturer || csvSupplierName || null,
          stock: 0,
          reorder_level: 10,
          cost: r.unitPrice,
          price: 0,
          is_active: true,
        }).select().single()
        if (error) { console.error("商品作成失敗:", r.productName, error.message); continue }
        if (r.productCode) productIdByCode.set(r.productCode, data.id)
        else productIdByCode.set(key, data.id)
      }

      // 3) stock_receipts をまとめて登録
      const receiptRows = resolved
        .map(r => {
          const pid = r.productId
            || (r.productCode ? productIdByCode.get(r.productCode) : undefined)
            || productIdByCode.get(`__name__${r.productName}`)
          if (!pid) return null
          return {
            product_id: pid,
            supplier_id: finalSupplierId,
            quantity: r.quantity ?? 0,
            unit_price: r.unitPrice,
            created_at: r.voucherDate ? `${r.voucherDate}T00:00:00` : undefined,
            memo: [r.voucherNo && `伝票№:${r.voucherNo}`, r.memo, "CSV取込"].filter(Boolean).join(" / "),
          }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)

      const CHUNK = 500
      for (let i = 0; i < receiptRows.length; i += CHUNK) {
        const { error } = await supabase.from("stock_receipts").insert(receiptRows.slice(i, i + CHUNK))
        if (error) throw new Error("入荷記録の登録に失敗: " + error.message)
      }

      // 4) 任意: 在庫数に反映
      if (applyToStock) {
        const qtyByProduct = new Map<string, number>()
        receiptRows.forEach(r => qtyByProduct.set(r.product_id, (qtyByProduct.get(r.product_id) || 0) + Number(r.quantity || 0)))
        for (const [pid, qty] of qtyByProduct) {
          const { data: prod } = await supabase.from("products").select("stock").eq("id", pid).single()
          const before = Number(prod?.stock || 0)
          await supabase.from("products").update({ stock: before + qty }).eq("id", pid)
        }
      }

      setResult({ inserted: receiptRows.length, newProducts: toCreate.size, newSupplier })
      await loadMasters()
    } catch (e) {
      alert("取り込みに失敗しました: " + (e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center flex-wrap gap-3">
        <h1 className="text-lg font-bold text-gray-900" style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: 0 }}>
          📥 仕入CSV取り込み
          <span className="ml-2 text-xs font-normal text-gray-400">外部システムの仕入日報CSVをまとめて仕入履歴に登録</span>
        </h1>
        <Link href="/admin/receiving" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold text-blue-700 bg-blue-100 hover:bg-blue-200 transition-colors">
          📦 仕入納品（手入力・PDF）
        </Link>
        <Link href="/admin/receivings" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold text-blue-700 bg-blue-100 hover:bg-blue-200 transition-colors">
          📋 入荷履歴一覧
        </Link>
        <Link href="/admin/supplier-invoices" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold text-purple-700 bg-purple-100 hover:bg-purple-200 transition-colors">
          🔍 月次請求書 付け合わせ
        </Link>
      </div>

      <div className="rounded-lg p-4 space-y-3" style={{ border: "1px solid #e5e7eb", background: "#fff" }}>
        <p className="text-sm text-gray-600">
          「仕入先コード・仕入先名・伝票日付・商品コード・商品名・数量・単価・金額」などの列を持つCSVに対応しています（列の並び順は自由、余計な列があっても問題ありません）。
          値引き・入金などの調整行（仕入区分が「仕入」以外）は自動でスキップされます。文字化けするCSV（Shift-JIS）も自動判定します。
        </p>
        <div>
          <label
            htmlFor="csv-upload"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold cursor-pointer bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            📄 CSVファイルを選択
          </label>
          <input
            id="csv-upload" ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = "" }}
          />
          {fileName && <span className="ml-3 text-sm text-gray-500">{fileName}</span>}
          {loadingMasters && <span className="ml-3 text-sm text-gray-400">商品・仕入先マスタを読み込み中…</span>}
        </div>

        {parseError && (
          <div className="rounded-lg p-3" style={{ border: "1px solid #fca5a5", background: "#fff1f2" }}>
            <p className="text-sm font-bold text-red-700 whitespace-pre-wrap">⚠ {parseError}</p>
          </div>
        )}
      </div>

      {rawRows.length > 0 && (
        <>
          <div className="rounded-lg p-4 space-y-3" style={{ border: "1px solid #e5e7eb", background: "#fff" }}>
            <h2 className="text-sm font-bold text-gray-900">仕入先</h2>
            {autoMatchedSupplier ? (
              <p className="text-sm text-emerald-700">✅ 「{autoMatchedSupplier.name}」に自動で一致しました（仕入先コード: {csvSupplierCode}）</p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-amber-700">⚠ 仕入先コード「{csvSupplierCode || "(なし)"}」・仕入先名「{csvSupplierName || "(なし)"}」に一致する登録済み仕入先が見つかりません。</p>
                <div className="flex items-center gap-3 flex-wrap">
                  <select
                    className="border rounded px-2 py-1 text-sm"
                    value={supplierId}
                    onChange={(e) => { setSupplierId(e.target.value); if (e.target.value) setCreateSupplier(false) }}
                  >
                    <option value="">既存の仕入先から選ぶ…</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={createSupplier} onChange={(e) => { setCreateSupplier(e.target.checked); if (e.target.checked) setSupplierId("") }} />
                    新しい仕入先として登録する（{csvSupplierName || "名称未設定"}）
                  </label>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg p-4 space-y-3" style={{ border: "1px solid #e5e7eb", background: "#fff" }}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="text-sm font-bold text-gray-900">取り込み内容</h2>
              <div className="flex items-center gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={autoCreateProducts} onChange={(e) => setAutoCreateProducts(e.target.checked)} />
                  商品マスタに無い商品は自動で新規登録する
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={applyToStock} onChange={(e) => setApplyToStock(e.target.checked)} />
                  在庫数にも反映する
                </label>
              </div>
            </div>
            {applyToStock && (
              <p className="text-xs text-amber-700">⚠ 過去分をまとめて取り込む場合、在庫数が現在の実在庫と合わなくなることがあります。月次請求書との照合だけが目的なら、チェックを外したままにしてください。</p>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
              <div className="rounded p-2" style={{ background: "#f9fafb" }}><div className="text-gray-500">対象行数</div><div className="font-bold text-gray-900">{resolved.length}件</div></div>
              <div className="rounded p-2" style={{ background: "#f9fafb" }}><div className="text-gray-500">スキップ（値引等）</div><div className="font-bold text-gray-900">{skippedCount}件</div></div>
              <div className="rounded p-2" style={{ background: "#f9fafb" }}><div className="text-gray-500">新規商品</div><div className="font-bold text-gray-900">{newProductCount}件</div></div>
              <div className="rounded p-2" style={{ background: skippedNoMasterCount > 0 ? "#fff7ed" : "#f9fafb" }}><div className="text-gray-500">商品マスタ未登録</div><div className="font-bold" style={{ color: skippedNoMasterCount > 0 ? "#c2410c" : "#111827" }}>{skippedNoMasterCount}件</div></div>
              <div className="rounded p-2" style={{ background: "#f9fafb" }}><div className="text-gray-500">合計金額</div><div className="font-bold text-gray-900">{fmtYen(totalAmount)}</div></div>
            </div>
            <p className="text-xs text-gray-500">対象期間: {periodLabel}</p>

            <div className="overflow-auto rounded border" style={{ maxHeight: 420 }}>
              <table className="w-full text-xs">
                <thead className="sticky top-0" style={{ background: "#f9fafb" }}>
                  <tr>
                    <th className="text-left p-2">状態</th>
                    <th className="text-left p-2">伝票日付</th>
                    <th className="text-left p-2">商品コード</th>
                    <th className="text-left p-2">商品名</th>
                    <th className="text-right p-2">数量</th>
                    <th className="text-right p-2">単価</th>
                    <th className="text-right p-2">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {resolved.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2">
                        {r.productId ? <span className="text-emerald-700">既存</span>
                          : r.willCreate ? <span className="text-blue-700">新規作成</span>
                          : <span className="text-orange-600">未登録(スキップ)</span>}
                      </td>
                      <td className="p-2">{r.voucherDate}</td>
                      <td className="p-2">{r.productCode}</td>
                      <td className="p-2">{r.productName}</td>
                      <td className="p-2 text-right">{r.quantity ?? "―"}</td>
                      <td className="p-2 text-right">{r.unitPrice != null ? fmtYen(r.unitPrice) : "―"}</td>
                      <td className="p-2 text-right">{r.amount != null ? fmtYen(r.amount) : "―"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleImport}
                disabled={!canImport}
                className={"px-4 py-2 rounded-lg text-sm font-bold " + (canImport ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-gray-200 text-gray-400 cursor-not-allowed")}
              >
                {importing ? "登録中…" : `この内容で仕入登録（${resolved.length}件）`}
              </button>
            </div>
          </div>
        </>
      )}

      {result && (
        <div className="rounded-lg p-4" style={{ border: "2px solid #059669", background: "#f0fdf4" }}>
          <p className="text-sm font-bold text-emerald-800">
            ✅ 取り込み完了 — {result.inserted}件を仕入履歴に登録しました
            {result.newProducts > 0 && `（新規商品 ${result.newProducts}件）`}
            {result.newSupplier && "（新しい仕入先を登録しました）"}
          </p>
          <div className="flex gap-2 mt-2">
            <Link href="/admin/receivings" className="text-sm text-blue-700 underline">入荷履歴一覧で確認</Link>
            <Link href="/admin/supplier-invoices" className="text-sm text-purple-700 underline">月次請求書と付け合わせる</Link>
          </div>
        </div>
      )}
    </div>
  )
}
