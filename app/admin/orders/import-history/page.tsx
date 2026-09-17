"use client"

// 得意先別売上日報CSV取り込み（外部の販売管理システムの過去実績を、記録用の注文履歴として登録）
//
// 想定フォーマット（列名で判定。列の並び順は問わない）:
//   得意先コード,得意先名,伝票日付,伝票№,伝票種類,売上区分,商品コード,商品名,メーカー,
//   原価,単価,数量,金額,利益,高度医療項目,摘要,経費分類,商品分類,クラス,担当者名
//
// - 伝票№ごとに1注文（status=納品済み）としてまとめて登録する
// - 商品マスタとは紐付けない（商品名はCSVのテキストのまま保存）。在庫・粗利計算には一切影響しない
// - 商品コードでの自動突合はしない（コード体系が別システムのため誤マッチのリスクがある）
// - 同じ医院・伝票№の組み合わせは、既存注文があれば重複登録しない（再実行しても安全）
// - 取り込み対象期間の終了日は必ず指定する（すでにDentHub本体で稼働中の医院の場合、
//   その医院の最初のDentHub注文日より前までに絞らないと、実績が二重に記録される）

import { useState } from "react"
import Link from "next/link"
import { supabase, fetchAll } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"
import { readTextSmart, parseSalesHistoryCsv, type SalesHistoryVoucher } from "@/lib/sales-history-csv"

type Clinic = { id: string; name: string }

