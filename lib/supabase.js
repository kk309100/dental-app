import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://alcetorurdocopxatego.supabase.co'
const supabaseKey = 'sb_publishable_VbmRpikpm6xr_lUaqo_MgQ_9swmJ_1j'

// ── 取りこぼし（1000件上限による切り捨て）の自動検知 ─────────────────────────
// Supabase(PostgREST) は1リクエスト最大1000件で、.limit(50000) を付けても静かに1000件に切られる。
// 「件数指定なし／1000超の指定」なのにちょうど1000件しか返らなかった場合は切り捨ての可能性が高いので、
// 画面上部に警告を出す（fetchAll のページング取得は limit=1000 を付けるため対象外）。
const reportedTruncations = new Set()
function reportTruncation(table) {
  if (typeof document === 'undefined') return
  const key = table.split('?')[0]
  if (reportedTruncations.has(key)) return
  reportedTruncations.add(key)
  console.warn(`[取りこぼしの可能性] 「${key}」が先頭1000件で打ち切られました。fetchAll / fetchAllData で全件取得してください。`)
  let bar = document.getElementById('denthub-truncation-banner')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'denthub-truncation-banner'
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#b45309;color:#fff;font-size:13px;font-weight:700;padding:8px 40px 8px 12px;line-height:1.5'
    const close = document.createElement('button')
    close.textContent = '×'
    close.style.cssText = 'position:absolute;right:10px;top:4px;background:none;border:none;color:#fff;font-size:20px;cursor:pointer'
    close.onclick = () => bar.remove()
    bar.appendChild(close)
    const msg = document.createElement('span'); msg.id = 'denthub-truncation-msg'
    bar.insertBefore(msg, close)
    document.body.appendChild(bar)
  }
  const msg = document.getElementById('denthub-truncation-msg')
  const names = Array.from(reportedTruncations).join('、')
  if (msg) msg.textContent = `⚠ この画面はデータの一部しか読み込めていません（対象: ${names} の先頭1000件のみ）。表示や集計が不完全な可能性があります。管理者に連絡してください。`
}
const guardedFetch = async (input, init) => {
  const res = await fetch(input, init)
  try {
    if (typeof window !== 'undefined' && (!init || !init.method || init.method === 'GET')) {
      const url = new URL(typeof input === 'string' ? input : input.url)
      if (url.pathname.startsWith('/rest/v1/')) {
        const m = (res.headers.get('content-range') || '').match(/^(\d+)-(\d+)\//)
        if (m && Number(m[2]) - Number(m[1]) + 1 === 1000) {
          const lim = url.searchParams.get('limit')
          if (lim === null || Number(lim) > 1000) reportTruncation(url.pathname.replace('/rest/v1/', ''))
        }
      }
    }
  } catch { /* 検知の失敗で本来の処理を止めない */ }
  return res
}

export const supabase = createClient(supabaseUrl, supabaseKey, { global: { fetch: guardedFetch } })

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