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

/**
 * fetchAll と同じ全件取得だが、supabase.from(...).select(...) の結果と同じ { data, error } の形で返す。
 * Promise.all の中で `.limit(50000)` と差し替えるための互換ヘルパー。
 * （`.limit(50000)` を付けても、サーバー側の上限で1,000件に切られてしまうため）
 * ページングが安定するよう、必ず一意な列（既定は id）で並べる。
 */
/**
 * `.in(column, values)` を values が多い場合でも安全に実行する。
 * 値が多いとリクエストURLが長すぎて失敗するため、chunkSize 件ずつに分けて取得して結合する。
 * 返り値は supabase の結果と同じ { data, error } の形。
 */
export async function fetchInChunks(table, selectCols, column, values, chunkSize = 100, buildQuery = (q) => q) {
  const out = []
  const uniq = Array.from(new Set(values))
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const slice = uniq.slice(i, i + chunkSize)
    const rows = await fetchAll(table, selectCols, (q) => buildQuery(q.in(column, slice)).order('id', { ascending: true }))
    out.push(...rows)
  }
  return { data: out, error: null }
}

export async function fetchAllData(table, selectCols = '*', buildQuery = (q) => q, orderCol = 'id') {
  const data = await fetchAll(table, selectCols, (q) => buildQuery(q).order(orderCol, { ascending: true }))
  return { data, error: null }
}