"use client"

// 仕入CSV取り込み（外部システムの「仕入日報」または「商品元帳」CSVを stock_receipts に一括登録）
//
// - 仕入区分/区分が「仕入」の行だけを取り込む（売上・値引き・入金などは対象外）
// - 仕入先は行ごとに判定する（仕入先コード/取引先コード → 無ければ名称で既存仕入先と一致）。
//   一致しない仕入先は、ファイル内の仕入先ごとに「既存から選ぶ／新規登録／取り込まない」を選べる
// - 取り込む行は1行ずつチェックで選べる。すでにデントハブへ入荷登録済みの可能性が高い行は初期状態でOFF
// - 商品は商品コードで一致（Excel保存で壊れたコード 4.9E+12 形式は商品名で一致）。無ければ新規作成（ON/OFF可）
// - created_at は伝票日付。在庫数への反映は「基準日より後の伝票のみ」（棚卸し済みの期間の二重加算を防ぐ）

import { useMemo, useRef, useState } from "react"
import Link from "next/link"
import { supabase, fetchAll } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { readTextSmart, parsePurchaseCsv, type PurchaseCsvRow } from "@/lib/purchase-csv"

type Product = { id: string; name: string; product_code: string | null }
type Supplier = { id: string; name: string; supplier_code: string | null }
type ExistingReceipt = { product_id: string; quantity: number; date: string; memo: string | null }
type SupplierChoice = { mode: "existing" | "create" | "skip"; id: string }

const normName = (s: string) => String(s || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "")
const isBrokenCode = (c: string) => /e\+/i.test(c) // Excelで指数表記になったJAN
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000)
const supplierKey = (r: PurchaseCsvRow) => r.supplierCode || r.supplierName || "(仕入先なし)"

