// 操作の記録。「いつ・だれが・どの画面で・何をしたか」を残す（あとで、原因を調べるため）。
// 表（operation_log）が無くても、元の処理は止めない。
import { supabase } from "@/lib/supabase"
import { getActor } from "@/lib/audit"

export async function logOp(action: string, opts?: { entity?: string; id?: string | null; detail?: unknown }) {
  try {
    await supabase.from("operation_log").insert({
      actor: getActor() || null,
      action,
      entity_type: opts?.entity || null,
      entity_id: opts?.id || null,
      detail: opts?.detail ?? null,
      page: typeof window !== "undefined" ? window.location.pathname : null,
    })
  } catch { /* 記録の失敗で、元の処理は止めない */ }
}
