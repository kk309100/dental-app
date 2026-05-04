// 請求書まわりの共通ロジック（番号採番、締日計算、消費税計算など）

import { supabase } from "@/lib/supabase"

// ── 締日 → 集計期間 ────────────────────────────────────────────────────
// closing_day: "月末" | "20日" | "15日" | "10日" | "5日" | "その他"
// 基準日 baseDate を含む請求対象期間（from..to）を返す
export function calcBillingPeriod(closingDay: string, baseDate: Date = new Date()): { from: string; to: string; label: string } {
  const cd = (closingDay || "月末").replace("日", "").trim()
  const isMonthEnd = cd === "月末" || cd === "" || isNaN(Number(cd))
  const y = baseDate.getFullYear()
  const m = baseDate.getMonth()
  const day = baseDate.getDate()

  if (isMonthEnd) {
    const from = new Date(y, m, 1)
    const to = new Date(y, m + 1, 0)
    return { from: ymd(from), to: ymd(to), label: "月末締め" }
  }

  const cdNum = Number(cd)
  let fromD: Date, toD: Date
  if (day <= cdNum) {
    // 基準日が締日以前 → 前月締日翌日 〜 今月締日
    fromD = addDays(new Date(y, m - 1, cdNum), 1)
    toD = new Date(y, m, cdNum)
  } else {
    // 基準日が締日後 → 今月締日翌日 〜 翌月締日
    fromD = addDays(new Date(y, m, cdNum), 1)
    toD = new Date(y, m + 1, cdNum)
  }
  return { from: ymd(fromD), to: ymd(toD), label: `${cdNum}日締め` }
}

// ── 請求書番号採番（INV-YYYYMM-NNN） ─────────────────────────────────────
export async function generateInvoiceNumber(issueDate: Date = new Date()): Promise<string> {
  const ym = `${issueDate.getFullYear()}${String(issueDate.getMonth() + 1).padStart(2, "0")}`
  const prefix = `INV-${ym}-`
  const { data } = await supabase
    .from("invoices")
    .select("invoice_number")
    .like("invoice_number", `${prefix}%`)
  const max = (data || []).reduce((m, r: { invoice_number: string }) => {
    const n = parseInt(r.invoice_number.slice(prefix.length), 10)
    return Math.max(m, isNaN(n) ? 0 : n)
  }, 0)
  return prefix + String(max + 1).padStart(3, "0")
}

// ── 期限計算（締日の翌月末払い） ──────────────────────────────────────
export function calcDueDate(issueDate: Date): string {
  const d = new Date(issueDate.getFullYear(), issueDate.getMonth() + 2, 0)
  return ymd(d)
}

// ── 消費税（10%、税抜→税込） ─────────────────────────────────────────
export const TAX_RATE = 0.1
export function calcTax(subtotal: number): number {
  return Math.floor(subtotal * TAX_RATE)
}

// ── ヘルパ ──────────────────────────────────────────────────────────
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

// ── 表示用フォーマット ────────────────────────────────────────────────
export function fmtYen(n: number): string {
  return "¥" + Number(n || 0).toLocaleString("ja-JP")
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return ""
  const dt = typeof d === "string" ? new Date(d) : d
  return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日`
}

// ── 医院名プレフィックス（「医）」） ────────────────────────────────────
const DENTAL_KEYWORDS = ["歯科", "デンタル", "dental", "口腔", "矯正歯科", "医院", "クリニック", "診療所"]
export function getClinicPrefix(name: string, corporateName?: string | null, clinicType?: string | null): string {
  if (clinicType === "dental") return "医）"
  if (clinicType === "company" || clinicType === "person" || clinicType === "other") return ""
  const target = (name + (corporateName || "")).toLowerCase()
  return DENTAL_KEYWORDS.some((kw) => target.includes(kw.toLowerCase())) ? "医）" : ""
}

// ── 請求書ステータス ──────────────────────────────────────────────────
export const INVOICE_STATUSES = {
  issued: { label: "発行済", color: "#3b82f6" },
  paid: { label: "入金済", color: "#10b981" },
  cancelled: { label: "取消", color: "#9ca3af" },
} as const

export type InvoiceStatus = keyof typeof INVOICE_STATUSES
