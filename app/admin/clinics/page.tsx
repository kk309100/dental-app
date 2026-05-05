"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import Link from "next/link"
import { parseCSV } from "@/lib/csv"

// ── 型 ─────────────────────────────────────────────────────────────────
type Clinic = {
  id: string
  name: string
  corporate_name?: string | null
  contact?: string | null
  phone?: string | null
  adress?: string | null   // 注: dental-order スキーマ側の typo（正は address）
  email?: string | null
  sales_rep?: string | null
  closing_day?: string | null
  clinic_type?: string | null
  payment_method?: string | null
  created_at?: string
}

type Form = {
  name: string
  corporate_name: string
  contact: string
  phone: string
  adress: string
  email: string
  sales_rep: string
  closing_day: string
  clinic_type: string
  payment_method: string
}

const empty: Form = {
  name: "",
  corporate_name: "",
  contact: "",
  phone: "",
  adress: "",
  email: "",
  sales_rep: "",
  closing_day: "月末",
  clinic_type: "",
  payment_method: "振込",
}

const CLOSING_DAYS = ["月末", "20日", "15日", "10日", "5日", "その他"]
const CLINIC_TYPES = [
  { v: "", label: "自動判定（名前から歯科を検出）" },
  { v: "dental", label: "歯科医院（「医）」を付ける）" },
  { v: "company", label: "会社・法人（「医）」なし）" },
  { v: "person", label: "個人（「医）」なし）" },
  { v: "other", label: "その他（「医）」なし）" },
]

