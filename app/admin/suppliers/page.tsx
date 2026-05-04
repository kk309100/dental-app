"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import Link from "next/link"

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

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data, error } = await supabase.from("suppliers").select("*").order("name", { ascending: true })
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

  if (loading) return <main style={page}><p>読み込み中…</p></main>

  return (
    <main style={page}>
      <Link href="/admin"><button style={back}>← 戻る</button></Link>

      <div style={header}>
        <div>
          <h1 style={{ fontSize: 26, margin: 0 }}>仕入先管理</h1>
          <p style={{ fontSize: 12, color: "#999", margin: "4px 0 0" }}>{suppliers.length}件</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={downloadCSV} style={btnGray}>CSV</button>
          <button onClick={openAdd} style={btnDark}>＋ 仕入先を追加</button>
        </div>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="仕入先名・メーカー・担当で検索（半角/全角OK）"
        style={searchInput}
      />

      {errMsg && <div style={errBox}>{errMsg}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.length === 0 ? (
          <p style={{ padding: 32, textAlign: "center", color: "#999" }}>
            {search ? "該当なし" : "仕入先がまだ登録されていません"}
          </p>
        ) : (
          filtered.map((s) => (
            <div key={s.id} style={card}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={cardName}>{s.name}</p>
                {s.maker_name && <p style={cardSub}>メーカー: {s.maker_name}</p>}
                <div style={cardMeta}>
                  {s.contact && <span>👤 {s.contact}</span>}
                  {s.phone && <span>📞 {s.phone}</span>}
                  {s.email && <span>✉ {s.email}</span>}
                </div>
                {s.address && <p style={cardAddr}>📍 {s.address}</p>}
                {s.notes && <p style={cardNotes}>📝 {s.notes}</p>}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => openEdit(s)} style={btnEdit}>編集</button>
                <button onClick={() => del(s.id, s.name)} style={btnDel}>削除</button>
              </div>
            </div>
          ))
        )}
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
    </main>
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
const cardSub: React.CSSProperties = { fontSize: 11, color: "#777", margin: "2px 0 0" }
const cardMeta: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6, fontSize: 11, color: "#555" }
const cardAddr: React.CSSProperties = { fontSize: 11, color: "#777", margin: "4px 0 0" }
const cardNotes: React.CSSProperties = { fontSize: 11, color: "#666", margin: "2px 0 0", whiteSpace: "pre-wrap" }
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 40, zIndex: 50 }
const modal: React.CSSProperties = { background: "#fff", borderRadius: 12, width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.2)" }
const modalHeader: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: "1px solid #eee" }
const fieldWrap: React.CSSProperties = { marginBottom: 10 }
const fieldLabel: React.CSSProperties = { display: "block", fontSize: 11, color: "#777", marginBottom: 4, fontWeight: 600 }
const fieldInput: React.CSSProperties = { width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box", background: "#fff" }
const errBox: React.CSSProperties = { padding: 10, background: "#fff5f5", border: "1px solid #fcc", borderRadius: 6, color: "#dc2626", fontSize: 12, marginBottom: 12 }
