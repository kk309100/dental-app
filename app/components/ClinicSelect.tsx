"use client"

// 医院の選択（検索つき）。<select> の代わりに使う。
// 医院名・法人名・医院コードを、ひらがな・カタカナ・ローマ字で探せる。
// 絞り込み用（「全医院」を先頭に出す）は allValue / allLabel を指定する。
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { romajiAlt } from "@/lib/romaji"

export type ClinicOption = { id: string; name: string; corporate_name?: string | null; clinic_code?: string | null }

const toKata = (t: string) => t.normalize("NFKC").toLowerCase().replace(/[ぁ-ん]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60)).replace(/\s+/g, " ").trim()

export default function ClinicSelect({
  clinics, value, onChange, placeholder = "医院を選択…", allValue, allLabel = "全医院", className, style,
}: {
  clinics: ClinicOption[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  allValue?: string          // 指定すると、先頭に「全医院」の選択肢を出す（この値が、その選択肢の値）
  allLabel?: string
  className?: string
  style?: CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [open])

  const hits = useMemo(() => {
    const tokens = toKata(q).split(" ").filter(Boolean)
    const list = tokens.length === 0 ? clinics : clinics.filter(c => {
      const key = toKata(`${c.corporate_name || ""} ${c.name} ${c.clinic_code || ""}`)
      return tokens.every(t => key.includes(t) || (romajiAlt(t) ? key.includes(toKata(romajiAlt(t) as string)) : false))
    })
    return list.slice(0, 50)
  }, [clinics, q])

  const isAll = allValue !== undefined && value === allValue
  const selected = clinics.find(c => c.id === value)
  const label = isAll ? allLabel : selected ? selected.name : placeholder
  const pick = (id: string) => { onChange(id); setOpen(false); setQ("") }

  return (
    <div ref={box} style={{ position: "relative", display: "inline-block", minWidth: 0 }} className={className}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, padding: "6px 10px", fontSize: 13, background: "#fff", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", color: isAll || selected ? "#111827" : "#6b7280", ...style }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ fontSize: 10, color: "#9ca3af" }}>▼</span>
      </button>
      {open && (
        <div style={{ position: "absolute", zIndex: 60, left: 0, top: "100%", marginTop: 2, minWidth: 260, width: "max-content", maxWidth: "min(420px, 90vw)", background: "#fff", border: "1px solid #cbd5e1", borderRadius: 8, boxShadow: "0 6px 16px rgba(0,0,0,0.15)" }}>
          <div style={{ padding: 6, borderBottom: "1px solid #eee" }}>
            <input autoFocus type="text" value={q} onChange={e => setQ(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Escape") setOpen(false)
                if (e.key === "Enter" && hits[0]) { e.preventDefault(); pick(hits[0].id) }
              }}
              placeholder="医院名・かな・ローマ字・コードで検索"
              style={{ width: "100%", padding: "6px 8px", fontSize: 13, border: "1px solid #d1d5db", borderRadius: 6 }} />
          </div>
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            {allValue !== undefined && (
              <button type="button" onClick={() => pick(allValue)}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", fontSize: 13, fontWeight: 700, background: isAll ? "#eff6ff" : "#fff", border: "none", borderBottom: "1px solid #f0f0f0", cursor: "pointer" }}>{allLabel}</button>
            )}
            {hits.length === 0 ? (
              <div style={{ padding: "10px 12px", color: "#9ca3af", fontSize: 13 }}>該当する医院がありません</div>
            ) : hits.map(c => (
              <button key={c.id} type="button" onClick={() => pick(c.id)}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", fontSize: 13, background: c.id === value ? "#eff6ff" : "#fff", border: "none", borderBottom: "1px solid #f0f0f0", cursor: "pointer" }}>
                {c.name}{c.clinic_code ? <span style={{ color: "#9ca3af", marginLeft: 6 }}>[{c.clinic_code}]</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