export default function CsvImportPage() {
  const fileRef = useRef<HTMLInputElement>(null)

  const [fileName, setFileName] = useState("")
  const [parseError, setParseError] = useState("")
  const [rawRows, setRawRows] = useState<PurchaseCsvRow[]>([])
  const [skippedCount, setSkippedCount] = useState(0)

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [existingReceipts, setExistingReceipts] = useState<ExistingReceipt[]>([])
  const [choices, setChoices] = useState<Record<string, SupplierChoice>>({}) // 仕入先ごとの選択（自動一致しないもの）
  const [overrides, setOverrides] = useState<Record<number, boolean>>({})    // 行ごとの取込ON/OFF（手動切替）
  const [autoCreateProducts, setAutoCreateProducts] = useState(true)
  const [applyToStock, setApplyToStock] = useState(false)
  const [cutoff, setCutoff] = useState("2026-09-22")

  const [loadingMasters, setLoadingMasters] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ inserted: number; newProducts: number; newSuppliers: number; stockRows: number } | null>(null)

  async function loadMasters(sinceDate?: string) {
    setLoadingMasters(true)
    // 商品は1万件を超えるため、Supabase既定の1000件上限に引っかからないよう fetchAll でページング取得する
    const [{ data: sup }, prod] = await Promise.all([
      supabase.from("suppliers").select("id,name,supplier_code").order("name").limit(2000),
      fetchAll("products", "id,name,product_code"),
    ])
    setSuppliers((sup as Supplier[]) || [])
    setProducts((prod as Product[]) || [])
    if (sinceDate) {
      const since = new Date(`${sinceDate}T00:00:00+09:00`); since.setDate(since.getDate() - 1)
      const rc = await fetchAll("stock_receipts", "product_id,quantity,created_at,memo", (q: any) => q.gte("created_at", since.toISOString()))
      setExistingReceipts(((rc as { product_id: string; quantity: number; created_at: string; memo: string | null }[]) || []).map(r => ({
        product_id: r.product_id, quantity: Number(r.quantity || 0), date: r.created_at.slice(0, 10), memo: r.memo,
      })))
    }
    setLoadingMasters(false)
  }

  async function handleFile(file: File) {
    setFileName(file.name)
    setParseError(""); setRawRows([]); setResult(null); setSkippedCount(0); setChoices({}); setOverrides({})

    const text = await readTextSmart(file)
    const parsed = parsePurchaseCsv(text)
    if (parsed.error) { setParseError(parsed.error); return }

    const dates = parsed.rows.map(r => r.voucherDate).filter(Boolean).sort()
    await loadMasters(dates[0])
    setRawRows(parsed.rows)
    setSkippedCount(parsed.skippedCount)
  }

  // ── 仕入先: 行ごと（ファイル内の仕入先ごと）に既存仕入先を自動一致 ──
  const autoSupplier = (r: PurchaseCsvRow): Supplier | undefined =>
    suppliers.find(s => r.supplierCode && s.supplier_code && s.supplier_code.trim() === r.supplierCode)
    ?? suppliers.find(s => r.supplierName && normName(s.name) === normName(r.supplierName))

  const fileSuppliers = useMemo(() => {
    const m = new Map<string, { key: string; code: string; name: string; count: number; auto?: Supplier }>()
    for (const r of rawRows) {
      const k = supplierKey(r)
      const cur = m.get(k) || { key: k, code: r.supplierCode, name: r.supplierName, count: 0, auto: autoSupplier(r) }
      cur.count++
      m.set(k, cur)
    }
    return Array.from(m.values())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawRows, suppliers])

  // その仕入先の扱い: 手動選択 > 自動一致 > 未確定
  const supplierState = (key: string): { ok: boolean; label: string; id: string | null; create: boolean } => {
    const fs = fileSuppliers.find(s => s.key === key)
    const c = choices[key]
    if (c?.mode === "skip") return { ok: false, label: "取り込まない", id: null, create: false }
    if (c?.mode === "create") return { ok: true, label: "新規登録", id: null, create: true }
    if (c?.mode === "existing" && c.id) return { ok: true, label: suppliers.find(s => s.id === c.id)?.name || "", id: c.id, create: false }
    if (fs?.auto) return { ok: true, label: fs.auto.name, id: fs.auto.id, create: false }
    return { ok: false, label: "未確定", id: null, create: false }
  }

  // ── 商品: コード → 名前 の順で既存一致 ──
  const byCode = useMemo(() => new Map(products.filter(p => p.product_code).map(p => [(p.product_code as string).trim(), p])), [products])
  const byName = useMemo(() => new Map(products.map(p => [normName(p.name), p])), [products])

  const resolved = useMemo(() => {
    const usedReceipts = new Set<number>() // 既存入荷1件につき1行までしか「登録済み」とみなさない
    return rawRows.map((r, idx) => {
      const p = (r.productCode && !isBrokenCode(r.productCode) ? byCode.get(r.productCode) : undefined) ?? byName.get(normName(r.productName))
      const productId = p?.id || null
      // 登録済みの判定: ①CSV取込済み（同じ伝票№・同じ商品）②同じ商品・同じ数量の入荷が近い日付（前日〜7日後）に既にある
      let dup: "imported" | "likely" | null = null
      if (productId) {
        const imported = r.voucherNo && existingReceipts.some(e => e.product_id === productId && (e.memo || "").includes(`伝票№:${r.voucherNo}`))
        if (imported) dup = "imported"
        else {
          const hit = existingReceipts.findIndex((e, ei) => !usedReceipts.has(ei) && e.product_id === productId && e.quantity === Number(r.quantity ?? 0) && r.voucherDate && dayDiff(e.date, r.voucherDate) >= -1 && dayDiff(e.date, r.voucherDate) <= 7)
          if (hit >= 0) { usedReceipts.add(hit); dup = "likely" }
        }
      }
      return { ...r, idx, productId, willCreate: !p && autoCreateProducts, dup }
    })
  }, [rawRows, byCode, byName, existingReceipts, autoCreateProducts])

  const isOn = (r: (typeof resolved)[number]) =>
    overrides[r.idx] ?? (supplierState(supplierKey(r)).ok && (!!r.productId || r.willCreate) && !r.dup)
  const rowReady = (r: (typeof resolved)[number]) => supplierState(supplierKey(r)).ok && (!!r.productId || r.willCreate)
  const target = resolved.filter(r => isOn(r) && rowReady(r))

  const newProductCount = new Set(target.filter(r => r.willCreate).map(r => r.productCode || r.productName)).size
  const amountOf = (r: PurchaseCsvRow) => r.amount ?? ((r.unitPrice || 0) * (r.quantity || 0))
  const totalAmount = target.reduce((s, r) => s + amountOf(r), 0)
  const dates = rawRows.map(r => r.voucherDate).filter(Boolean).sort()
  const periodLabel = dates.length ? `${dates[0]} 〜 ${dates[dates.length - 1]}` : "―"
  const stockRowCount = applyToStock ? target.filter(r => r.voucherDate > cutoff).length : 0
  const canImport = target.length > 0 && !importing

  async function handleImport() {
    const newSup = fileSuppliers.filter(s => supplierState(s.key).create && target.some(r => supplierKey(r) === s.key))
    if (!confirm(
      `${target.length}行を取り込みます（チェックなしの${resolved.length - target.length}行は取り込みません）。\n` +
      `新規商品: ${newProductCount}件 ／ 新規仕入先: ${newSup.length}件\n` +
      `合計金額: ${fmtYen(totalAmount)}\n` +
      (applyToStock ? `\n⚠ 在庫数に反映するのは、${cutoff}より後の伝票 ${stockRowCount}行だけです\n` : "\n（在庫数には反映しません＝仕入履歴の記録のみ）\n") +
      "\nよろしいですか？"
    )) return

    setImporting(true)
    try {
      // 1) 新規仕入先を作成
      const createdSupplierId = new Map<string, string>()
      for (const s of newSup) {
        const { data, error } = await supabase.from("suppliers").insert({ name: s.name || "(名称未設定)", supplier_code: s.code || null }).select().single()
        if (error) throw new Error(`仕入先「${s.name}」の新規作成に失敗: ${error.message}`)
        createdSupplierId.set(s.key, data.id)
      }
      const supplierIdOf = (r: PurchaseCsvRow) => {
        const key = supplierKey(r)
        return createdSupplierId.get(key) ?? supplierState(key).id
      }

      // 2) 新規商品をまとめて作成（商品コード or 名前基準で重複排除）
      const newIdByKey = new Map<string, string>()
      const toCreate = new Map<string, PurchaseCsvRow>()
      target.forEach(r => {
        if (r.willCreate) {
          const key = r.productCode && !isBrokenCode(r.productCode) ? r.productCode : `__name__${normName(r.productName)}`
          if (!toCreate.has(key)) toCreate.set(key, r)
        }
      })
      for (const [key, r] of toCreate) {
        const { data, error } = await supabase.from("products").insert({
          name: r.productName,
          product_code: r.productCode && !isBrokenCode(r.productCode) ? r.productCode : null,
          manufacturer: r.manufacturer || r.supplierName || null,
          stock: 0, reorder_level: 10, cost: r.unitPrice, price: 0, is_active: true,
        }).select().single()
        if (error) { console.error("商品作成失敗:", r.productName, error.message); continue }
        newIdByKey.set(key, data.id)
      }
      const productIdOf = (r: (typeof resolved)[number]) =>
        r.productId ?? newIdByKey.get(r.productCode && !isBrokenCode(r.productCode) ? r.productCode : `__name__${normName(r.productName)}`) ?? null

      // 3) stock_receipts を登録（伝票日付を created_at に）
      const receiptRows = target.map(r => {
        const pid = productIdOf(r); const sid = supplierIdOf(r)
        if (!pid || !sid) return null
        return {
          row: r, pid,
          rec: {
            product_id: pid, supplier_id: sid, quantity: r.quantity ?? 0, unit_price: r.unitPrice,
            created_at: r.voucherDate ? `${r.voucherDate}T00:00:00` : undefined,
            memo: [r.voucherNo && `伝票№:${r.voucherNo}`, r.memo, "CSV取込"].filter(Boolean).join(" / "),
          },
        }
      }).filter((x): x is NonNullable<typeof x> => x !== null)

      const CHUNK = 500
      for (let i = 0; i < receiptRows.length; i += CHUNK) {
        const { error } = await supabase.from("stock_receipts").insert(receiptRows.slice(i, i + CHUNK).map(x => x.rec))
        if (error) throw new Error("入荷記録の登録に失敗: " + error.message)
      }

      // 4) 任意: 在庫数に反映（基準日より後の伝票のみ。履歴も残す）
      let stockRows = 0
      if (applyToStock) {
        const qtyByProduct = new Map<string, number>()
        receiptRows.filter(x => x.row.voucherDate > cutoff).forEach(x => {
          qtyByProduct.set(x.pid, (qtyByProduct.get(x.pid) || 0) + Number(x.rec.quantity || 0)); stockRows++
        })
        for (const [pid, qty] of qtyByProduct) {
          const { data: prod } = await supabase.from("products").select("stock").eq("id", pid).single()
          const before = Number(prod?.stock || 0), after = before + qty
          await supabase.from("products").update({ stock: after }).eq("id", pid)
          try {
            await supabase.from("stock_movements").insert({
              product_id: pid, movement_type: "入庫", quantity: qty, before_stock: before, after_stock: after,
              ref_type: "stock_receipt", reason: "仕入CSV取込",
            })
          } catch { /* 履歴テーブルが無い環境ではスキップ */ }
        }
      }

      setResult({ inserted: receiptRows.length, newProducts: toCreate.size, newSuppliers: createdSupplierId.size, stockRows })
      setOverrides({})
      await loadMasters(dates[0])
    } catch (e) {
      alert("取り込みに失敗しました: " + (e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const setAll = (on: boolean) => setOverrides(Object.fromEntries(resolved.filter(rowReady).map(r => [r.idx, on])))

  return (
    <div className="space-y-3">
      <div className="flex items-center flex-wrap gap-3">
        <h1 className="text-lg font-bold text-gray-900" style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: 0 }}>
          📥 仕入CSV取り込み
          <span className="ml-2 text-xs font-normal text-gray-400">仕入日報・商品元帳のCSVから仕入を登録</span>
        </h1>
        <Link href="/admin/receiving" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold text-blue-700 bg-blue-100 hover:bg-blue-200 transition-colors">📦 仕入納品（手入力・PDF）</Link>
        <Link href="/admin/receivings" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold text-blue-700 bg-blue-100 hover:bg-blue-200 transition-colors">📋 入荷履歴一覧</Link>
        <Link href="/admin/supplier-invoices" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold text-purple-700 bg-purple-100 hover:bg-purple-200 transition-colors">🔍 月次請求書 付け合わせ</Link>
      </div>

      <div className="rounded-lg p-4 space-y-3" style={{ border: "1px solid #e5e7eb", background: "#fff" }}>
        <p className="text-sm text-gray-600">
          「仕入日報」または「商品元帳」のCSVに対応しています（区分が「仕入」の行だけを取り込みます。売上・値引き・入金などは自動でスキップ）。
          仕入先は行ごとに判定するので、複数の仕入先が混在していても取り込めます。文字化けするCSV（Shift-JIS）も自動判定します。
        </p>
        <div>
          <label htmlFor="csv-upload" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold cursor-pointer bg-blue-600 text-white hover:bg-blue-700 transition-colors">📄 CSVファイルを選択</label>
          <input id="csv-upload" ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = "" }} />
          {fileName && <span className="ml-3 text-sm text-gray-500">{fileName}</span>}
          {loadingMasters && <span className="ml-3 text-sm text-gray-400">商品・仕入先・入荷履歴を読み込み中…</span>}
        </div>
        {parseError && (
          <div className="rounded-lg p-3" style={{ border: "1px solid #fca5a5", background: "#fff1f2" }}>
            <p className="text-sm font-bold text-red-700 whitespace-pre-wrap">⚠ {parseError}</p>
          </div>
        )}
      </div>

      {rawRows.length > 0 && (
        <>
          <div className="rounded-lg p-4 space-y-2" style={{ border: "1px solid #e5e7eb", background: "#fff" }}>
            <h2 className="text-sm font-bold text-gray-900">仕入先（ファイル内 {fileSuppliers.length} 社）</h2>
            <div className="space-y-1.5">
              {fileSuppliers.map(fs => {
                const st = supplierState(fs.key)
                const c = choices[fs.key]
                return (
                  <div key={fs.key} className="flex items-center gap-2 flex-wrap text-sm">
                    <span className="font-bold">{fs.name || "(名称なし)"}</span>
                    <span className="text-xs text-gray-400">#{fs.code || "-"}・{fs.count}行</span>
                    {fs.auto && !c ? (
                      <span className="text-emerald-700">✅ 「{fs.auto.name}」に自動一致</span>
                    ) : (
                      <>
                        {!fs.auto && !c && <span className="text-amber-700">⚠ 一致する仕入先なし</span>}
                        <select className="border rounded px-2 py-1 text-xs"
                          value={c?.mode === "existing" ? c.id : c?.mode === "create" ? "__create__" : c?.mode === "skip" ? "__skip__" : ""}
                          onChange={(e) => {
                            const v = e.target.value
                            setChoices(prev => {
                              const n = { ...prev }
                              if (v === "") delete n[fs.key]
                              else if (v === "__create__") n[fs.key] = { mode: "create", id: "" }
                              else if (v === "__skip__") n[fs.key] = { mode: "skip", id: "" }
                              else n[fs.key] = { mode: "existing", id: v }
                              return n
                            })
                          }}>
                          <option value="">{fs.auto ? "自動一致を使う" : "選んでください…"}</option>
                          <option value="__create__">＋ 新しい仕入先として登録（{fs.name || "名称未設定"}）</option>
                          <option value="__skip__">この仕入先の行は取り込まない</option>
                          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        {c && <span className="text-xs text-gray-500">→ {st.label}</span>}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="rounded-lg p-4 space-y-3" style={{ border: "1px solid #e5e7eb", background: "#fff" }}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="text-sm font-bold text-gray-900">取り込み内容（チェックした行だけ登録します）</h2>
              <div className="flex items-center gap-4 text-sm flex-wrap">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={autoCreateProducts} onChange={(e) => setAutoCreateProducts(e.target.checked)} />
                  商品マスタに無い商品は新規登録する
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={applyToStock} onChange={(e) => setApplyToStock(e.target.checked)} />
                  在庫数にも反映する
                </label>
                {applyToStock && (
                  <label className="flex items-center gap-1.5">
                    基準日
                    <input type="date" value={cutoff} onChange={(e) => setCutoff(e.target.value)} className="border rounded px-2 py-0.5 text-sm" />
                    <span className="text-xs text-gray-500">より後の伝票だけ</span>
                  </label>
                )}
              </div>
            </div>
            {applyToStock && (
              <p className="text-xs text-amber-700">⚠ 在庫数に反映するのは基準日（棚卸しした日）より後の伝票だけです。基準日以前の仕入は棚卸し数に反映済みのため、履歴のみ登録します。</p>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
              <div className="rounded p-2" style={{ background: "#f9fafb" }}><div className="text-gray-500">取り込む行 / 全体</div><div className="font-bold text-gray-900">{target.length} / {resolved.length}件</div></div>
              <div className="rounded p-2" style={{ background: "#f9fafb" }}><div className="text-gray-500">スキップ（売上・値引等）</div><div className="font-bold text-gray-900">{skippedCount}件</div></div>
              <div className="rounded p-2" style={{ background: "#f9fafb" }}><div className="text-gray-500">新規商品</div><div className="font-bold text-gray-900">{newProductCount}件</div></div>
              <div className="rounded p-2" style={{ background: "#f9fafb" }}><div className="text-gray-500">在庫に反映する行</div><div className="font-bold text-gray-900">{stockRowCount}件</div></div>
              <div className="rounded p-2" style={{ background: "#f9fafb" }}><div className="text-gray-500">合計金額</div><div className="font-bold text-gray-900">{fmtYen(totalAmount)}</div></div>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span>対象期間: {periodLabel}</span>
              <button className="underline" onClick={() => setAll(true)}>すべて選択</button>
              <button className="underline" onClick={() => setAll(false)}>すべて解除</button>
              <button className="underline" onClick={() => setOverrides({})}>初期状態に戻す</button>
            </div>

            <div className="overflow-auto rounded border" style={{ maxHeight: 460 }}>
              <table className="w-full text-xs">
                <thead className="sticky top-0" style={{ background: "#f9fafb" }}>
                  <tr>
                    <th className="p-2 text-center">取込</th>
                    <th className="text-left p-2">状態</th>
                    <th className="text-left p-2">伝票日付</th>
                    <th className="text-left p-2">仕入先</th>
                    <th className="text-left p-2">商品名</th>
                    <th className="text-right p-2">数量</th>
                    <th className="text-right p-2">単価</th>
                    <th className="text-right p-2">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {resolved.map((r) => {
                    const ready = rowReady(r)
                    const sst = supplierState(supplierKey(r))
                    return (
                      <tr key={r.idx} className={"border-t " + (!ready ? "bg-gray-50 text-gray-400" : r.dup ? "bg-amber-50" : "")}>
                        <td className="p-2 text-center">
                          <input type="checkbox" checked={ready && isOn(r)} disabled={!ready}
                            onChange={(e) => setOverrides(prev => ({ ...prev, [r.idx]: e.target.checked }))} />
                        </td>
                        <td className="p-2 whitespace-nowrap">
                          {!sst.ok ? <span className="text-orange-600">仕入先未確定</span>
                            : r.dup === "imported" ? <span className="text-amber-700 font-bold">取込済み</span>
                            : r.dup === "likely" ? <span className="text-amber-700 font-bold">登録済みの可能性</span>
                            : r.productId ? <span className="text-emerald-700">既存商品</span>
                            : r.willCreate ? <span className="text-blue-700">新規商品</span>
                            : <span className="text-orange-600">商品未登録</span>}
                        </td>
                        <td className="p-2 whitespace-nowrap">{r.voucherDate}</td>
                        <td className="p-2">{r.supplierName || "―"}</td>
                        <td className="p-2">{r.productName}</td>
                        <td className="p-2 text-right">{r.quantity ?? "―"}</td>
                        <td className="p-2 text-right">{r.unitPrice != null ? fmtYen(r.unitPrice) : "―"}</td>
                        <td className="p-2 text-right">{r.amount != null ? fmtYen(r.amount) : "―"}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end gap-3">
              <span className="text-[11px] text-gray-500">「登録済みの可能性」の行は、同じ商品・同じ数量の入荷が近い日付に既にあるため初期状態でOFFです（内容を見て切り替えできます）</span>
              <button onClick={handleImport} disabled={!canImport}
                className={"px-4 py-2 rounded-lg text-sm font-bold " + (canImport ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-gray-200 text-gray-400 cursor-not-allowed")}>
                {importing ? "登録中…" : `チェックした${target.length}件を仕入登録`}
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
            {result.newSuppliers > 0 && `（新規仕入先 ${result.newSuppliers}件）`}
            {result.stockRows > 0 && `／在庫に反映 ${result.stockRows}行`}
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