export default function AdminClinicsPage() {
  const [clinics, setClinics] = useState<Clinic[]>([])
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
    const { data, error } = await supabase
      .from("clinics")
      .select("*")
      .order("name", { ascending: true })
    if (error) setErrMsg(`読込エラー: ${error.message}`)
    setClinics(data || [])
    setLoading(false)
  }

  // 半角全角統一の検索
  const filtered = useMemo(() => {
    const k = norm(search)
    if (!k) return clinics
    return clinics.filter((c) => {
      const target = norm(`${c.name} ${c.corporate_name || ""} ${c.contact || ""} ${c.sales_rep || ""}`)
      return target.includes(k)
    })
  }, [clinics, search])

  // 重複検出: 名前 (NFKC正規化) で同じものが2件以上
  const duplicates = useMemo(() => {
    const m = new Map<string, Clinic[]>()
    clinics.forEach((c) => {
      const k = norm(c.name)
      if (!k) return
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(c)
    })
    return Array.from(m.entries()).filter(([, arr]) => arr.length >= 2)
  }, [clinics])

  function openAdd() {
    setForm(empty)
    setEditId(null)
    setErrMsg("")
    setShowForm(true)
  }

  function openEdit(c: Clinic) {
    setForm({
      name: c.name || "",
      corporate_name: c.corporate_name || "",
      contact: c.contact || "",
      phone: c.phone || "",
      adress: c.adress || "",
      email: c.email || "",
      sales_rep: c.sales_rep || "",
      closing_day: c.closing_day || "月末",
      clinic_type: c.clinic_type || "",
      payment_method: c.payment_method || "振込",
    })
    setEditId(c.id)
    setErrMsg("")
    setShowForm(true)
  }

  async function save() {
    if (!form.name.trim()) {
      setErrMsg("医院名を入力してください")
      return
    }
    setSaving(true)
    setErrMsg("")
    try {
      if (editId) {
        const { error } = await supabase.from("clinics").update(form).eq("id", editId)
        if (error) throw error
      } else {
        const { error } = await supabase.from("clinics").insert(form)
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
    if (!confirm(`「${name}」を削除します。よろしいですか？\n\n※ 関連する注文がある場合は削除できません。`)) return
    const { error } = await supabase.from("clinics").delete().eq("id", id)
    if (error) {
      alert(`削除失敗: ${error.message}\n\n※ この医院を参照している注文が残っている可能性があります。`)
      return
    }
    fetchData()
  }

  async function importCSV(file: File) {
    setImporting(true)
    setImportMsg("")
    try {
      const text = await file.text()
      const rows = parseCSV(text)
      if (rows.length === 0) { setImportMsg("CSVが空です"); setImporting(false); return }

      // ヘッダ名を柔軟にマッチ（日本語/英語）
      const pickKey = (r: Record<string, string>, ...keys: string[]) => {
        for (const k of keys) if (r[k] !== undefined && r[k] !== "") return r[k]
        return ""
      }

      const existingByName = new Map(clinics.map((c) => [norm(c.name), c]))
      let created = 0, updated = 0, skipped = 0
      const errors: string[] = []

      for (const r of rows) {
        const name = pickKey(r, "医院名", "name").trim()
        if (!name) { skipped++; continue }
        const payload: Record<string, string | null> = {
          name,
          corporate_name: pickKey(r, "法人名", "corporate_name") || null,
          contact: pickKey(r, "先方担当", "contact") || null,
          phone: pickKey(r, "電話", "電話番号", "phone") || null,
          email: pickKey(r, "メール", "メールアドレス", "email") || null,
          sales_rep: pickKey(r, "自社担当", "営業担当", "sales_rep") || null,
          closing_day: pickKey(r, "締日", "closing_day") || "月末",
          adress: pickKey(r, "住所", "address", "adress") || null,
          clinic_type: pickKey(r, "種別", "clinic_type") || null,
        }
        const existing = existingByName.get(norm(name))
        if (existing) {
          const { error } = await supabase.from("clinics").update(payload).eq("id", existing.id)
          if (error) { errors.push(`${name}: ${error.message}`); continue }
          updated++
        } else {
          const { error } = await supabase.from("clinics").insert(payload)
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

  function downloadCSV() {
    const rows: string[][] = [
      ["医院名", "法人名", "先方担当", "電話", "メール", "自社担当", "締日", "住所", "種別"],
      ...clinics.map((c) => [
        c.name || "",
        c.corporate_name || "",
        c.contact || "",
        c.phone || "",
        c.email || "",
        c.sales_rep || "",
        c.closing_day || "",
        c.adress || "",
        c.clinic_type || "",
      ]),
    ]
    const csv = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "医院一覧.csv"
    a.click()
  }

  if (loading) return <main style={page}><p>読み込み中…</p></main>

  return (
    <main style={page}>
      <Link href="/admin"><button style={back}>← 戻る</button></Link>

      <div style={header}>
        <div>
          <h1 style={{ fontSize: 26, margin: 0 }}>医院管理</h1>
          <p style={{ fontSize: 12, color: "#999", margin: "4px 0 0" }}>{clinics.length}件</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importCSV(f) }}
          />
          <button onClick={() => fileRef.current?.click()} disabled={importing} style={btnGray}>
            {importing ? "取込中…" : "📥 CSV取込"}
          </button>
          <button onClick={downloadCSV} style={btnGray}>📤 CSV出力</button>
          <button onClick={openAdd} style={btnDark}>＋ 医院を追加</button>
        </div>
      </div>

      {importMsg && (
        <div style={{ ...errBox, background: importMsg.startsWith("✅") ? "#ecfdf5" : "#fff5f5", borderColor: importMsg.startsWith("✅") ? "#bbf7d0" : "#fcc", color: importMsg.startsWith("✅") ? "#065f46" : "#dc2626", whiteSpace: "pre-line" }}>{importMsg}</div>
      )}

      {duplicates.length > 0 && (
        <div style={{ background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 12, color: "#92400e" }}>
          ⚠ 同名の医院が {duplicates.length} 組あります:
          {duplicates.slice(0, 5).map(([name, arr]) => (
            <span key={name} style={{ marginLeft: 8 }}>「{arr[0].name}」×{arr.length}</span>
          ))}
          {duplicates.length > 5 && <span> 他</span>}
        </div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="医院名・法人名・担当で検索（半角/全角OK）"
        style={searchInput}
      />

      {errMsg && (
        <div style={errBox}>{errMsg}</div>
      )}

      <div style={tableWrap}>
        {filtered.length === 0 ? (
          <p style={{ padding: 32, textAlign: "center", color: "#999" }}>
            {search ? "該当なし" : "医院がまだ登録されていません"}
          </p>
        ) : (
          filtered.map((c) => (
            <div key={c.id} style={card}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={cardName}>{c.name}</p>
                {c.corporate_name && <p style={cardSub}>{c.corporate_name}</p>}
                <div style={cardMeta}>
                  {c.contact && <span>👤 {c.contact}</span>}
                  {c.phone && <span>📞 {c.phone}</span>}
                  {c.email && <span>✉ {c.email}</span>}
                  {c.sales_rep && <span style={badge}>担当: {c.sales_rep}</span>}
                  <span style={badgeGray}>{c.closing_day || "月末"}</span>
                </div>
                {c.adress && <p style={cardAddr}>📍 {c.adress}</p>}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => openEdit(c)} style={btnEdit}>編集</button>
                <button onClick={() => del(c.id, c.name)} style={btnDel}>削除</button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* フォーム モーダル */}
      {showForm && (
        <div style={overlay} onClick={() => setShowForm(false)}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeader}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{editId ? "医院を編集" : "医院を追加"}</h2>
              <button onClick={() => setShowForm(false)} style={btnClose}>×</button>
            </div>
            <div style={{ padding: 20 }}>
              {errMsg && <div style={errBox}>{errMsg}</div>}
              <Field label="医院名 *" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
              <Field label="法人名" value={form.corporate_name} onChange={(v) => setForm((f) => ({ ...f, corporate_name: v }))} />
              <Field label="先方担当者" value={form.contact} onChange={(v) => setForm((f) => ({ ...f, contact: v }))} />
              <Field label="自社営業担当" value={form.sales_rep} onChange={(v) => setForm((f) => ({ ...f, sales_rep: v }))} />
              <Field label="電話番号" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
              <Field label="メールアドレス" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
              <Field label="住所" value={form.adress} onChange={(v) => setForm((f) => ({ ...f, adress: v }))} />

              <div style={fieldWrap}>
                <label style={fieldLabel}>締日</label>
                <select
                  value={form.closing_day}
                  onChange={(e) => setForm((f) => ({ ...f, closing_day: e.target.value }))}
                  style={fieldInput}
                >
                  {CLOSING_DAYS.map((d) => <option key={d}>{d}</option>)}
                </select>
              </div>

              <div style={fieldWrap}>
                <label style={fieldLabel}>得意先種別（納品書宛名に影響）</label>
                <select
                  value={form.clinic_type}
                  onChange={(e) => setForm((f) => ({ ...f, clinic_type: e.target.value }))}
                  style={fieldInput}
                >
                  {CLINIC_TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
                </select>
              </div>

              <div style={fieldWrap}>
                <label style={fieldLabel}>決済方法（請求書にスタンプ表示）</label>
                <select
                  value={form.payment_method}
                  onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}
                  style={fieldInput}
                >
                  <option value="振込">振込</option>
                  <option value="カード">カード（請求書に「カード決済」スタンプ）</option>
                  <option value="現金">現金</option>
                  <option value="口座引落">口座引落</option>
                  <option value="その他">その他</option>
                </select>
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

// ── サブコンポーネント ──────────────────────────────────────────────
function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={fieldWrap}>
      <label style={fieldLabel}>{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={fieldInput}
      />
    </div>
  )
}

// ── 補助関数 ──────────────────────────────────────────────────────────
function norm(v: string) {
  return String(v || "").toLowerCase().normalize("NFKC")
}

function csvCell(s: string) {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

// ── スタイル ──────────────────────────────────────────────────────────
const page: React.CSSProperties = { maxWidth: 960, margin: "0 auto", padding: 20 }
const back: React.CSSProperties = { padding: "6px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", marginBottom: 16, cursor: "pointer" }
const header: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 12 }
const btnDark: React.CSSProperties = { padding: "8px 16px", borderRadius: 8, border: "none", background: "#111", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }
const btnGray: React.CSSProperties = { padding: "8px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#f7f7f7", fontSize: 13, cursor: "pointer", color: "#333" }
const btnEdit: React.CSSProperties = { padding: "5px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", fontSize: 12, cursor: "pointer", color: "#333" }
const btnDel: React.CSSProperties = { padding: "5px 12px", borderRadius: 6, border: "1px solid #fcc", background: "#fff5f5", fontSize: 12, cursor: "pointer", color: "#dc2626" }
const btnClose: React.CSSProperties = { background: "none", border: "none", fontSize: 24, color: "#999", cursor: "pointer", padding: 0, lineHeight: 1 }
const searchInput: React.CSSProperties = { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13, marginBottom: 12, boxSizing: "border-box" }
const tableWrap: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 8 }
const card: React.CSSProperties = { background: "#fff", border: "1px solid #eee", borderRadius: 10, padding: 14, display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }
const cardName: React.CSSProperties = { fontSize: 15, fontWeight: 700, margin: 0, color: "#111" }
const cardSub: React.CSSProperties = { fontSize: 11, color: "#777", margin: "2px 0 0" }
const cardMeta: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6, fontSize: 11, color: "#555", alignItems: "center" }
const cardAddr: React.CSSProperties = { fontSize: 11, color: "#777", margin: "4px 0 0" }
const badge: React.CSSProperties = { padding: "2px 8px", borderRadius: 99, background: "#f3f4f6", fontSize: 10, color: "#555", fontWeight: 600 }
const badgeGray: React.CSSProperties = { padding: "2px 8px", borderRadius: 99, background: "#fafafa", border: "1px solid #eee", fontSize: 10, color: "#666" }
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 40, zIndex: 50 }
const modal: React.CSSProperties = { background: "#fff", borderRadius: 12, width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.2)" }
const modalHeader: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: "1px solid #eee" }
const fieldWrap: React.CSSProperties = { marginBottom: 10 }
const fieldLabel: React.CSSProperties = { display: "block", fontSize: 11, color: "#777", marginBottom: 4, fontWeight: 600 }
const fieldInput: React.CSSProperties = { width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, boxSizing: "border-box", background: "#fff" }
const errBox: React.CSSProperties = { padding: 10, background: "#fff5f5", border: "1px solid #fcc", borderRadius: 6, color: "#dc2626", fontSize: 12, marginBottom: 12 }
