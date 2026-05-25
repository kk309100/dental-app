"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import { fmtYen, fmtDate, ymd } from "@/lib/invoice"
import Link from "next/link"
import { parseCSV, toCSV, downloadCSV } from "@/lib/csv"

type Row = {
  id: string
  date: string
  cast_well_price: number | null
  cast_well_toka: boolean
  para_z_price: number | null
  para_z_toka: boolean
  cast_master_price: number | null
  cast_master_toka: boolean
  ishifuku_price: number | null
  ishifuku_toka: boolean
  memo: string | null
}

const PRODUCTS = [
  { key: "cast_well", label: "キャストウェル", color: "#3b82f6" },
  { key: "para_z", label: "パラZ", color: "#10b981" },
  { key: "cast_master", label: "キャストマスター", color: "#f59e0b" },
  { key: "ishifuku", label: "石福", color: "#8b5cf6" },
] as const

type ProductKey = typeof PRODUCTS[number]["key"]

const emptyForm = () => ({
  date: ymd(new Date()),
  cast_well_price: "" as string | number,
  cast_well_toka: false,
  para_z_price: "" as string | number,
  para_z_toka: false,
  cast_master_price: "" as string | number,
  cast_master_toka: false,
  ishifuku_price: "" as string | number,
  ishifuku_toka: false,
  memo: "",
})

