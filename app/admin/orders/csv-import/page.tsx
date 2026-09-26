"use client"

// 他システムの「商品元帳」CSV（売上明細）を、納品済みの注文として取り込む。
// - 伝票番号ごとに1件の注文（納品日 = 伝票日付）
// - 区分が「売上」の行のみ対象（仕入などは取り込まない）
// - 在庫は「基準日より後の伝票」だけ引く（棚卸し等で在庫数に反映済みの期間の二重減算を防ぐ）。直送分は引かない
// - 取込済みの伝票（納品書No = EXT-伝票番号）は再取り込みしない

import { useMemo, useState } from "react"
import Link from "next/link"
import { supabase, fetchAll, fetchAllData } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"

type Line = {
  date: string; slip: string; clinicCode: string; clinicName: string
  productCode: string; productName: string; price: number; qty: number; note: string
  discount: boolean // 区分「値引」の行（金額がマイナスの明細として取り込む）
}
type Product = { id: string; name: string; product_code: string | null; stock: number | null }
type Clinic = { id: string; name: string; clinic_code: string | null }
type Group = {
  key: string; date: string; slip: string; deliveryNumber: string
  clinicCode: string; clinicName: string; clinicId: string | null
  lines: (Line & { productId: string | null; deduct: boolean })[]
  total: number; existing: boolean
  // すでにデントハブへ手入力されている注文と重複していそうか
  dup: { level: "strong" | "weak"; deliveryNumber: string; date: string; total: number } | null
}
type ExistingOrder = {
  id: string; clinic_id: string; date: string; total: number; deliveryNumber: string
  items: { product_id: string | null; name: string; qty: number }[]
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000)

