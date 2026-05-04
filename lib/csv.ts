// 軽量 CSV パーサ・シリアライザ
// - RFC 4180 準拠の簡易実装（クォート・改行・カンマ対応）
// - Excel UTF-8 BOM 出力対応

export function toCSV(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return ""
  const cols = columns || Object.keys(rows[0])
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return ""
    const s = String(v)
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const header = cols.join(",")
  const body = rows.map(r => cols.map(c => esc(r[c])).join(",")).join("\r\n")
  return "﻿" + header + "\r\n" + body // BOM 付与で Excel が文字化けしない
}

export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function parseCSV(text: string): Record<string, string>[] {
  const cleaned = text.replace(/^﻿/, "") // BOM 除去
  const lines = parseLines(cleaned)
  if (lines.length === 0) return []
  const header = lines[0]
  return lines.slice(1).map(row => {
    const o: Record<string, string> = {}
    header.forEach((h, i) => { o[h.trim()] = (row[i] ?? "").trim() })
    return o
  })
}

function parseLines(text: string): string[][] {
  const out: string[][] = []
  let cur: string[] = []
  let field = ""
  let inQuote = false
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuote = false; i++; continue
      }
      field += c; i++; continue
    }
    if (c === '"') { inQuote = true; i++; continue }
    if (c === ",") { cur.push(field); field = ""; i++; continue }
    if (c === "\r") { i++; continue }
    if (c === "\n") { cur.push(field); out.push(cur); cur = []; field = ""; i++; continue }
    field += c; i++
  }
  if (field || cur.length > 0) { cur.push(field); out.push(cur) }
  return out.filter(r => r.some(v => v.length > 0))
}
