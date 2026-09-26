"use client"

// 他システムの「商品元帳」CSV（売上明細）を、納品済みの注文として取り込む。
// - 伝票番号ごとに1件の注文（納品日 = 伝票日付）
// - 区分が「売上」の行のみ対象（仕入などは取り込まない）
// - 在庫は「基準日より後の伝票」だけ引く（棚卸し等で在庫数に反映済みの期間の二重減算を防ぐ）。直送分は引かない
// - 取込済みの伝票（納品書No = EXT-伝票番号）は再取り込みしない

import { useMemo, useState } from "react"
import Link from "next/link"
import { supabase, fetchAll } from "@/lib/supabase"
import { fmtYen } from "@/lib/invoice"

type Line = {
  date: string; slip: string; clinicCode: string; clinicName: string
  productCode: string; productName: string; price: number; qty: number; note: string
}
type Product = { id: string; name: string; product_code: string | null; stock: number | null }
type Clinic = { id: string; name: string; clinic_code: string | null }
type Group = {
  key: string; date: string; slip: string; deliveryNumber: string
  clinicCode: string; clinicName: string; clinicId: string | null
  lines: (Line & { productId: string | null; deduct: boolean })[]
  total: number; existing: boolean
}

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
        if (kind !== "売上") { skip[kind || "(空)"] = (skip[kind || "(空)"] || 0) + 1; continue }
        parsed.push({
          date: normDate(c[idx("伝票日付")] || ""), slip: (c[idx("伝票番号")] || "").trim(),
          clinicCode: (c[idx("取引先コード")] || "").trim(), clinicName: (c[idx("取引先名")] || "").trim(),
          productCode: (c[idx("商品コード")] || "").trim(), productName: (c[idx("商品名")] || "").trim(),
          price: toNum(c[idx("単価")]), qty: toNum(c[idx("数量")]),
          note: idx("摘要") >= 0 ? (c[idx("摘要")] || "").trim() : "",
        })
      }
      if (parsed.length === 0) throw new Error("「売上」の行がありません")
      const [p, cl, ex] = await Promise.all([
        fetchAll("products", "id,name,product_code,stock"),
        supabase.from("clinics").select("id,name,clinic_code").limit(50000),
        supabase.from("orders").select("delivery_number").like("delivery_number", "EXT-%").limit(50000),
      ])
      setProducts((p as Product[]) || [])
      setClinics((cl.data as Clinic[]) || [])
      setExistingNumbers(new Set((ex.data || []).map((o: { delivery_number: string }) => o.delivery_number)))
      setSkipped(skip)
      setLines(parsed)
    } catch (e) {
      setError((e as Error).message); setLines([])
    } finally { setLoading(false) }
  }

  const groups: Group[] = useMemo(() => {
    const byCode = new Map(products.filter(p => p.product_code).map(p => [p.product_code as string, p]))
    const clinicByCode = new Map(clinics.filter(c => c.clinic_code).map(c => [c.clinic_code as string, c]))
    const clinicByName = new Map(clinics.map(c => [c.name, c]))
    const m = new Map<string, Group>()
    for (const l of lines) {
      const key = `${l.slip}|${l.clinicCode}`
      let g = m.get(key)
      if (!g) {
        const cl = clinicByCode.get(l.clinicCode) || clinicByName.get(l.clinicName)
        const dn = `EXT-${l.slip}`
        g = { key, date: l.date, slip: l.slip, deliveryNumber: dn, clinicCode: l.clinicCode, clinicName: l.clinicName, clinicId: cl?.id ?? null, lines: [], total: 0, existing: existingNumbers.has(dn) }
        m.set(key, g)
      }
      const prod = byCode.get(l.productCode)
      // 直送分は在庫を通らないため引かない／基準日以前の伝票は在庫数に反映済みとみなして引かない
      const deduct = !!prod && l.date > cutoff && !l.note.includes("直送")
      g.lines.push({ ...l, productId: prod?.id ?? null, deduct })
      g.total += l.price * l.qty
    }
    return Array.from(m.values()).sort((a, b) => a.date.localeCompare(b.date) || a.slip.localeCompare(b.slip))
  }, [lines, products, clinics, existingNumbers, cutoff])

  const importable = groups.filter(g => g.clinicId && !g.existing)

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
    const ex = await supabase.from("orders").select("delivery_number").like("delivery_number", "EXT-%").limit(50000)
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
          <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0" }}>
            <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
              <thead className="bg-gray-100">
                <tr className="text-gray-700 font-bold border-b-2 border-gray-300">
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
                    <tr key={g.key} className={"border-b border-gray-100 align-top " + (g.existing ? "bg-gray-50 text-gray-400" : !g.clinicId ? "bg-red-50" : "")}>
                      <td className="px-2 py-1.5 whitespace-nowrap">{g.date}</td>
                      <td className="px-2 py-1.5 font-mono">{g.slip}</td>
                      <td className="px-2 py-1.5">{g.clinicName}<span className="text-gray-400 ml-1">#{g.clinicCode}</span></td>
                      <td className="px-2 py-1.5">
                        {g.lines.map((l, i) => (
                          <div key={i}>{l.productName} ×{l.qty} @{fmtYen(l.price)}{!l.productId && <span className="ml-1 text-amber-700">（商品マスタ未一致・手入力として登録）</span>}{l.note && <span className="ml-1 text-gray-400">［{l.note}］</span>}</div>
                        ))}
                      </td>
                      <td className="px-2 py-1.5 text-right font-bold">{fmtYen(g.total)}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{dedCount > 0 ? `引く（${dedCount}行）` : "引かない"}{unmatched > 0 ? "" : ""}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {g.existing ? "取込済み" : !g.clinicId ? <span className="text-red-600 font-bold">医院が見つかりません</span> : <span className="text-emerald-700 font-bold">取り込めます</span>}
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
            <span className="text-[11px] text-gray-500">医院が見つからない伝票・取込済みの伝票は取り込まれません</span>
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
