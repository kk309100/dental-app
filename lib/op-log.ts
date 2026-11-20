// 操作の記録。「いつ・だれが・どの画面で・何をしたか」を残す（あとで、原因を調べるため）。
// 表（operation_log）が無くても、元の処理は止めない。
import { supabase } from "@/lib/supabase"
import { getActor } from "@/lib/audit"

export async function logOp(action: string, opts?: { entity?: string; id?: string | null; detail?: unknown }) {
  try {
    // 名前の記録が無いので、ログインしている人のメールアドレスを使う
    let actor = getActor()
    if (!actor) {
      const { data } = await supabase.auth.getSession()
      actor = data.session?.user?.email || ""
    }
    await supabase.from("operation_log").insert({
      actor: actor || null,
      action,
      entity_type: opts?.entity || null,
      entity_id: opts?.id || null,
      detail: opts?.detail ?? null,
      page: typeof window !== "undefined" ? window.location.pathname : null,
    })
  } catch { /* 記録の失敗で、元の処理は止めない */ }
}
