"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { fmtYen, fmtDate, calcTax } from "@/lib/invoice"
import { QUOTE_STATUSES, generateQuoteNumber, defaultExpiryDate, type QuoteStatus } from "@/lib/quote"
import { useRouter } from "next/navigation"
import { GroupViewTabs, useGroupView, type GroupableRow } from "@/app/components/GroupViewTabs"
import Link from "next/link"

type Quote = {
  id: string
  clinic_id: string | null
  title: string | null
  quote_number: string
  issue_date: string
  expiry_date: string | null
  subtotal: number
  tax: number
  total: number
  status: QuoteStatus
  notes: string | null
  invoice_id: string | null
  created_at: string
}
type Clinic = { id: string; name: string }
type QuoteItem = { id: string; quote_id: string; product_name: string | null; quantity: number; price: number }

export default function QuotesPage() {
  const router = useRouter()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [items, setItems] = useState<QuoteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | QuoteStatus | "active">("all")
  const [clinicFilter, setClinicFilter] = useState("all")
  const [groupView, setGroupView] = useGroupView()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [merging, setMerging] = useState(false)

  useEffect(() => { fetchData() }, [])

  async function deleteQuote(quoteId: string, quoteNumber: string, status: QuoteStatus) {
    const msg = status === "converted"
      ? `⚠️ 「売上化済み」の見積書 ${quoteNumber} を削除します。\n\n請求書とのリンクも切れる可能性があります。\n\n本当によろしいですか？`
      : `見積書 ${quoteNumber} を削除します。\n明細も一緒に削除されます。\nよろしいですか？`
    if (!confirm(msg)) return
    setDeletingId(quoteId)
    try {
      await supabase.from("quote_items").delete().eq("quote_id", quoteId)
      const { error } = await supabase.from("quotes").delete().eq("id", quoteId)
      if (error) { alert("削除失敗: " + error.message); return }
      await fetchData({ silent: true })
    } finally {
      setDeletingId(null)
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function clearSelection() { setSelectedIds(new Set()) }

  // 選択した複数の見積書を1つにまとめる（同じ医院のものだけ）。
  // 発行日が一番早い見積書を残し、他の明細をそちらへ移動、金額を合算して
  // 残りの見積書は削除する。
  async function mergeQuotes() {
    const targets = quotes.filter(q => selectedIds.has(q.id))
    if (targets.length < 2) { alert("2件以上選択してください"); return }

    const clinicIds = new Set(targets.map(q => q.clinic_id))
    if (clinicIds.size > 1) { alert("異なる医院の見積書は統合できません。同じ医院の見積書だけを選択してください。"); return }

    const converted = targets.filter(q => q.status === "converted")
    if (converted.length > 0) {
      alert(`「売上化済み」の見積書（${converted.map(q => q.quote_number).join("、")}）が含まれているため統合できません。`)
      return
    }

    const sorted = [...targets].sort((a, b) => (a.issue_date || "").localeCompare(b.issue_date || ""))
    const keep = sorted[0]
    const others = sorted.slice(1)

    if (!confirm(
      `${targets.length}件の見積書を統合します。\n\n` +
      `残す見積書: ${keep.quote_number}（${fmtDate(keep.issue_date)}）\n` +
      `統合して削除: ${others.map(q => q.quote_number).join("、")}\n\n` +
      `明細はすべて ${keep.quote_number} にまとめられます。よろしいですか？`
    )) return

    setMerging(true)
    try {
      // 統合元の明細を残す見積書へ付け替え（sort_order が重複しないよう振り直す）
      const keepItems = items.filter(it => it.quote_id === keep.id)
      let nextSortOrder = keepItems.length
      for (const q of others) {
        const { data: qItems } = await supabase.from("quote_items").select("id").eq("quote_id", q.id).order("sort_order")
        for (const it of qItems || []) {
          await supabase.from("quote_items").update({ quote_id: keep.id, sort_order: nextSortOrder }).eq("id", it.id)
          nextSortOrder++
        }
      }

      // 金額を合算し直す
      const mergedSubtotal = targets.reduce((s, q) => s + Number(q.subtotal || 0), 0)
      const mergedTax = calcTax(mergedSubtotal)
      const mergedNote = [keep.notes, `（${others.map(q => q.quote_number).join("、")} を統合）`].filter(Boolean).join(" ")
      await supabase.from("quotes").update({
        subtotal: mergedSubtotal,
        tax: mergedTax,
        total: mergedSubtotal + mergedTax,
        notes: mergedNote,
      }).eq("id", keep.id)

      // 統合元の見積書を削除（明細は既に移動済み）
      await supabase.from("quotes").delete().in("id", others.map(q => q.id))

      clearSelection()
      await fetchData({ silent: true })
      alert(`✅ ${keep.quote_number} に統合しました。`)
      router.push(`/admin/quotes/${keep.id}`)
    } catch (e) {
      alert("統合に失敗しました: " + (e as Error).message)
    } finally {
      setMerging(false)
    }
  }

  // ── 他ツールの見積データをインポート ──────────────────────
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState("")
  const [importHasHeader, setImportHasHeader] = useState(true)
  const [importClinicId, setImportClinicId] = useState("")
  const [importIssueDate, setImportIssueDate] = useState("")
  const [importExpiryDate, setImportExpiryDate] = useState("")
  const [importTargetMode, setImportTargetMode] = useState<"new" | "replace">("new")
  const [importTargetQuoteId, setImportTargetQuoteId] = useState("")
  const [importNotes, setImportNotes] = useState("")
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState("")

  type ImportLine = { productName: string; quantity: number; price: number; listPrice: number | null; cost: number | null }
  type ImportMeta = { clinicNameGuess: string | null; issueDateGuess: string | null; notesGuess: string | null }
  // "a,\"b, c\",d" のようなダブルクォート囲みのCSVセルにも対応した簡易パーサ
  function splitCsvRow(row: string): string[] {
    const cols: string[] = []
    let cur = ""
    let inQuotes = false
    for (let i = 0; i < row.length; i++) {
      const c = row[i]
      if (inQuotes) {
        if (c === '"') {
          if (row[i + 1] === '"') { cur += '"'; i++ }
          else inQuotes = false
        } else cur += c
      } else {
        if (c === '"') inQuotes = true
        else if (c === ",") { cols.push(cur); cur = "" }
        else cur += c
      }
    }
    cols.push(cur)
    return cols
  }

  // 他ツール（見積システム等）が出力するCSVは列名・列順がまちまちなため、
  // ヘッダー行の列名からできるだけ自動でマッピングする。
  // 見つからない場合は「商品名,数量,単価,定価」という単純な並びとして扱う（従来互換）。
  const HEADER_ALIASES: Record<string, string[]> = {
    productName: ["商品名", "品名"],
    quantity: ["売上数量", "数量", "個数"],
    price: ["売価", "単価", "販売単価", "販売価格"],
    listPrice: ["定価"],
    cost: ["仕入単価", "仕入価格", "原価"],
    clinicName: ["得意先名", "医院名", "取引先名"],
    issueDate: ["作成年月日", "発行日", "見積日", "作成日"],
    notes: ["表題名", "件名", "備考", "摘要"],
  }
  function normHeader(s: string) { return s.trim().replace(/^"|"$/g, "") }
  function findColIndex(headers: string[], aliases: string[]): number {
    return headers.findIndex(h => aliases.some(a => normHeader(h) === a))
  }
  // "2026/07/15" 等 → "2026-07-15"
  function normDate(s: string): string | null {
    const t = s.trim().replace(/^"|"$/g, "")
    const m = t.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
    if (!m) return null
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
  }

  function parseImportSource(text: string, hasHeader: boolean): { lines: ImportLine[]; meta: ImportMeta } {
    const rows = text.split(/\r?\n/).map(r => r.trim()).filter(r => r.length > 0)
    if (rows.length === 0) return { lines: [], meta: { clinicNameGuess: null, issueDateGuess: null, notesGuess: null } }
    const splitRow = (row: string) => row.includes("\t") ? row.split("\t") : splitCsvRow(row)
    const toNum = (s: string | undefined) => {
      if (!s) return 0
      const n = Number(String(s).replace(/[¥￥,\s"]/g, ""))
      return isNaN(n) ? 0 : n
    }

    let idx = { productName: 0, quantity: 1, price: 2, listPrice: -1, cost: -1, clinicName: -1, issueDate: -1, notes: -1 }
    let body = rows
    if (hasHeader && rows.length > 0) {
      const headers = splitRow(rows[0]).map(normHeader)
      const found = {
        productName: findColIndex(headers, HEADER_ALIASES.productName),
        quantity: findColIndex(headers, HEADER_ALIASES.quantity),
        price: findColIndex(headers, HEADER_ALIASES.price),
        listPrice: findColIndex(headers, HEADER_ALIASES.listPrice),
        cost: findColIndex(headers, HEADER_ALIASES.cost),
        clinicName: findColIndex(headers, HEADER_ALIASES.clinicName),
        issueDate: findColIndex(headers, HEADER_ALIASES.issueDate),
        notes: findColIndex(headers, HEADER_ALIASES.notes),
      }
      // 商品名・数量・単価の列名が見つかった場合だけ「名前でマッピング」を採用。
      // 見つからなければ従来通りの「1列目=商品名,2列目=数量,3列目=単価,4列目=定価」に留める。
      if (found.productName >= 0 && found.quantity >= 0 && found.price >= 0) {
        idx = { ...idx, ...found }
      } else {
        idx.listPrice = 3
      }
      body = rows.slice(1)
    } else {
      idx.listPrice = 3
    }

    const lines: ImportLine[] = body.map(row => {
      const cols = splitRow(row)
      return {
        productName: (cols[idx.productName] || "").trim().replace(/^"|"$/g, ""),
        quantity: toNum(cols[idx.quantity]) || 1,
        price: toNum(cols[idx.price]),
        listPrice: idx.listPrice >= 0 && cols[idx.listPrice] !== undefined ? toNum(cols[idx.listPrice]) : null,
        cost: idx.cost >= 0 && cols[idx.cost] !== undefined ? toNum(cols[idx.cost]) : null,
      }
    }).filter(l => l.productName)

    const firstRow = body[0] ? splitRow(body[0]) : []
    const meta: ImportMeta = {
      clinicNameGuess: idx.clinicName >= 0 ? (firstRow[idx.clinicName] || "").trim().replace(/^"|"$/g, "") || null : null,
      issueDateGuess: idx.issueDate >= 0 ? normDate(firstRow[idx.issueDate] || "") : null,
      notesGuess: idx.notes >= 0 ? (firstRow[idx.notes] || "").trim().replace(/^"|"$/g, "") || null : null,
    }
    return { lines, meta }
  }

  const importParsed = useMemo(() => parseImportSource(importText, importHasHeader), [importText, importHasHeader])
  const importPreview = importParsed.lines
  const importMeta = importParsed.meta

  // CSVから医院名・発行日・件名を読み取れたら、入力欄が未編集ならそのまま反映する
  useEffect(() => {
    if (!importMeta.clinicNameGuess && !importMeta.issueDateGuess && !importMeta.notesGuess) return
    if (importMeta.clinicNameGuess && !importClinicId) {
      const norm = (v: string) => String(v || "").toLowerCase().normalize("NFKC").replace(/\s/g, "")
      const key = norm(importMeta.clinicNameGuess)
      const match = clinics.find(c => norm(c.name) === key) || clinics.find(c => norm(c.name).includes(key) || key.includes(norm(c.name)))
      if (match) setImportClinicId(match.id)
    }
    if (importMeta.issueDateGuess) setImportIssueDate(importMeta.issueDateGuess)
    if (importMeta.notesGuess) setImportNotes(importMeta.notesGuess)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importMeta.clinicNameGuess, importMeta.issueDateGuess, importMeta.notesGuess])

  function openImport() {
    setImportText("")
    setImportClinicId("")
    setImportIssueDate(new Date().toISOString().slice(0, 10))
    setImportExpiryDate(defaultExpiryDate(new Date()))
    setImportTargetMode("new")
    setImportTargetQuoteId("")
    setImportNotes("他ツールからインポート")
    setImportError("")
    setShowImport(true)
  }

  async function runImport() {
    setImportError("")
    if (importTargetMode === "new" && !importClinicId) { setImportError("医院を選択してください"); return }
    if (importTargetMode === "replace" && !importTargetQuoteId) { setImportError("置き換え先の見積書を選択してください"); return }
    if (importPreview.length === 0) { setImportError("有効な明細行がありません（貼り付け内容をご確認ください）"); return }

    const subtotal = importPreview.reduce((s, l) => s + l.price * l.quantity, 0)
    const tax = calcTax(subtotal)
    const total = subtotal + tax

    setImporting(true)
    try {
      let targetQuoteId: string
      if (importTargetMode === "replace") {
        targetQuoteId = importTargetQuoteId
        const target = quotes.find(q => q.id === targetQuoteId)
        const { error: e1 } = await supabase.from("quotes").update({
          clinic_id: importClinicId || target?.clinic_id || null,
          issue_date: importIssueDate || target?.issue_date,
          expiry_date: importExpiryDate || target?.expiry_date || null,
          subtotal, tax, total,
          notes: importNotes || null,
        }).eq("id", targetQuoteId)
        if (e1) throw new Error("見積更新失敗: " + e1.message)
        const { error: eDel } = await supabase.from("quote_items").delete().eq("quote_id", targetQuoteId)
        if (eDel) throw new Error("既存明細の削除失敗: " + eDel.message)
      } else {
        const quote_number = await generateQuoteNumber(new Date(importIssueDate))
        const { data: q, error: e1 } = await supabase.from("quotes").insert({
          clinic_id: importClinicId,
          quote_number,
          issue_date: importIssueDate,
          expiry_date: importExpiryDate || null,
          subtotal, tax, total,
          status: "draft",
          notes: importNotes || null,
        }).select().single()
        if (e1 || !q) throw new Error(e1?.message || "見積書作成失敗")
        targetQuoteId = q.id
      }

      const itemsPayload = importPreview.map((l, i) => ({
        quote_id: targetQuoteId,
        product_id: null,
        product_name: l.productName,
        quantity: l.quantity,
        price: l.price,
        list_price: l.listPrice,
        cost: l.cost,
        sort_order: i,
      }))
      const { error: e2 } = await supabase.from("quote_items").insert(itemsPayload)
      if (e2) throw new Error("明細保存失敗: " + e2.message)

      setShowImport(false)
      router.push(`/admin/quotes/${targetQuoteId}`)
    } catch (e) {
      setImportError((e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  async function fetchData(opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoading(true)
    const [q, c] = await Promise.all([
      supabase.from("quotes").select("*").order("issue_date", { ascending: false }).limit(50000),
      supabase.from("clinics").select("id,name").order("name").limit(50000),
    ])
    setQuotes((q.data as Quote[]) || [])
    setClinics(c.data || [])
    // 商品別集計用に明細取得（テーブル無ければスキップ）
    try {
      const { data: its } = await supabase.from("quote_items").select("id,quote_id,product_name,quantity,price").limit(50000)
      setItems((its as QuoteItem[]) || [])
    } catch { setItems([]) }
    if (!opts?.silent) setLoading(false)
  }

  const clinicById = useMemo(() => new Map(clinics.map(c => [c.id, c])), [clinics])
  const clinicName = (id: string | null) => id ? (clinicById.get(id)?.name || "(削除済み)") : "—"

  const norm = (v: string) => String(v || "").toLowerCase().normalize("NFKC")
  const filtered = useMemo(() => {
    const k = norm(search)
    return quotes.filter((q) => {
      // active = draft / sent / accepted（売上化前）
      if (statusFilter === "active" && (q.status === "converted" || q.status === "rejected" || q.status === "cancelled")) return false
      if (statusFilter !== "all" && statusFilter !== "active" && q.status !== statusFilter) return false
      if (clinicFilter !== "all" && q.clinic_id !== clinicFilter) return false
      if (!k) return true
      const target = norm(`${q.quote_number} ${q.title || ""} ${clinicName(q.clinic_id)}`)
      return target.includes(k)
    })
  }, [quotes, search, statusFilter, clinicFilter])

  const counts = useMemo(() => ({
    active: quotes.filter(q => !["converted", "rejected", "cancelled"].includes(q.status)).length,
    converted: quotes.filter(q => q.status === "converted").length,
    total: quotes.length,
  }), [quotes])

  // GroupViewTabs 用の行データ
  const itemsByQuote = useMemo(() => {
    const m = new Map<string, QuoteItem[]>()
    items.forEach(it => {
      if (!m.has(it.quote_id)) m.set(it.quote_id, [])
      m.get(it.quote_id)!.push(it)
    })
    return m
  }, [items])

  const groupRows: GroupableRow[] = useMemo(() => filtered.map(q => ({
    id: q.id,
    date: (q.issue_date || "").slice(0, 10),
    party: clinicName(q.clinic_id),
    amount: Number(q.total || 0),
    items: (itemsByQuote.get(q.id) || []).map(it => ({
      name: it.product_name || "(不明)",
      quantity: Number(it.quantity || 0),
      price: Number(it.price || 0),
    })),
  })), [filtered, clinics, itemsByQuote])

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  return (
    <div className="space-y-2">
      {/* 注文 / 見積 サブタブ */}
      <div className="flex items-center gap-1 border-b border-gray-200 mb-2">
        <Link href="/admin/orders" className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-t">
          🛒 注文
        </Link>
        <div className="px-4 py-2 text-sm font-bold text-gray-900 border-b-2 border-emerald-500 -mb-px">
          📋 見積
        </div>
      </div>

      {/* ヘッダ + アクションボタン */}
      <div className="flex items-center flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900" style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: 0 }}>
          見積書管理
          <span className="ml-2 text-xs font-normal text-gray-400">
            該当 {filtered.length}/全{quotes.length} ・ 進行中 {counts.active} ・ 売上化済 {counts.converted}
          </span>
        </h1>
        <Link href="/admin/quotes/create" className="px-3 py-2 bg-emerald-600 text-white text-sm font-bold rounded hover:bg-emerald-700">
          ＋ 見積書を作成
        </Link>
        <button onClick={openImport} className="px-3 py-2 bg-white border border-gray-200 text-sm font-bold rounded hover:bg-gray-50">
          📥 他ツールからインポート
        </button>
      </div>

      {/* フィルタ */}
      <div className="flex gap-1.5 items-center bg-gray-50 p-2 rounded-lg flex-wrap" style={{ border: "1px solid #e8eaed" }}>
        <input lang="ja"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="見積書番号・医院で検索"
          className="flex-1 min-w-[180px] px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white"
        />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
          <option value="active">進行中のみ ({counts.active})</option>
          <option value="converted">売上化済のみ ({counts.converted})</option>
          <option value="all">すべて ({counts.total})</option>
          <optgroup label="細かいステータス">
            {Object.entries(QUOTE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </optgroup>
        </select>
        <select value={clinicFilter} onChange={(e) => setClinicFilter(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded text-sm bg-white max-w-[200px]">
          <option value="all">全医院</option>
          {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* 一括操作バー */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
          <span className="text-[12px] text-indigo-900 font-bold">{selectedIds.size}件選択中</span>
          <button
            onClick={mergeQuotes}
            disabled={merging || selectedIds.size < 2}
            className="text-[12px] px-3 py-1.5 bg-indigo-600 text-white font-bold rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            {merging ? "統合中…" : "🔗 選択した見積書を1つに統合する"}
          </button>
          <button onClick={clearSelection} className="text-[12px] text-gray-500 underline">選択解除</button>
        </div>
      )}

      {/* テーブル */}
      <GroupViewTabs value={groupView} onChange={setGroupView} rows={groupRows} partyLabel="医院">
      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0", maxHeight: "calc(100vh - 280px)" }}>
        <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
          <thead className="sticky top-0 bg-gray-100">
            <tr className="text-[12px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-2 py-1.5 text-center w-8"></th>
              <th className="px-2 py-1.5 text-left w-32">見積書No</th>
              <th className="px-2 py-1.5 text-center w-24">状態</th>
              <th className="px-2 py-1.5 text-left">医院</th>
              <th className="px-2 py-1.5 text-center w-24">発行日</th>
              <th className="px-2 py-1.5 text-center w-24">期限</th>
              <th className="px-2 py-1.5 text-right w-28">金額(税込)</th>
              <th className="px-2 py-1.5 text-center w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">該当見積書なし</td></tr>
            ) : filtered.map((q, i) => {
              const sc = QUOTE_STATUSES[q.status]
              return (
                <tr key={q.id} className={"border-b border-gray-100 hover:bg-blue-50/40 " + (i % 2 === 0 ? "" : "bg-gray-50/30") + (selectedIds.has(q.id) ? " bg-indigo-50/60" : "")}>
                  <td className="px-2 py-1.5 text-center">
                    <input type="checkbox" checked={selectedIds.has(q.id)} onChange={() => toggleSelect(q.id)} className="cursor-pointer" />
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="font-mono text-[12px] text-gray-700">{q.quote_number}</div>
                    {q.title && <div className="text-[11px] text-gray-500 truncate max-w-[160px]">{q.title}</div>}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <span className="text-[12px] font-bold px-2 py-0.5 rounded" style={{ background: sc.color + "22", color: sc.color }}>
                      {sc.label}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">{clinicName(q.clinic_id)}</td>
                  <td className="px-2 py-1.5 text-center text-[12px] text-gray-600">{fmtDate(q.issue_date)}</td>
                  <td className="px-2 py-1.5 text-center text-[12px] text-gray-600">{q.expiry_date ? fmtDate(q.expiry_date) : "—"}</td>
                  <td className="px-2 py-1.5 text-right text-[12px] font-bold">{fmtYen(q.total)}</td>
                  <td className="px-2 py-1.5 text-center whitespace-nowrap">
                    <Link href={`/admin/quotes/${q.id}`} className="text-[12px] px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 mr-1">開く</Link>
                    <button
                      onClick={() => deleteQuote(q.id, q.quote_number, q.status)}
                      disabled={deletingId === q.id}
                      className="text-[11px] px-1.5 py-1 rounded border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
                      title="この見積書を削除">
                      {deletingId === q.id ? "…" : "🗑"}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      </GroupViewTabs>

      {showImport && (
        <ImportModal
          importText={importText} setImportText={setImportText}
          importHasHeader={importHasHeader} setImportHasHeader={setImportHasHeader}
          clinics={clinics}
          importClinicId={importClinicId} setImportClinicId={setImportClinicId}
          importIssueDate={importIssueDate} setImportIssueDate={setImportIssueDate}
          importExpiryDate={importExpiryDate} setImportExpiryDate={setImportExpiryDate}
          importTargetMode={importTargetMode} setImportTargetMode={setImportTargetMode}
          importTargetQuoteId={importTargetQuoteId} setImportTargetQuoteId={setImportTargetQuoteId}
          importNotes={importNotes} setImportNotes={setImportNotes}
          importPreview={importPreview}
          importMeta={importMeta}
          quotes={quotes} clinicName={clinicName}
          importing={importing} importError={importError}
          onClose={() => setShowImport(false)}
          onImport={runImport}
        />
      )}
    </div>
  )
}

// ── 他ツールの見積データをインポート モーダル ──────────────
function ImportModal({
  importText, setImportText, importHasHeader, setImportHasHeader,
  clinics, importClinicId, setImportClinicId,
  importIssueDate, setImportIssueDate, importExpiryDate, setImportExpiryDate,
  importTargetMode, setImportTargetMode, importTargetQuoteId, setImportTargetQuoteId,
  importNotes, setImportNotes,
  importPreview, importMeta, quotes, clinicName,
  importing, importError, onClose, onImport,
}: {
  importText: string; setImportText: (v: string) => void
  importHasHeader: boolean; setImportHasHeader: (v: boolean) => void
  clinics: Clinic[]
  importClinicId: string; setImportClinicId: (v: string) => void
  importIssueDate: string; setImportIssueDate: (v: string) => void
  importExpiryDate: string; setImportExpiryDate: (v: string) => void
  importTargetMode: "new" | "replace"; setImportTargetMode: (v: "new" | "replace") => void
  importTargetQuoteId: string; setImportTargetQuoteId: (v: string) => void
  importNotes: string; setImportNotes: (v: string) => void
  importPreview: { productName: string; quantity: number; price: number; listPrice: number | null; cost: number | null }[]
  importMeta: { clinicNameGuess: string | null; issueDateGuess: string | null; notesGuess: string | null }
  quotes: Quote[]; clinicName: (id: string | null) => string
  importing: boolean; importError: string
  onClose: () => void; onImport: () => void
}) {
  const [clinicQuery, setClinicQuery] = useState("")
  const [clinicOpen, setClinicOpen] = useState(false)
  const norm = (v: string) => String(v || "").toLowerCase().normalize("NFKC")
  const filteredClinics = clinicQuery
    ? clinics.filter(c => norm(c.name).includes(norm(clinicQuery))).slice(0, 50)
    : clinics.slice(0, 50)
  const selectedClinic = clinics.find(c => c.id === importClinicId)
  const subtotal = importPreview.reduce((s, l) => s + l.price * l.quantity, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-bold">📥 他ツールの見積データをインポート</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="text-xs text-gray-500 bg-gray-50 rounded p-2" style={{ border: "1px solid #e8eaed" }}>
            見積システム等から出力したCSVファイルを選択するか、Excelなどからコピーして下の欄に直接貼り付けてください。
            「商品名」「数量」「単価（売価）」等の見出しがあれば自動で列を認識します（仕入単価・定価・得意先名・発行日・件名の見出しがあれば、それらも自動で読み取ります）。
            見出しが無い単純な表の場合は「商品名,数量,単価,定価」の順番として扱われます。
          </div>

          {importError && <div className="text-xs px-3 py-2 rounded bg-red-50 text-red-700" style={{ border: "1px solid #fcc" }}>{importError}</div>}

          <div>
            <label className="block text-[11px] text-gray-700 font-bold mb-1">CSVファイルを選択</label>
            <input type="file" accept=".csv,text/csv" onChange={async e => {
              const file = e.target.files?.[0]
              if (!file) return
              const buf = await file.arrayBuffer()
              let text = ""
              try {
                text = new TextDecoder("utf-8", { fatal: true }).decode(buf)
              } catch {
                // Excelで作った日本語CSVはShift_JIS（CP932）のことが多いため、UTF-8で読めなければこちらで再挑戦
                text = new TextDecoder("shift-jis").decode(buf)
              }
              setImportText(text.replace(/^﻿/, ""))  // 先頭のBOMを除去
              e.target.value = ""
            }} className="w-full text-xs" />
          </div>

          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            rows={6}
            placeholder={"例（Excelからコピー、またはCSVファイル選択で自動入力）:\n商品名,数量,単価\nエルコプレス motion,1,524000"}
            className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs font-mono bg-white"
          />
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={importHasHeader} onChange={e => setImportHasHeader(e.target.checked)} />
            先頭行は見出し（データではない）
          </label>

          {/* プレビュー */}
          <div className="border border-gray-200 rounded overflow-hidden">
            <div className="px-2 py-1 bg-gray-50 text-[11px] font-bold text-gray-600 border-b border-gray-200">
              読み取り結果プレビュー（{importPreview.length}件）
            </div>
            {importPreview.length === 0 ? (
              <div className="px-3 py-3 text-xs text-gray-400 text-center">まだデータがありません</div>
            ) : (
              <table className="w-full text-[11px]">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-2 py-1 text-left">商品名</th>
                    <th className="px-2 py-1 text-right w-16">数量</th>
                    {importPreview.some(l => l.cost != null) && <th className="px-2 py-1 text-right w-24">仕入価格</th>}
                    {importPreview.some(l => l.listPrice != null) && <th className="px-2 py-1 text-right w-24">定価</th>}
                    <th className="px-2 py-1 text-right w-24">単価</th>
                    <th className="px-2 py-1 text-right w-24">小計</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.map((l, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-2 py-1">{l.productName}</td>
                      <td className="px-2 py-1 text-right">{l.quantity}</td>
                      {importPreview.some(x => x.cost != null) && <td className="px-2 py-1 text-right">{l.cost != null ? fmtYen(l.cost) : "—"}</td>}
                      {importPreview.some(x => x.listPrice != null) && <td className="px-2 py-1 text-right">{l.listPrice != null ? fmtYen(l.listPrice) : "—"}</td>}
                      <td className="px-2 py-1 text-right">{fmtYen(l.price)}</td>
                      <td className="px-2 py-1 text-right">{fmtYen(l.price * l.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200">
                    <td colSpan={1 + 1 + (importPreview.some(l => l.cost != null) ? 1 : 0) + (importPreview.some(l => l.listPrice != null) ? 1 : 0) + 1} className="px-2 py-1 text-right font-bold text-gray-500">小計</td>
                    <td className="px-2 py-1 text-right font-bold">{fmtYen(subtotal)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {/* 取り込み先 */}
          <div className="flex gap-2 text-xs">
            <button onClick={() => setImportTargetMode("new")} className={"flex-1 px-3 py-2 rounded border font-bold " + (importTargetMode === "new" ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-gray-200 text-gray-500")}>
              🆕 新しい見積書として作成
            </button>
            <button onClick={() => setImportTargetMode("replace")} className={"flex-1 px-3 py-2 rounded border font-bold " + (importTargetMode === "replace" ? "border-amber-400 bg-amber-50 text-amber-700" : "border-gray-200 text-gray-500")}>
              🔁 既存の見積書を置き換える
            </button>
          </div>

          {importTargetMode === "replace" && (
            <div>
              <label className="block text-[11px] text-gray-700 font-bold mb-1">置き換え先の見積書</label>
              <select value={importTargetQuoteId} onChange={e => setImportTargetQuoteId(e.target.value)} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white">
                <option value="">選択してください</option>
                {quotes.map(q => <option key={q.id} value={q.id}>{q.quote_number}（{clinicName(q.clinic_id)}）</option>)}
              </select>
              <p className="text-[10px] text-amber-700 mt-1">⚠️ 選んだ見積書の明細は、インポートしたデータで完全に上書きされます。</p>
            </div>
          )}

          {/* 医院（新規作成時のみ必須。置き換え時は変更したい場合のみ） */}
          <div style={{ position: "relative" }}>
            <label className="block text-[11px] text-gray-700 font-bold mb-1">
              医院 {importTargetMode === "new" ? "*" : "（変更する場合のみ選択）"}
            </label>
            <input lang="ja"
              value={clinicOpen ? clinicQuery : (selectedClinic?.name || "")}
              onChange={e => { setClinicQuery(e.target.value); setClinicOpen(true) }}
              onFocus={() => { setClinicQuery(""); setClinicOpen(true) }}
              onBlur={() => setTimeout(() => setClinicOpen(false), 150)}
              placeholder="🔍 医院名で検索"
              className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
            {importMeta.clinicNameGuess && (
              selectedClinic
                ? <p className="text-[10px] text-emerald-700 mt-1">✓ CSVの得意先名「{importMeta.clinicNameGuess}」から自動選択しました</p>
                : <p className="text-[10px] text-amber-700 mt-1">⚠️ CSVの得意先名「{importMeta.clinicNameGuess}」に一致する医院が見つかりませんでした。手動で選択してください</p>
            )}
            {clinicOpen && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-lg" style={{ maxHeight: 220, overflowY: "auto" }}>
                {filteredClinics.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-400">該当する医院なし</div>
                ) : filteredClinics.map(c => (
                  <button key={c.id} type="button"
                    onMouseDown={e => { e.preventDefault(); setImportClinicId(c.id); setClinicQuery(""); setClinicOpen(false) }}
                    className={"w-full text-left px-3 py-2 text-sm border-t border-gray-100 hover:bg-blue-50 " + (importClinicId === c.id ? "bg-blue-50" : "")}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-gray-700 font-bold mb-1">発行日</label>
              <input type="date" value={importIssueDate} onChange={e => setImportIssueDate(e.target.value)} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-700 font-bold mb-1">有効期限</label>
              <input type="date" value={importExpiryDate} onChange={e => setImportExpiryDate(e.target.value)} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-gray-700 font-bold mb-1">備考</label>
            <input value={importNotes} onChange={e => setImportNotes(e.target.value)} className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white" />
          </div>
        </div>
        <div className="p-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs text-gray-500 hover:bg-gray-100 px-3 py-2 rounded">キャンセル</button>
          <button onClick={onImport} disabled={importing}
            className="px-5 py-2 text-sm font-bold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
            {importing ? "取り込み中…" : "✓ インポートする"}
          </button>
        </div>
      </div>
    </div>
  )
}
