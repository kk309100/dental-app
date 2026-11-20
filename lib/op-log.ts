// 操作の記録。「いつ・だれが・どの画面で・何をしたか」を残す（あとで、原因を調べるため）。
// 表（operation_log）が無くても、元の処理は止めない。
import { supabase } from "@/lib/supabase"
import { getActor } from "@/lib/audit"

// 名前は、profiles.display_name（無ければ、ログインのメール）を使う。1回調べたら覚えておく
let cached: { uid: string; name: string } | null = null

async function whoAmI(): Promise<string> {
  const local = getActor()
  if (local) return local
  const { data } = await supabase.auth.getSession()
  const user = data.session?.user
  if (!user) return ""
  if (cached && cached.uid === user.id) return cached.name
  let name = ""
  try {
    const { data: p } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle()
    name = (p as { display_name?: string | null } | null)?.display_name || ""
  } catch { /* 列が無くても、メールで代用する */ }
  name = name || user.email || ""
  cached = { uid: user.id, name }
  return name
}

export async function logOp(action: string, opts?: { entity?: string; id?: string | null; detail?: unknown }) {
  try {
    await supabase.from("operation_log").insert({
      actor: (await whoAmI()) || null,
      action,
      entity_type: opts?.entity || null,
      entity_id: opts?.id || null,
      detail: opts?.detail ?? null,
      page: typeof window !== "undefined" ? window.location.pathname : null,
    })
  } catch { /* 記録の失敗で、元の処理は止めない */ }
}