export default function PalladiumPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState("")
  const [importMsg, setImportMsg] = useState("")
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data, error } = await supabase
      .from("palladium_prices")
      .select("*")
      .order("date", { ascending: false })
    if (error) setErrMsg(`読込エラー: ${error.message}`)
    setRows((data as Row[]) || [])
    setLoading(false)
  }

  const latest = rows[0]

  function openAdd() {
    setForm(emptyForm())
    setEditId(null)
    setErrMsg("")
    setShowForm(true)
  }

  function openEdit(r: Row) {
    setForm({
      date: r.date,
      cast_well_price: r.cast_well_price ?? "",
      cast_well_toka: r.cast_well_toka,
      para_z_price: r.para_z_price ?? "",
      para_z_toka: r.para_z_toka,
      cast_master_price: r.cast_master_price ?? "",
      cast_master_toka: r.cast_master_toka,
      ishifuku_price: r.ishifuku_price ?? "",
      ishifuku_toka: r.ishifuku_toka,
      memo: r.memo || "",
    })
    setEditId(r.id)
    setErrMsg("")
    setShowForm(true)
  }

  async function save() {
    if (!form.date) { setErrMsg("日付を入力してください"); return }
    setSaving(true)
    setErrMsg("")
    try {
      const payload = {
        date: form.date,
        cast_well_price: form.cast_well_price === "" ? null : Number(form.cast_well_price),
        cast_well_toka: form.cast_well_toka,
        para_z_price: form.para_z_price === "" ? null : Number(form.para_z_price),
        para_z_toka: form.para_z_toka,
        cast_master_price: form.cast_master_price === "" ? null : Number(form.cast_master_price),
        cast_master_toka: form.cast_master_toka,
        ishifuku_price: form.ishifuku_price === "" ? null : Number(form.ishifuku_price),
        ishifuku_toka: form.ishifuku_toka,
        memo: form.memo || null,
      }
      if (editId) {
        const { error } = await supabase.from("palladium_prices").update(payload).eq("id", editId)
        if (error) throw error
      } else {
        const { error } = await supabase.from("palladium_prices").insert(payload)
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

  async function del(id: string, date: string) {
    if (!confirm(`${date} のパラ価格を削除しますか？`)) return
    const { error } = await supabase.from("palladium_prices").delete().eq("id", id)
    if (error) { alert(`削除失敗: ${error.message}`); return }
    fetchData()
  }

  // 前日比チェック（変動アラート用）
  const variations = useMemo(() => {
    if (rows.length < 2) return []
    const today = rows[0]
    const yesterday = rows[1]
    return PRODUCTS.map(p => {
      const a = Number(today[`${p.key}_price` as `${ProductKey}_price`] || 0)
      const b = Number(yesterday[`${p.key}_price` as `${ProductKey}_price`] || 0)
      if (b === 0 || a === 0) return null
      const diff = a - b
      const pct = Math.round((diff / b) * 1000) / 10
      return { ...p, diff, pct, abs: Math.abs(pct) }
    }).filter(Boolean) as Array<{ key: ProductKey; label: string; color: string; diff: number; pct: number; abs: number }>
  }, [rows])

  async function importCSV(file: File) {
    setImporting(true); setImportMsg("")
    try {
      const text = await file.text()
      const parsed = parseCSV(text)
      if (parsed.length === 0) { setImportMsg("CSVが空です"); setImporting(false); return }
      const pickKey = (r: Record<string, string>, ...keys: string[]) => {
        for (const k of keys) if (r[k] !== undefined && r[k] !== "") return r[k]
        return ""
      }
      let created = 0, updated = 0, skipped = 0
      const errors: string[] = []
      for (const r of parsed) {
        const dateStr = pickKey(r, "日付", "date").trim()
        if (!dateStr) { skipped++; continue }
        const date = dateStr.replace(/[年月]/g, "-").replace(/日/g, "").replace(/\//g, "-")
        const payload: Record<string, unknown> = {
          date,
          cast_well_price: Number(pickKey(r, "キャストウェル", "cast_well_price").replace(/[¥,]/g, "")) || null,
          para_z_price: Number(pickKey(r, "パラZ", "para_z_price").replace(/[¥,]/g, "")) || null,
          cast_master_price: Number(pickKey(r, "キャストマスター", "cast_master_price").replace(/[¥,]/g, "")) || null,
          ishifuku_price: Number(pickKey(r, "石福", "ishifuku_price").replace(/[¥,]/g, "")) || null,
          memo: pickKey(r, "備考", "memo") || null,
        }
        const existing = rows.find(x => x.date === date)
        if (existing) {
          const { error } = await supabase.from("palladium_prices").update(payload).eq("id", existing.id)
          if (error) { errors.push(`${date}: ${error.message}`); continue }
          updated++
        } else {
          const { error } = await supabase.from("palladium_prices").insert(payload)
          if (error) { errors.push(`${date}: ${error.message}`); continue }
          created++
        }
      }
      let msg = `✅ 取込完了: 新規${created}件 / 更新${updated}件 / スキップ${skipped}件`
      if (errors.length) msg += `\n⚠ エラー${errors.length}件`
      setImportMsg(msg)
      await fetchData()
    } catch (e) {
      setImportMsg(`取込失敗: ${(e as Error).message}`)
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  function exportCSV() {
    const csv = toCSV(rows.map(r => ({
      日付: r.date,
      キャストウェル: r.cast_well_price || "",
      パラZ: r.para_z_price || "",
      キャストマスター: r.cast_master_price || "",
      石福: r.ishifuku_price || "",
      備考: r.memo || "",
    })))
    downloadCSV(`パラ価格_${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  if (loading) return <main style={page}><p>読み込み中…</p></main>

  return (
    <main style={page}>
      <Link href="/admin"><button style={back}>← 戻る</button></Link>

      <div style={header}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827", margin: 0 }}>パラ価格管理</h1>
          <p style={{ fontSize: 12, color: "#999", margin: "4px 0 0" }}>{rows.length}件</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }}
            onChange={e => { const f = e.target.files?.[0]; if (f) importCSV(f) }} />
          <button onClick={() => fileRef.current?.click()} disabled={importing}
            style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#f7f7f7", fontSize: 13, cursor: "pointer", color: "#333" }}>
            {importing ? "取込中…" : "📥 CSV取込"}
          </button>
          <button onClick={exportCSV}
            style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#f7f7f7", fontSize: 13, cursor: "pointer", color: "#333" }}>
            📤 CSV出力
          </button>
          <button onClick={openAdd} style={btnDark}>＋ 価格を追加</button>
        </div>
      </div>

      {importMsg && (
        <div style={{ padding: 10, background: importMsg.startsWith("✅") ? "#ecfdf5" : "#fff5f5", border: "1px solid " + (importMsg.startsWith("✅") ? "#bbf7d0" : "#fcc"), borderRadius: 6, color: importMsg.startsWith("✅") ? "#065f46" : "#dc2626", fontSize: 12, marginBottom: 12, whiteSpace: "pre-line" }}>{importMsg}</div>
      )}

      {variations.filter(v => v.abs >= 5).length > 0 && (
        <div style={{ padding: 10, background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 6, color: "#92400e", fontSize: 12, marginBottom: 12 }}>
          ⚠ 前日比 5% 以上の変動: {variations.filter(v => v.abs >= 5).map(v => `${v.label}: ${v.pct >= 0 ? "+" : ""}${v.pct}%`).join(" / ")}
        </div>
      )}

      {/* 最新価格カード */}
      {latest && (
        <div style={latestBox}>
          <p style={{ fontSize: 12, color: "#999", margin: "0 0 8px" }}>
            最新価格（{fmtDate(latest.date)}）
          </p>
          <div style={latestGrid}>
            {PRODUCTS.map((p) => {
              const price = latest[`${p.key}_price` as `${ProductKey}_price`]
              const toka = latest[`${p.key}_toka` as `${ProductKey}_toka`]
              return (
                <div key={p.key} style={latestCard}>
                  <div style={{ ...productLabel, color: p.color }}>{p.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{price !== null ? fmtYen(price) : "—"}</div>
                  {toka && <div style={tokaBadge}>特価</div>}
                </div>
              )
            })}
          </div>
          {latest.memo && <p style={{ fontSize: 11, color: "#666", margin: "8px 0 0" }}>📝 {latest.memo}</p>}
        </div>
      )}

      {errMsg && <div style={errBox}>{errMsg}</div>}

      {/* 履歴 */}
      <div style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>履歴</h2>
        {rows.length === 0 ? (
          <p style={{ padding: 32, textAlign: "center", color: "#999" }}>価格データがまだ登録されていません</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "center" }}>日付</th>
                  {PRODUCTS.map((p) => (
                    <th key={p.key} style={{ ...th, textAlign: "right", color: p.color }}>{p.label}</th>
                  ))}
                  <th style={th}>備考</th>
                  <th style={{ ...th, width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, textAlign: "center" }}>{r.date}</td>
                    {PRODUCTS.map((p) => {
                      const price = r[`${p.key}_price` as `${ProductKey}_price`]
                      const toka = r[`${p.key}_toka` as `${ProductKey}_toka`]
                      return (
                        <td key={p.key} style={td}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                            {toka && <span style={tokaBadgeSmall}>特</span>}
                            <span style={{ minWidth: 70, textAlign: "right" }}>{price !== null ? fmtYen(price) : "—"}</span>
                          </div>
                        </td>
                      )
                    })}
                    <td style={{ ...td, fontSize: 12, color: "#666", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.memo}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <button onClick={() => openEdit(r)} style={btnEdit}>編集</button>
                      <button onClick={() => del(r.id, r.date)} style={{ ...btnDel, marginLeft: 4 }}>削除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 追加・編集モーダル */}
      {showForm && (
        <div style={overlay} onClick={() => setShowForm(false)}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeader}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{editId ? "価格を編集" : "価格を追加"}</h2>
              <button onClick={() => setShowForm(false)} style={btnClose}>×</button>
            </div>
            <div style={{ padding: 20 }}>
              {errMsg && <div style={errBox}>{errMsg}</div>}
              <div style={fieldWrap}>
                <label style={fieldLabel}>日付 *</label>
                <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} style={fieldInput} />
              </div>
              {PRODUCTS.map((p) => (
                <div key={p.key} style={{ ...fieldWrap, display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "end" }}>
                  <div>
                    <label style={{ ...fieldLabel, color: p.color }}>{p.label}（¥/g）</label>
                    <input
                      type="number"
                      value={form[`${p.key}_price` as `${ProductKey}_price`]}
                      onChange={(e) => setForm((f) => ({ ...f, [`${p.key}_price`]: e.target.value }))}
                      style={fieldInput}
                      placeholder="例: 8500"
                    />
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, paddingBottom: 8, whiteSpace: "nowrap" }}>
                    <input
                      type="checkbox"
                      checked={form[`${p.key}_toka` as `${ProductKey}_toka`]}
                      onChange={(e) => setForm((f) => ({ ...f, [`${p.key}_toka`]: e.target.checked }))}
                    />
                    特価
                  </label>
                </div>
              ))}
              <div style={fieldWrap}>
                <label style={fieldLabel}>備考</label>
                <textarea
                  value={form.memo}
                  onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
                  style={{ ...fieldInput, minHeight: 50, fontFamily: "inherit", resize: "vertical" }}
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

const page: React.CSSProperties = { maxWidth: 1000, margin: "0 auto", padding: 20 }
const back: React.CSSProperties = { padding: "6px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", marginBottom: 16, cursor: "pointer" }
const header: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 12 }
const btnDark: React.CSSProperties = { padding: "8px 16px", borderRadius: 8, border: "none", background: "#111", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }
const btnGray: React.CSSProperties = { padding: "8px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#f7f7f7", fontSize: 13, cursor: "pointer", color: "#333" }
const btnEdit: React.CSSProperties = { padding: "3px 10px", borderRadius: 5, border: "1px solid #ddd", background: "#fff", fontSize: 11, cursor: "pointer", color: "#333" }
const btnDel: React.CSSProperties = { padding: "3px 10px", borderRadius: 5, border: "1px solid #fcc", background: "#fff5f5", fontSize: 11, cursor: "pointer", color: "#dc2626" }
const btnClose: React.CSSProperties = { background: "none", border: "none", fontSize: 24, color: "#999", cursor: "pointer", padding: 0, lineHeight: 1 }
const latestBox: React.CSSProperties = { background: "#fff", border: "2px solid #111", borderRadius: 12, padding: 16, marginBottom: 16 }
const latestGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }
const latestCard: React.CSSProperties = { background: "#fafafa", borderRadius: 8, padding: 12, textAlign: "center" }
const productLabel: React.CSSProperties = { fontSize: 12, fontWeight: 700, marginBottom: 4 }
const tokaBadge: React.CSSProperties = { display: "inline-block", marginTop: 4, padding: "1px 6px", borderRadius: 4, background: "#fef3c7", color: "#92400e", fontSize: 10, fontWeight: 700 }
const tokaBadgeSmall: React.CSSProperties = { display: "inline-block", padding: "0 4px", borderRadius: 3, background: "#fef3c7", color: "#92400e", fontSize: 9, fontWeight: 700 }
const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", background: "#fff", border: "1px solid #eee", borderRadius: 8 }
const th: React.CSSProperties = { borderBottom: "2px solid #111", padding: "8px 10px", textAlign: "left", fontSize: 12, fontWeight: 700, background: "#fafafa" }
const td: React.CSSProperties = { borderBottom: "1px solid #eee", padding: "8px 10px", fontSize: 13 }
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 40, zIndex: 50 }
const modal: React.CSSProperties = { background: "#fff", borderRadius: 12, width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.2)" }
const modalHeader: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: "1px solid #eee" }
const fieldWrap: React.CSSProperties = { marginBottom: 10 }
const fieldLabel: React.CSSProperties = { display: "block", fontSize: 12, color: "#777", marginBottom: 4, fontWeight: 600 }
const fieldInput: React.CSSProperties = { width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box", background: "#fff" }
const errBox: React.CSSProperties = { padding: 10, background: "#fff5f5", border: "1px solid #fcc", borderRadius: 6, color: "#dc2626", fontSize: 13, marginBottom: 12 }
