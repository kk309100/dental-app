// 自社情報（請求書・納品書に印字）
// 1) フォールバック: 既存 hardcoded 値
// 2) 推奨: company_settings テーブルから読込
// React コンポーネントからは getCompany() / useCompany() を使用してください

import { supabase } from "@/lib/supabase"

export const COMPANY_FALLBACK = {
  name: "株式会社 清新",
  postalCode: "454-0812",
  address: "名古屋市中川区五月通2-37 黄金ステーションビル3階",
  phone: "052-526-3223",
  fax: "052-655-5977",
  email: "",
  representative: "代表取締役　小池拓未",
  invoiceNumber: "T4180001119611",
  bankName: "岐阜信用金庫",
  bankBranch: "名古屋支店",
  bankType: "普通",
  bankAccount: "1132391",
  bankHolder: "カ）セイシン",
  notes: "振込手数料は貴院負担でお願いいたします。",
  logoUrl: "" as string,
  sealUrl: "/seal.png" as string,
} as const

export type Company = typeof COMPANY_FALLBACK

// 後方互換: import { COMPANY } from "@/lib/company"
export const COMPANY = COMPANY_FALLBACK

// DB から取得（テーブル未作成時はフォールバック）
let _cache: Company | null = null
export async function getCompany(): Promise<Company> {
  if (_cache) return _cache
  try {
    const { data, error } = await supabase.from("company_settings").select("*").eq("id", 1).single()
    if (error || !data) return COMPANY_FALLBACK
    const c: Company = {
      name: data.company_name || COMPANY_FALLBACK.name,
      postalCode: data.postal_code || COMPANY_FALLBACK.postalCode,
      address: data.address || COMPANY_FALLBACK.address,
      phone: data.phone || COMPANY_FALLBACK.phone,
      fax: data.fax || COMPANY_FALLBACK.fax,
      email: data.email || "",
      representative: data.representative || COMPANY_FALLBACK.representative,
      invoiceNumber: data.invoice_registration_number || COMPANY_FALLBACK.invoiceNumber,
      bankName: data.bank_name || COMPANY_FALLBACK.bankName,
      bankBranch: data.bank_branch || COMPANY_FALLBACK.bankBranch,
      bankType: data.bank_type || COMPANY_FALLBACK.bankType,
      bankAccount: data.bank_number || COMPANY_FALLBACK.bankAccount,
      bankHolder: data.bank_holder || COMPANY_FALLBACK.bankHolder,
      notes: data.invoice_footer || COMPANY_FALLBACK.notes,
      logoUrl: data.logo_image_url || "",
      sealUrl: data.seal_image_url || COMPANY_FALLBACK.sealUrl,
    }
    _cache = c
    return c
  } catch {
    return COMPANY_FALLBACK
  }
}

export function clearCompanyCache() { _cache = null }
