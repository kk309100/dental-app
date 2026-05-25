"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import Link from "next/link"
import { parseCSV } from "@/lib/csv"

type Supplier = {
  id: string
  name: string
  maker_name: string | null
  contact: string | null
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  created_at?: string
}

type Form = {
  name: string
  maker_name: string
  contact: string
  phone: string
  email: string
  address: string
  notes: string
}

const empty: Form = { name: "", maker_name: "", contact: "", phone: "", email: "", address: "", notes: "" }

export default function AdminSuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(empty)
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState("")
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data, error } = await supabase.from("suppliers").select("*").order("name", { ascending: true }).limit(50000)
    if (error) setErrMsg(`読込エラー: ${error.message}`)
    setSuppliers(data || [])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const k = norm(search)
    if (!k) return suppliers
    return suppliers.filter((s) => {
      const target = norm(`${s.name} ${s.maker_name || ""} ${s.contact || ""}`)
      return target.includes(k)
    })
  }, [suppliers, search])

  const duplicates = useMemo(() => {
    const m = new Map<string, number>()
    suppliers.forEach((s) => {
      const k = norm(s.name)
      if (k) m.set(k, (m.get(k) || 0) + 1)
    })
    return Array.from(m.entries()).filter(([, n]) => n >= 2)
  }, [suppliers])

  async function importCSV(file: File) {
    setImporting(true); setImportMsg("")
    try {
      const text = await file.text()
      const rows = parseCSV(text)
      if (rows.length === 0) { setImportMsg("CSVが空です"); setImporting(false); return }
      const pickKey = (r: Record<string, string>, ...keys: string[]) => {
        for (const k of keys) if (r[k] !== undefined && r[k] !== "") return r[k]
        return ""
      }
      const existingByName = new Map(suppliers.map(s => [norm(s.name), s]))
      let created = 0, updated = 0, skipped = 0
      const errors: string[] = []
      for (const r of rows) {
        const name = pickKey(r, "仕入先名", "name").trim()
        if (!name) { skipped++; continue }
        const payload: Record<string, unknown> = {
          name,
          maker_name: pickKey(r, "メーカー名", "メーカー", "maker_name") || null,
          contact: pickKey(r, "担当者", "contact") || null,
          phone: pickKey(r, "電話", "電話番号", "phone") || null,
          email: pickKey(r, "メール", "email") || null,
          address: pickKey(r, "住所", "address") || null,
          notes: pickKey(r, "備考", "notes") || null,
        }
        const existing = existingByName.get(norm(name))
        if (existing) {
          const { error } = await supabase.from("suppliers").update(payload).eq("id", existing.id)
          if (error) { errors.push(`${name}: ${error.message}`); continue }
          updated++
        } else {
          const { error } = await supabase.from("suppliers").insert(payload)
          if (error) { errors.push(`${name}: ${error.message}`); continue }
          created++
        }
      }
      let msg = `✅ 取込完了: 新規${created}件 / 更新${updated}件 / スキップ${skipped}件`
      if (errors.length) msg += `\n⚠ エラー${errors.length}件: ${errors.slice(0, 3).join(" / ")}`
      setImportMsg(msg)
      await fetchData()
    } catch (e) {
      setImportMsg(`取込失敗: ${(e as Error).message}`)
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  function openAdd() { setForm(empty); setEditId(null); setErrMsg(""); setShowForm(true) }
  function openEdit(s: Supplier) {
    setForm({
      name: s.name || "", maker_name: s.maker_name || "", contact: s.contact || "",
      phone: s.phone || "", email: s.email || "", address: s.address || "", notes: s.notes || "",
    })
    setEditId(s.id); setErrMsg(""); setShowForm(true)
  }

  async function save() {
    if (!form.name.trim()) { setErrMsg("仕入先名を入力してください"); return }
    setSaving(true); setErrMsg("")
    try {
      if (editId) {
        const { error } = await supabase.from("suppliers").update(form).eq("id", editId)
        if (error) throw error
      } else {
        const { error } = await supabase.from("suppliers").insert(form)
        if (error) throw error
      }
      setShowForm(false)
      await fetchData()
    } catch (e) {
      setErrMsg(`保存失敗: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  async function del(id: string, name: string) {
    if (!confirm(`「${name}」を削除します。よろしいですか？`)) return
    const { error } = await supabase.from("suppliers").delete().eq("id", id)
    if (error) { alert(`削除失敗: ${error.message}`); return }
    fetchData()
  }

  function downloadCSV() {
    const rows: string[][] = [
      ["仕入先名", "メーカー名", "担当者", "電話", "メール", "住所", "備考"],
      ...suppliers.map((s) => [
        s.name || "", s.maker_name || "", s.contact || "", s.phone || "",
        s.email || "", s.address || "", s.notes || "",
      ]),
    ]
    const csv = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "仕入先一覧.csv"
    a.click()
  }

  if (loading) return <p className="text-gray-400 text-center py-12">読み込み中…</p>

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-900" style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: 0 }}>
          仕入先管理
          <span className="ml-2 text-xs font-normal text-gray-400">該当 {filtered.length}/全{suppliers.length}件</span>
        </h1>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importCSV(f) }} />
          <button onClick={() => fileRef.current?.click()} disabled={importing}
            className="text-sm px-3 py-2 bg-white border border-gray-200 rounded hover:bg-gray-50">
            {importing ? "取込中…" : "📥 CSV取込"}
          </button>
          <button onClick={downloadCSV} className="text-sm px-3 py-2 bg-white border border-gray-200 rounded hover:bg-gray-50">📤 CSV出力</button>
          <button onClick={openAdd} className="text-sm px-3 py-2 bg-emerald-600 text-white font-bold rounded hover:bg-emerald-700">＋ 仕入先を追加</button>
        </div>
      </div>

      {importMsg && (
        <div className="text-xs px-3 py-2 rounded whitespace-pre-line"
          style={{ background: importMsg.startsWith("✅") ? "#ecfdf5" : "#fff5f5", color: importMsg.startsWith("✅") ? "#065f46" : "#dc2626", border: "1px solid " + (importMsg.startsWith("✅") ? "#bbf7d0" : "#fcc") }}>
          {importMsg}
        </div>
      )}

      {duplicates.length > 0 && (
        <div className="text-xs px-3 py-2 rounded bg-amber-50 text-amber-700" style={{ border: "1px solid #fde68a" }}>
          ⚠ 同名の仕入先が {duplicates.length} 組あります
        </div>
      )}

      <div className="bg-gray-50 p-2 rounded-lg" style={{ border: "1px solid #e8eaed" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="仕入先名・メーカー・担当で検索（半角/全角OK）"
          className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-white"
        />
      </div>

      {errMsg && <div className="text-xs px-3 py-2 rounded bg-red-50 text-red-700" style={{ border: "1px solid #fcc" }}>{errMsg}</div>}

      {/* 高密度テーブル */}
      <div className="bg-white rounded overflow-auto" style={{ border: "1px solid #d0d0d0", maxHeight: "calc(100vh - 200px)" }}>
        <table className="w-full" style={{ borderCollapse: "collapse", fontSize: 13 }}>
          <thead className="sticky top-0 bg-gray-100">
            <tr className="text-[12px] text-gray-700 font-bold border-b-2 border-gray-300">
              <th className="px-2 py-1.5 text-left whitespace-nowrap">仕入先名</th>
              <th className="px-2 py-1.5 text-left whitespace-nowrap w-32">メーカー</th>
              <th className="px-2 py-1.5 text-left whitespace-nowrap w-28">担当者</th>
              <th className="px-2 py-1.5 text-left whitespace-nowrap w-32">電話</th>
              <th className="px-2 py-1.5 text-left whitespace-nowrap w-48">メール</th>
              <th className="px-2 py-1.5 text-left">住所</th>
              <th className="px-2 py-1.5 text-left w-32">備考</th>
              <th className="px-2 py-1.5 text-center whitespace-nowrap w-24">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                {search ? "該当なし" : "仕入先がまだ登録されていません"}
              </td></tr>
            ) : filtered.map((s, i) => (
              <tr key={s.id} className={"border-b border-gray-100 hover:bg-blue-50/40 " + (i % 2 === 0 ? "" : "bg-gray-50/30")}>
                <td className="px-2 py-1.5 font-bold text-gray-900 whitespace-nowrap">{s.name}</td>
                <td className="px-2 py-1.5 text-[12px] text-gray-600 whitespace-nowrap">{s.maker_name || "—"}</td>
                <td className="px-2 py-1.5 text-[12px] text-gray-600 whitespace-nowrap">{s.contact || "—"}</td>
                <td className="px-2 py-1.5 text-[12px] text-gray-600 whitespace-nowrap font-mono">{s.phone || "—"}</td>
                <td className="px-2 py-1.5 text-[12px] text-gray-600 whitespace-nowrap font-mono">{s.email || "—"}</td>
                <td className="px-2 py-1.5 text-[12px] text-gray-500" style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.address || ""}>
                  {s.address || "—"}
                </td>
                <td className="px-2 py-1.5 text-[12px] text-gray-500" style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.notes || ""}>
                  {s.notes || "—"}
                </td>
                <td className="px-2 py-1.5 text-center whitespace-nowrap">
                  <button onClick={() => openEdit(s)} className="text-[11px] px-1.5 py-0.5 border border-gray-200 rounded hover:bg-gray-50 text-gray-600 mr-1">編集</button>
                  <button onClick={() => del(s.id, s.name)} className="text-[11px] px-1.5 py-0.5 border border-red-200 bg-red-50 rounded hover:bg-red-100 text-red-700">削除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div style={overlay} onClick={() => setShowForm(false)}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeader}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{editId ? "仕入先を編集" : "仕入先を追加"}</h2>
              <button onClick={() => setShowForm(false)} style={btnClose}>×</button>
            </div>
            <div style={{ padding: 20 }}>
              {errMsg && <div style={errBox}>{errMsg}</div>}
              <Field label="仕入先名 *" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
              <Field label="メーカー名" value={form.maker_name} onChange={(v) => setForm((f) => ({ ...f, maker_name: v }))} />
              <Field label="担当者" value={form.contact} onChange={(v) => setForm((f) => ({ ...f, contact: v }))} />
              <Field label="電話番号" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
              <Field label="メールアドレス" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
              <Field label="住所" value={form.address} onChange={(v) => setForm((f) => ({ ...f, address: v }))} />
              <div style={fieldWrap}>
                <label style={fieldLabel}>備考</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  style={{ ...fieldInput, minHeight: 60, resize: "vertical", fontFamily: "inherit" }}
                />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button onClick={save} style={btnDark} disabled={saving}>{saving ? "保存中…" : "保存"}</button>
                <button onClick={() => setShowForm(false)} style={btnGray} disabled={saving}>キャンセル</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={fieldWrap}>
      <label style={fieldLabel}>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} style={fieldInput} />
    </div>
  )
}

function norm(v: string) { return String(v || "").toLowerCase().normalize("NFKC") }
function csvCell(s: string) { if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`; return s }

const page: React.CSSProperties = { maxWidth: 960, margin: "0 auto", padding: 20 }
const back: React.CSSProperties = { padding: "6px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", marginBottom: 16, cursor: "pointer" }
const header: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 12 }
const btnDark: React.CSSProperties = { padding: "8px 16px", borderRadius: 8, border: "none", background: "#111", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }
const btnGray: React.CSSProperties = { padding: "8px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#f7f7f7", fontSize: 13, cursor: "pointer", color: "#333" }
const btnEdit: React.CSSProperties = { padding: "5px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", fontSize: 12, cursor: "pointer", color: "#333" }
const btnDel: React.CSSProperties = { padding: "5px 12px", borderRadius: 6, border: "1px solid #fcc", background: "#fff5f5", fontSize: 12, cursor: "pointer", color: "#dc2626" }
const btnClose: React.CSSProperties = { background: "none", border: "none", fontSize: 24, color: "#999", cursor: "pointer", padding: 0, lineHeight: 1 }
const searchInput: React.CSSProperties = { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13, marginBottom: 12, boxSizing: "border-box" }
const card: React.CSSProperties = { background: "#fff", border: "1px solid #eee", borderRadius: 10, padding: 14, display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }
const cardName: React.CSSProperties = { fontSize: 15, fontWeight: 700, margin: 0, color: "#111" }
const cardSub: React.CSSProperties = { fontSize: 13, color: "#777", margin: "2px 0 0" }
const cardMeta: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6, fontSize: 13, color: "#555" }
const cardAddr: React.CSSProperties = { fontSize: 13, color: "#777", margin: "4px 0 0" }
const cardNotes: React.CSSProperties = { fontSize: 13, color: "#666", margin: "2px 0 0", whiteSpace: "pre-wrap" }
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 40, zIndex: 50 }
const modal: React.CSSProperties = { background: "#fff", borderRadius: 12, width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.2)" }
const modalHeader: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: "1px solid #eee" }
const fieldWrap: React.CSSProperties = { marginBottom: 10 }
const fieldLabel: React.CSSProperties = { display: "block", fontSize: 13, color: "#777", marginBottom: 4, fontWeight: 600 }
const fieldInput: React.CSSProperties = { width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box", background: "#fff" }
const errBox: React.CSSProperties = { padding: 10, background: "#fff5f5", border: "1px solid #fcc", borderRadius: 6, color: "#dc2626", fontSize: 12, marginBottom: 12 }
