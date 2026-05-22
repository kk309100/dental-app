import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://alcetorurdocopxatego.supabase.co'
const supabaseKey = 'sb_publishable_VbmRpikpm6xr_lUaqo_MgQ_9swmJ_1j'

export const supabase = createClient(supabaseUrl, supabaseKey)

/**
 * Supabase は1リクエスト最大1,000件のため、range() でページングして全件取得する
 * @param table テーブル名
 * @param selectCols select 文字列
 * @param buildQuery (query) => query  追加フィルタ・order を適用するコールバック
 */
export async function fetchAll(table, selectCols = '*', buildQuery = (q) => q) {
  const CHUNK = 1000
  let from = 0
  const all = []
  while (true) {
    const base = supabase.from(table).select(selectCols).range(from, from + CHUNK - 1)
    const { data, error } = await buildQuery(base)
    if (error) { console.error(`fetchAll error (${table}):`, error.message); break }
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < CHUNK) break   // 最終ページ
    from += CHUNK
  }
  return all
}