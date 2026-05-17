// 簡易監査ログユーティリティ
// audit_logs テーブル（マイグレーション後）に書き込み。テーブル無い場合は黙って失敗。
// actor は localStorage の "dental-app:user_name" を使う（後で Supabase Auth に置換可能）

import { supabase } from "@/lib/supabase"

const USER_KEY = "dental-app:user_name"

export function getActor(): string {
  if (typeof window === "undefined") return ""
  return localStorage.getItem(USER_KEY) || ""
}

export function setActor(name: string) {
  if (typeof window === "undefined") return
  localStorage.setItem(USER_KEY, name)
}

export type AuditAction = "INSERT" | "UPDATE" | "DELETE" | "VIEW" | "LOGIN" | "EXPORT" | "PRINT"

export async function logAudit(params: {
  action: AuditAction
  entity_type: string
  entity_id?: string | null
  before?: unknown
  after?: unknown
  note?: string
}) {
  try {
    await supabase.from("audit_logs").insert({
      actor: getActor() || "(unknown)",
      action: params.action,
      entity_type: params.entity_type,
      entity_id: params.entity_id || null,
      before_data: params.before ?? null,
      after_data: params.after ?? null,
      note: params.note || null,
    })
  } catch {
    // テーブル無い・RLS拒否などは握りつぶす（メイン処理を止めない）
  }
}