function splitCsvRow(row: string): string[] {
  const cols: string[] = []
  let cur = "", q = false
  for (let i = 0; i < row.length; i++) {
    const c = row[i]
    if (q) {
      if (c === '"') { if (row[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c
    } else if (c === '"') q = true
    else if (c === ",") { cols.push(cur); cur = "" }
    else cur += c
  }
  cols.push(cur)
  return cols
}
const toNum = (s: string | undefined) => { const n = Number(String(s ?? "").replace(/[¥￥,\s"]/g, "")); return isNaN(n) ? 0 : n }
const normDate = (s: string) => { const m = s.trim().match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "" }

export default function OrderCsvImportPage() {
  const [lines, setLines] = useState<Line[]>([])
  const [skipped, setSkipped] = useState<Record<string, number>>({})
  const [products, setProducts] = useState<Product[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [existingNumbers, setExistingNumbers] = useState<Set<string>>(new Set())
  const [existingOrders, setExistingOrders] = useState<ExistingOrder[]>([])
  const [overrides, setOverrides] = useState<Record<string, boolean>>({}) // 伝票ごとの取込ON/OFF（手動切替）
  const [cutoff, setCutoff] = useState("2026-09-22")
  const [fileName, setFileName] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [log, setLog] = useState<string[]>([])

  async function onFile(file: File) {
    setError(""); setLog([]); setLoading(true); setFileName(file.name)
    try {
      const buf = await file.arrayBuffer()
      let text: string
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf) } catch { text = new TextDecoder("shift-jis").decode(buf) }
      const rows = text.replace(/^﻿/, "").split(/\r?\n/).filter(r => r.trim())
      if (rows.length < 2) throw new Error("データ行がありません")
      const hdr = splitCsvRow(rows[0]).map(h => h.trim())
      const idx = (name: string) => hdr.indexOf(name)
      const need = ["伝票日付", "伝票番号", "区分", "取引先コード", "取引先名", "商品コード", "商品名", "単価", "数量"]
      const missing = need.filter(n => idx(n) < 0)
      if (missing.length) throw new Error("商品元帳の形式ではありません。見つからない列: " + missing.join("、"))
      const skip: Record<string, number> = {}
      const parsed: Line[] = []
      for (const r of rows.slice(1)) {
        const c = splitCsvRow(r)
        const kind = (c[idx("区分")] || "").trim()
        if (kind !== "売上" && kind !== "値引") { skip[kind || "(空)"] = (skip[kind || "(空)"] || 0) + 1; continue }
        const discount = kind === "値引"
        // 値引は数量0・単価0で金額だけがマイナスで入っているため、数量1・単価=金額の明細にする
        const amount = idx("金額") >= 0 ? toNum(c[idx("金額")]) : 0
        parsed.push({
          date: normDate(c[idx("伝票日付")] || ""), slip: (c[idx("伝票番号")] || "").trim(),
          clinicCode: (c[idx("取引先コード")] || "").trim(), clinicName: (c[idx("取引先名")] || "").trim(),
          productCode: (c[idx("商品コード")] || "").trim(), productName: (c[idx("商品名")] || "").trim(),
          price: discount ? amount : toNum(c[idx("単価")]), qty: discount ? 1 : toNum(c[idx("数量")]),
          note: idx("摘要") >= 0 ? (c[idx("摘要")] || "").trim() : "",
          discount,
        })
      }
      if (!parsed.some(l => !l.discount)) throw new Error("「売上」の行がありません")
      const [p, cl, ex] = await Promise.all([
        fetchAll("products", "id,name,product_code,stock"),
        supabase.from("clinics").select("id,name,clinic_code").limit(50000),
        fetchAllData("orders", "id,delivery_number", (q: any) => q.like("delivery_number", "EXT-%")),
      ])
      setProducts((p as Product[]) || [])
      setClinics((cl.data as Clinic[]) || [])
      setExistingNumbers(new Set((ex.data || []).map((o: { delivery_number: string }) => o.delivery_number)))
      // 手入力済みの注文との重複判定用に、CSVの最古日の前日以降の注文（取込分EXT-を除く）を取得
      const minDate = parsed.map(l => l.date).filter(Boolean).sort()[0]
      if (minDate) {
        const since = new Date(`${minDate}T00:00:00+09:00`); since.setDate(since.getDate() - 1)
        const { data: eo } = await supabase.from("orders")
          .select("id,clinic_id,status,created_at,delivered_at,total_price,delivery_number")
          .gte("created_at", since.toISOString()).limit(50000)
        const eos = (eo || []).filter((o: { delivery_number: string | null; status: string }) =>
          !String(o.delivery_number || "").startsWith("EXT-") && !["キャンセル", "取消"].includes(o.status))
        const itemsByOrder = new Map<string, ExistingOrder["items"]>()
        for (let i = 0; i < eos.length; i += 200) {
          const ids = eos.slice(i, i + 200).map((o: { id: string }) => o.id)
          const { data: its } = await supabase.from("order_items").select("order_id,product_id,product_name,quantity").in("order_id", ids)
          for (const it of its || []) {
            if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, [])
            itemsByOrder.get(it.order_id)!.push({ product_id: it.product_id, name: it.product_name || "", qty: Number(it.quantity || 0) })
          }
        }
        setExistingOrders(eos.map((o: { id: string; clinic_id: string; created_at: string; delivered_at: string | null; total_price: number; delivery_number: string | null }) => ({
          id: o.id, clinic_id: o.clinic_id, date: (o.delivered_at || o.created_at).slice(0, 10),
          total: Number(o.total_price || 0), deliveryNumber: o.delivery_number || o.id.slice(0, 8), items: itemsByOrder.get(o.id) || [],
        })))
      }
      setOverrides({})
      setSkipped(skip)
      setLines(parsed)
    } catch (e) {
      setError((e as Error).message); setLines([])
    } finally { setLoading(false) }
  }

  const groups: Group[] = useMemo(() => {
    // 商品コードで照合。Excelで開いて保存されたCSVは JAN が「4.90184E+12」のように壊れるため、
    // その場合（および未一致の場合）は商品名（全角半角・大小・空白を無視）で照合する
    const normName = (s: string) => String(s || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "")
    const byCode = new Map(products.filter(p => p.product_code).map(p => [p.product_code as string, p]))
    const byNameKey = new Map(products.map(p => [normName(p.name), p]))
    const clinicByCode = new Map(clinics.filter(c => c.clinic_code).map(c => [c.clinic_code as string, c]))
    const clinicByName = new Map(clinics.map(c => [c.name, c]))
    const m = new Map<string, Group>()
    for (const l of lines) {
      const key = `${l.slip}|${l.clinicCode}`
      let g = m.get(key)
      if (!g) {
        const cl = clinicByCode.get(l.clinicCode) || clinicByName.get(l.clinicName)
        const dn = `EXT-${l.slip}`
        g = { key, date: l.date, slip: l.slip, deliveryNumber: dn, clinicCode: l.clinicCode, clinicName: l.clinicName, clinicId: cl?.id ?? null, lines: [], total: 0, existing: existingNumbers.has(dn), dup: null }
        m.set(key, g)
      }
      const codeBroken = /e\+/i.test(l.productCode)
      const prod = l.discount ? undefined : ((!codeBroken ? byCode.get(l.productCode) : undefined) ?? byNameKey.get(normName(l.productName)))
      // 直送分は在庫を通らないため引かない／基準日以前の伝票は在庫数に反映済みとみなして引かない（値引は在庫と無関係）
      const deduct = !!prod && l.date > cutoff && !l.note.includes("直送")
      g.lines.push({ ...l, productId: prod?.id ?? null, deduct })
      g.total += l.price * l.qty
    }
    // 値引の行しかない伝票（売上明細が今回のCSVに無い）は取り込まない
    const result = Array.from(m.values()).filter(g => g.lines.some(l => !l.discount)).sort((a, b) => a.date.localeCompare(b.date) || a.slip.localeCompare(b.slip))
    // 手入力済みの注文との重複判定: 同じ医院で、納品日が近く（CSV日の前日〜7日後）、
    // 金額または明細が一致すれば「重複の可能性が高い」、明細の一部だけ一致すれば「似た注文あり」
    for (const g of result) {
      if (!g.clinicId || g.existing) continue
      let best: Group["dup"] = null
      for (const o of existingOrders) {
        if (o.clinic_id !== g.clinicId) continue
        const d = dayDiff(o.date, g.date)
        if (d < -1 || d > 7) continue
        const matched = g.lines.filter(l => o.items.some(x => (l.productId ? x.product_id === l.productId : x.name === l.productName) && x.qty === l.qty)).length
        const strong = o.total === g.total || (matched === g.lines.length && g.lines.length > 0)
        const level = strong ? "strong" : matched > 0 ? "weak" : null
        if (!level) continue
        if (!best || (level === "strong" && best.level === "weak")) best = { level, deliveryNumber: o.deliveryNumber, date: o.date, total: o.total }
      }
      g.dup = best
    }
    // 手入力側が複数の伝票を1件にまとめて登録している場合: 同じ既存注文に紐づく伝票の合計金額が
    // 既存注文の金額と一致するなら、それらすべてを「重複の可能性が高い」とみなす
    const byOrder = new Map<string, Group[]>()
    for (const g of result) if (g.dup) { const arr = byOrder.get(g.dup.deliveryNumber) || []; arr.push(g); byOrder.set(g.dup.deliveryNumber, arr) }
    for (const [dn, gs] of byOrder) {
      const ex = existingOrders.find(o => o.deliveryNumber === dn)
      if (ex && gs.length > 1 && gs.reduce((s, g) => s + g.total, 0) === ex.total) gs.forEach(g => { if (g.dup) g.dup = { ...g.dup, level: "strong" } })
    }
    return result
  }, [lines, products, clinics, existingNumbers, existingOrders, cutoff])

  // 取り込むかどうか: 手動切替があればそれを優先、無ければ「取込済みでない・医院が分かる・重複の可能性が高くない」を初期値にする
  // 今日より先の日付の伝票は納品前（予定）の可能性が高いため、初期状態では取り込まない
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const isFuture = (g: Group) => g.date > today
  const isOn = (g: Group) => overrides[g.key] ?? (!!g.clinicId && !g.existing && g.dup?.level !== "strong" && !isFuture(g))
  const importable = groups.filter(g => g.clinicId && !g.existing && isOn(g))
  // 値引の行だけで売上明細がCSVに無い伝票（除外した伝票）
  const droppedDiscountSlips = useMemo(() => {
    const withSales = new Set(lines.filter(l => !l.discount).map(l => `${l.slip}|${l.clinicCode}`))
    return Array.from(new Set(lines.filter(l => l.discount && !withSales.has(`${l.slip}|${l.clinicCode}`)).map(l => `${l.slip}（${l.clinicName}）`)))
  }, [lines])

  async function runImport() {
    if (importable.length === 0) return
    if (!confirm(`${importable.length}件の伝票を納品済みの注文として登録します。よろしいですか？`)) return
    setImporting(true); setLog([])
    const out: string[] = []
    for (const g of importable) {
      try {
        const iso = new Date(`${g.date}T12:00:00+09:00`).toISOString()
        const { data: order, error: oe } = await supabase.from("orders").insert({
          clinic_id: g.clinicId, status: "納品済み", total_price: g.total, delivery_number: g.deliveryNumber,
          delivered_at: iso, created_at: iso, source: "admin", note: `売上CSV取込（商品元帳 伝票${g.slip}）`,
        }).select().single()
        if (oe || !order) throw new Error(oe?.message || "注文作成失敗")
        const { data: items, error: ie } = await supabase.from("order_items").insert(
          g.lines.map(l => ({ order_id: order.id, product_id: l.productId, product_name: l.productName, quantity: l.qty, price: l.price }))
        ).select("id,product_id,quantity")
        if (ie) throw new Error("明細: " + ie.message)
        // 在庫を引く行のみ出庫処理（同一商品が複数行でも都度最新在庫を読む）
        let deducted = 0
        for (let i = 0; i < g.lines.length; i++) {
          const l = g.lines[i]
          if (!l.deduct || !l.productId) continue
          const { data: p } = await supabase.from("products").select("stock").eq("id", l.productId).single()
          const before = Number(p?.stock || 0), after = before - l.qty
          await supabase.from("products").update({ stock: after }).eq("id", l.productId)
          try {
            await supabase.from("stock_movements").insert({
              product_id: l.productId, movement_type: "出庫", quantity: -l.qty, before_stock: before, after_stock: after,
              ref_type: "order_item", ref_id: items?.[i]?.id ?? null, reason: g.deliveryNumber,
            })
          } catch { /* 履歴テーブルが無い環境ではスキップ */ }
          deducted++
        }
        out.push(`✓ ${g.date} ${g.clinicName} 伝票${g.slip}（${g.lines.length}品／${fmtYen(g.total)}／在庫を引いた行 ${deducted}）`)
      } catch (e) {
        out.push(`✗ 伝票${g.slip} ${g.clinicName}: ${(e as Error).message}`)
      }
      setLog([...out])
    }
    setImporting(false)
    // 取込済みの再判定
    const ex = await fetchAllData("orders", "id,delivery_number", (q: any) => q.like("delivery_number", "EXT-%"))
    setExistingNumbers(new Set((ex.data || []).map((o: { delivery_number: string }) => o.delivery_number)))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827" }}>
          📥 売上CSV取り込み（商品元帳）
          <span className="ml-2 text-xs font-normal text-gray-400">他システムの売上を納品済みの注文として登録</span>
        </h1>
        <Link href="/admin/deliveries" className="text-xs text-gray-500 underline">← 納品書一覧</Link>
      </div>

      <div className="bg-white rounded-lg p-3 space-y-2" style={{ border: "1px solid #e8eaed" }}>
        <div>
          <label className="block text-[11px] text-gray-700 font-bold mb-1">① 商品元帳のCSVファイル</label>
          <input type="file" accept=".csv,text/csv" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = "" }} className="text-xs" />
          {fileName && <span className="ml-2 text-xs text-gray-500">{fileName}</span>}
        </div>
        <div>
          <label className="block text-[11px] text-gray-700 font-bold mb-1">② 在庫を引く基準日（在庫数を入力した日）</label>
          <input type="date" value={cutoff} onChange={e => setCutoff(e.target.value)} className="px-2 py-1 border border-gray-200 rounded text-sm bg-white" />
          <p className="text-[11px] text-gray-500 mt-1">
            この日<strong>より後</strong>の伝票だけ在庫を引きます。基準日以前の売りは在庫数に反映済みのため引きません（二重減算防止）。「直送分」は常に引きません。
          </p>
        </div>
      </div>

      {loading && <p className="text-xs text-gray-400">読み込み中…</p>}
      {error && <div className="text-xs px-3 py-2 rounded bg-red-50 text-red-700" style={{ border: "1px solid #fcc" }}>{error}</div>}

      {groups.length > 0 && (
        <>
          <div className="text-xs text-gray-600">
            売上 {lines.length}行 → 伝票 {groups.length}件
            {Object.keys(skipped).length > 0 && (
              <span className="ml-2 text-amber-700">（取り込まない行: {Object.entries(skipped).map(([k, v]) => `${k} ${v}行`).join("、")}）</span>
            )}
          </div>
          {droppedDiscountSlips.length > 0 && (
            <div className="text-xs px-3 py-2 rounded bg-amber-50 text-amber-800" style={{ border: "1px solid #fde68a" }}>
              値引だけで売上明細がCSVに無い伝票は取り込みません（売上明細を含めて出力し直してください）: {droppedDiscountSlips.join("、")}
            </div>
          )}
          <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0" }}>
            <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
              <thead className="bg-gray-100">
                <tr className="text-gray-700 font-bold border-b-2 border-gray-300">
                  <th className="px-2 py-1.5 text-center">取込</th>
                  <th className="px-2 py-1.5 text-left">納品日</th>
                  <th className="px-2 py-1.5 text-left">伝票No</th>
                  <th className="px-2 py-1.5 text-left">医院</th>
                  <th className="px-2 py-1.5 text-left">明細</th>
                  <th className="px-2 py-1.5 text-right">金額</th>
                  <th className="px-2 py-1.5 text-left">在庫</th>
                  <th className="px-2 py-1.5 text-left">状態</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => {
                  const dedCount = g.lines.filter(l => l.deduct).length
                  const unmatched = g.lines.filter(l => !l.productId).length
                  return (
                    <tr key={g.key} className={"border-b border-gray-100 align-top " + (g.existing ? "bg-gray-50 text-gray-400" : !g.clinicId ? "bg-red-50" : g.dup?.level === "strong" ? "bg-amber-50" : "")}>
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={!g.existing && !!g.clinicId && isOn(g)} disabled={g.existing || !g.clinicId}
                          onChange={e => setOverrides(prev => ({ ...prev, [g.key]: e.target.checked }))} />
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{g.date}</td>
                      <td className="px-2 py-1.5 font-mono">{g.slip}</td>
                      <td className="px-2 py-1.5">{g.clinicName}<span className="text-gray-400 ml-1">#{g.clinicCode}</span></td>
                      <td className="px-2 py-1.5">
                        {g.lines.map((l, i) => (
                          <div key={i}>{l.productName} ×{l.qty} @{fmtYen(l.price)}{!l.productId && !l.discount && <span className="ml-1 text-amber-700">（商品マスタ未一致・手入力として登録）</span>}{l.note && <span className="ml-1 text-gray-400">［{l.note}］</span>}</div>
                        ))}
                      </td>
                      <td className="px-2 py-1.5 text-right font-bold">{fmtYen(g.total)}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{dedCount > 0 ? `引く（${dedCount}行）` : "引かない"}{unmatched > 0 ? "" : ""}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {g.existing ? "取込済み" : !g.clinicId ? <span className="text-red-600 font-bold">医院が見つかりません</span> : (
                          <>
                            {isFuture(g) && <div className="text-blue-700 font-bold">今日より先の日付（納品予定？）<div className="font-normal text-[11px]">納品済みにする場合のみチェック</div></div>}
                            {g.dup?.level === "strong" && <div className="text-amber-700 font-bold">手入力済みの可能性が高い<div className="font-normal text-[11px]">{g.dup.deliveryNumber}／{g.dup.date}／{fmtYen(g.dup.total)}</div></div>}
                            {g.dup?.level === "weak" && <div className="text-amber-700">似た注文あり（要確認）<div className="text-[11px]">{g.dup.deliveryNumber}／{g.dup.date}／{fmtYen(g.dup.total)}</div></div>}
                            {!g.dup && !isFuture(g) && <span className="text-emerald-700 font-bold">取り込めます</span>}
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={runImport} disabled={importing || importable.length === 0}
              className="px-5 py-2 text-sm font-bold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:bg-gray-300">
              {importing ? "取り込み中…" : `✓ ${importable.length}件の伝票を取り込む`}
            </button>
            <span className="text-[11px] text-gray-500">チェックの入った伝票だけ取り込みます。「手入力済みの可能性が高い」伝票は初期状態でチェックを外してあります（内容を見て切り替えできます）</span>
          </div>
        </>
      )}

      {log.length > 0 && (
        <div className="bg-white rounded-lg p-3 space-y-1 text-[12px]" style={{ border: "1px solid #e8eaed" }}>
          {log.map((l, i) => <div key={i} className={l.startsWith("✓") ? "text-emerald-700" : "text-red-700"}>{l}</div>)}
        </div>
      )}
    </div>
  )
}