export default function ImportHistoryPage() {
  const [fileName, setFileName] = useState("")
  const [parseError, setParseError] = useState("")
  const [vouchers, setVouchers] = useState<SalesHistoryVoucher[]>([])
  const [endDate, setEndDate] = useState("")

  const [clinics, setClinics] = useState<Clinic[]>([])
  const [loadingMasters, setLoadingMasters] = useState(false)
  const [clinicOverride, setClinicOverride] = useState<Record<string, string>>({})  // CSV医院名 → clinics.id

  const [existingKeys, setExistingKeys] = useState<Set<string> | null>(null)  // "clinicId__voucherNo"
  const [checkingExisting, setCheckingExisting] = useState(false)

  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState("")
  const [result, setResult] = useState<{ orders: number; items: number; skippedDuplicate: number } | null>(null)

  async function loadMasters() {
    setLoadingMasters(true)
    const { data } = await supabase.from("clinics").select("id,name").limit(50000)
    setClinics((data as Clinic[]) || [])
    setLoadingMasters(false)
  }

  async function handleFile(file: File) {
    setFileName(file.name)
    setParseError("")
    setVouchers([])
    setResult(null)
    setExistingKeys(null)
    setClinicOverride({})

    if (clinics.length === 0) await loadMasters()

    const text = await readTextSmart(file)
    const parsed = parseSalesHistoryCsv(text)
    if (parsed.error) { setParseError(parsed.error); return }
    setVouchers(parsed.vouchers)
  }

  const inRange = vouchers.filter(v => !endDate || v.date <= endDate)

  const clinicNameSet = Array.from(new Set(inRange.map(v => v.clinicName)))
  const clinicMatch = new Map<string, Clinic | null>(
    clinicNameSet.map(name => [name, clinics.find(c => c.name === name) || null])
  )
  const resolvedClinicId = (csvName: string): string | null =>
    clinicOverride[csvName] || clinicMatch.get(csvName)?.id || null

  const unmatchedNames = clinicNameSet.filter(name => !resolvedClinicId(name))

  // 重複チェック: 対象クリニックの既存注文の delivery_number を取得済みかどうか
  async function checkExisting() {
    const clinicIds = Array.from(new Set(inRange.map(v => resolvedClinicId(v.clinicName)).filter((id): id is string => !!id)))
    if (clinicIds.length === 0) { setExistingKeys(new Set()); return }
    setCheckingExisting(true)
    const rows = await fetchAll("orders", "clinic_id,delivery_number", (q: any) => q.in("clinic_id", clinicIds))
    const keys = new Set<string>((rows || []).filter((r: any) => r.delivery_number).map((r: any) => `${r.clinic_id}__${r.delivery_number}`))
    setExistingKeys(keys)
    setCheckingExisting(false)
  }

  const withStatus = inRange.map(v => {
    const clinicId = resolvedClinicId(v.clinicName)
    const key = clinicId ? `${clinicId}__${v.voucherNo}` : null
    const isDuplicate = !!(key && existingKeys?.has(key))
    return { ...v, clinicId, isDuplicate }
  })

  const toImport = withStatus.filter(v => v.clinicId && !v.isDuplicate)
  const duplicateCount = withStatus.filter(v => v.isDuplicate).length
  const totalItems = toImport.reduce((s, v) => s + v.items.length, 0)
  const totalAmount = toImport.reduce((s, v) => s + v.total, 0)
  const dates = inRange.map(v => v.date).filter(Boolean).sort()
  const periodLabel = dates.length ? `${dates[0]} 〜 ${dates[dates.length - 1]}` : "―"

  const canImport = toImport.length > 0 && unmatchedNames.length === 0 && existingKeys !== null && !importing && !!endDate

  async function handleImport() {
    if (!confirm(
      `${toImport.length}件の注文（明細 ${totalItems}件）を記録用として登録します。\n` +
      `合計金額: ${fmtYen(totalAmount)}\n` +
      `対象期間: ${periodLabel}\n` +
      (duplicateCount > 0 ? `\n※既存注文と重複する ${duplicateCount}件はスキップします\n` : "") +
      "\n在庫・粗利計算には反映されません。よろしいですか？"
    )) return

    setImporting(true)
    setResult(null)
    try {
      const CHUNK = 200
      let insertedOrders = 0
      let insertedItems = 0

      for (let i = 0; i < toImport.length; i += CHUNK) {
        const chunk = toImport.slice(i, i + CHUNK)
        setProgress(`注文を登録中… ${i}/${toImport.length}`)

        const orderRows = chunk.map(v => ({
          id: crypto.randomUUID(),
          clinic_id: v.clinicId,
          status: "納品済み",
          source: "admin",
          delivery_number: v.voucherNo,
          total_price: v.total,
          note: `【他システムからの移行】伝票No.${v.voucherNo}（${v.date}）`,
          created_at: `${v.date}T00:00:00`,
          delivered_at: `${v.date}T00:00:00`,
        }))
        const { error: e1 } = await supabase.from("orders").insert(orderRows)
        if (e1) throw new Error(`注文登録に失敗（${i}件目付近）: ${e1.message}`)
        insertedOrders += orderRows.length

        const itemRows: any[] = []
        chunk.forEach((v, vi) => {
          v.items.forEach(it => {
            itemRows.push({
              order_id: orderRows[vi].id,
              product_id: null,
              product_name: it.productName,
              quantity: it.quantity ?? 1,
              price: it.unitPrice ?? it.amount,
            })
          })
        })
        if (itemRows.length > 0) {
          for (let j = 0; j < itemRows.length; j += 500) {
            const { error: e2 } = await supabase.from("order_items").insert(itemRows.slice(j, j + 500))
            if (e2) throw new Error(`明細登録に失敗（${i}件目付近）: ${e2.message}`)
          }
        }
        insertedItems += itemRows.length
      }

      setProgress("")
      setResult({ orders: insertedOrders, items: insertedItems, skippedDuplicate: duplicateCount })
      setExistingKeys(null)
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
          📥 売上履歴CSV取り込み
          <span className="ml-2 text-xs font-normal text-gray-400">他システムの過去実績を記録用の注文履歴として登録（在庫・粗利には反映しません）</span>
        </h1>
        <Link href="/admin/orders" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold text-blue-700 bg-blue-100 hover:bg-blue-200 transition-colors">
          📋 注文一覧
        </Link>
      </div>

      <div className="rounded-lg p-4 space-y-3" style={{ border: "1px solid #e5e7eb", background: "#fff" }}>
        <p className="text-sm text-gray-600">
          「得意先名・伝票日付・伝票№・商品名・金額」などの列を持つCSVに対応しています（列の並び順は自由、余計な列があっても問題ありません）。
          文字化けするCSV（Shift-JIS）も自動判定します。伝票№ごとに1件の注文としてまとめ、既存注文と重複するものは自動でスキップします。
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <label
            htmlFor="csv-upload"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold cursor-pointer bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            📄 CSVファイルを選択
          </label>
          <input
            id="csv-upload" type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = "" }}
          />
          {fileName && <span className="text-sm text-gray-500">{fileName}</span>}
          {loadingMasters && <span className="text-sm text-gray-400">医院マスタを読み込み中…</span>}
        </div>

        {vouchers.length > 0 && (
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              取り込み対象期間の終了日（この日以前の伝票のみ取り込みます）
            </label>
            <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setExistingKeys(null) }}
              className="border rounded px-2 py-1.5 text-sm" />
            <p className="text-xs text-amber-700 mt-1">
              ⚠ 対象の医院がすでにDentHub本体で注文を受けている場合、その最初の注文日より前の日付を指定してください。
              指定しないと取り込みできません。
            </p>
          </div>
        )}

        {parseError && (
          <div className="rounded-lg p-3" style={{ border: "1px solid #fca5a5", background: "#fff1f2" }}>
            <p className="text-sm font-bold text-red-700 whitespace-pre-wrap">⚠ {parseError}</p>
          </div>
        )}
      </div>

      {vouchers.length > 0 && endDate && (
        <>
          {unmatchedNames.length > 0 && (
            <div className="rounded-lg p-4 space-y-3" style={{ border: "1px solid #fca5a5", background: "#fff1f2" }}>
              <h2 className="text-sm font-bold text-red-700">医院名の対応付けが必要です</h2>
              {unmatchedNames.map(name => (
                <div key={name} className="flex items-center gap-2 text-sm">
                  <span className="text-gray-700">「{name}」→</span>
                  <select
                    className="border rounded px-2 py-1 text-sm"
                    value={clinicOverride[name] || ""}
                    onChange={e => { setClinicOverride(prev => ({ ...prev, [name]: e.target.value })); setExistingKeys(null) }}
                  >
                    <option value="">医院を選択…</option>
                    {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}

          {unmatchedNames.length === 0 && existingKeys === null && (
            <div className="rounded-lg p-4" style={{ border: "1px solid #e5e7eb", background: "#fff" }}>
              <button onClick={checkExisting} disabled={checkingExisting}
                className="px-4 py-2 rounded-lg text-sm font-bold bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-50">
                {checkingExisting ? "確認中…" : "既存注文との重複を確認する"}
              </button>
            </div>
          )}

          {existingKeys !== null && (
            <div className="rounded-lg p-4 space-y-3" style={{ border: "1px solid #e5e7eb", background: "#fff" }}>
              <h2 className="text-sm font-bold text-gray-900">取り込み内容</h2>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                <div className="rounded p-2" style={{ background: "#f9fafb" }}><div className="text-gray-500">対象伝票（期間内）</div><div className="font-bold text-gray-900">{inRange.length}件</div></div>
                <div className="rounded p-2" style={{ background: duplicateCount > 0 ? "#fff7ed" : "#f9fafb" }}><div className="text-gray-500">重複でスキップ</div><div className="font-bold" style={{ color: duplicateCount > 0 ? "#c2410c" : "#111827" }}>{duplicateCount}件</div></div>
                <div className="rounded p-2" style={{ background: "#f9fafb" }}><div className="text-gray-500">新規登録される注文</div><div className="font-bold text-gray-900">{toImport.length}件</div></div>
                <div className="rounded p-2" style={{ background: "#f9fafb" }}><div className="text-gray-500">明細件数</div><div className="font-bold text-gray-900">{totalItems}件</div></div>
                <div className="rounded p-2" style={{ background: "#f9fafb" }}><div className="text-gray-500">合計金額</div><div className="font-bold text-gray-900">{fmtYen(totalAmount)}</div></div>
              </div>
              <p className="text-xs text-gray-500">対象期間: {periodLabel}</p>

              <div className="overflow-auto rounded border" style={{ maxHeight: 420 }}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0" style={{ background: "#f9fafb" }}>
                    <tr>
                      <th className="text-left p-2">状態</th>
                      <th className="text-left p-2">伝票日付</th>
                      <th className="text-left p-2">伝票№</th>
                      <th className="text-left p-2">医院</th>
                      <th className="text-right p-2">明細数</th>
                      <th className="text-right p-2">金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withStatus.map(v => (
                      <tr key={`${v.clinicCode}_${v.voucherNo}`} className="border-t">
                        <td className="p-2">
                          {v.isDuplicate ? <span className="text-orange-600">重複(スキップ)</span> : <span className="text-emerald-700">新規</span>}
                        </td>
                        <td className="p-2">{v.date}</td>
                        <td className="p-2">{v.voucherNo}</td>
                        <td className="p-2">{v.clinicName}</td>
                        <td className="p-2 text-right">{v.items.length}</td>
                        <td className="p-2 text-right">{fmtYen(v.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end gap-3">
                {progress && <span className="text-sm text-gray-500">{progress}</span>}
                <button
                  onClick={handleImport}
                  disabled={!canImport}
                  className={"px-4 py-2 rounded-lg text-sm font-bold " + (canImport ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-gray-200 text-gray-400 cursor-not-allowed")}
                >
                  {importing ? "登録中…" : `この内容で記録として登録（${toImport.length}件）`}
                </button>
              </div>
            </div>
          )}

          {result && (
            <div className="rounded-lg p-4" style={{ border: "1px solid #86efac", background: "#f0fdf4" }}>
              <p className="text-sm font-bold text-emerald-700">
                ✅ 注文 {result.orders}件・明細 {result.items}件を登録しました（重複スキップ {result.skippedDuplicate}件）
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
