/**
 * fetch-product-images-ddg.js
 *
 * DuckDuckGo 非公式画像検索API（キー不要・無料）を使って
 * 商品名＋メーカー名で画像を検索し、ヒューリスティックスコアリングで
 * 最適な画像URLを選定して Supabase に保存する。
 *
 * 実行:  node scripts/fetch-product-images-ddg.js
 * 再開:  同じコマンドで続きから再開（進捗ファイルが残っていれば）
 * リセット: node scripts/fetch-product-images-ddg.js --reset
 */

const { createClient } = require("@supabase/supabase-js")
const fs   = require("fs")
const path = require("path")

// ── 設定 ──────────────────────────────────────────────────────────
const SUPABASE_URL         = "https://alcetorurdocopxatego.supabase.co"
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const PROGRESS_FILE        = path.join(__dirname, "ddg_progress.json")
const LOG_FILE             = path.join(__dirname, "ddg_log.csv")
const DELAY_MIN_MS         = 1200   // リクエスト間隔 最小
const DELAY_MAX_MS         = 2000   // リクエスト間隔 最大（ランダム）
const TOP_N                = 5      // 上位何件をスコア対象にするか
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
// ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function jitter()  { return Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS) + DELAY_MIN_MS) }

// ── DuckDuckGo 画像検索 ────────────────────────────────────────────
async function searchDDG(query, retry = 0) {
  try {
    // Step1: vqd トークン取得
    const r1 = await fetch(
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=images&iax=images`,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) }
    )
    const html = await r1.text()
    const m = html.match(/vqd="([^"]+)"/) || html.match(/vqd=([0-9-]+)/)
    if (!m) return []

    await sleep(500)

    // Step2: 画像リスト取得
    const params = new URLSearchParams({
      q: query, vqd: m[1], o: "json", p: "-1", s: "0", u: "bing", f: ",,,,,",
    })
    const r2 = await fetch(
      `https://duckduckgo.com/i.js?${params}`,
      { headers: { "User-Agent": UA, "Referer": "https://duckduckgo.com/" }, signal: AbortSignal.timeout(12000) }
    )
    if (r2.status === 403 && retry < 2) {
      await sleep(5000)
      return searchDDG(query, retry + 1)
    }
    if (!r2.ok) return []
    const json = await r2.json()
    return json.results || []
  } catch {
    if (retry < 2) { await sleep(3000); return searchDDG(query, retry + 1) }
    return []
  }
}

// ── スコアリング ──────────────────────────────────────────────────
function scoreImage(result, manufacturer, name) {
  let score = 0
  const url    = (result.image  || "").toLowerCase()
  const source = (result.source || result.url || "").toLowerCase()
  const w      = result.width  || 0
  const h      = result.height || 0
  const mfr    = (manufacturer || "").toLowerCase().replace(/\s/g, "")
  const nm     = (name         || "").toLowerCase()

  // ── サイズスコア ──
  if (w > 0 && h > 0) {
    const ratio = Math.min(w, h) / Math.max(w, h)
    score += Math.round(ratio * 20)          // 正方形に近いほど +20
    if (Math.min(w, h) >= 300) score += 15   // 300px以上
    if (Math.min(w, h) >= 500) score += 10   // 500px以上
    if (Math.max(w, h) < 100)  score -= 40   // アイコンサイズ除外
    if (w > 0 && h > 0 && Math.max(w, h) >= 100 && Math.max(w, h) <= 2500) score += 5
  }

  // ── ドメインスコア ──
  // 歯科メーカー公式
  const officialDomains = [
    "gc.dental","gc-dental","gcdental","gc.co.jp",
    "shofu.co.jp","shofu.com",
    "tokuyama-dental","tokuyama.co.jp",
    "kuraray","noritake-dental",
    "morita.com","j-morita",
    "ydm.co.jp","yoshida-dental",
    "dentsply","sirona",
    "ivoclar","vivadent",
    "3m.com","3m-espe",
    "bsa-sakurai","mani.co.jp",
    "lion-dental","sunstar.co.jp",
    "nakanishi-dental","nsk-dent",
    "dente.co.jp","denta.co.jp",
  ]
  for (const d of officialDomains) {
    if (url.includes(d) || source.includes(d)) { score += 50; break }
  }

  // 歯科ECサイト
  const dentalShops = [
    "shop.pdr","denta-tec","dental-aichi","medicom",
    "shika-shop","sigmap","whitedental",
  ]
  for (const d of dentalShops) {
    if (url.includes(d) || source.includes(d)) { score += 25; break }
  }

  // 総合ECサイト（商品画像が多い）
  if (url.includes("thumbnail.image.rakuten") || url.includes("tshop.r10s"))  score += 20
  if (url.includes("images-amazon") || url.includes("m.media-amazon"))        score += 20
  if (url.includes("yahoo") && url.includes("shop"))                           score += 15

  // ── URLにメーカー名が含まれる ──
  if (mfr.length >= 3 && (url.includes(mfr.slice(0, 4)) || source.includes(mfr.slice(0, 4)))) {
    score += 15
  }

  // ── ノイズ除外 ──
  const noisePatterns = /logo|banner|icon|avatar|button|nav|header|footer|sprite|background|bg[-_]/
  if (noisePatterns.test(url)) score -= 30

  // ── ファイル形式 ──
  if (/\.(jpg|jpeg|png|webp)(\?|$|&)/.test(url)) score += 5
  if (/\.gif(\?|$)/.test(url))  score -= 15
  if (/\.svg(\?|$)/.test(url))  score -= 10

  return score
}

function pickBest(results, manufacturer, name) {
  const topN = results.slice(0, TOP_N)
  if (topN.length === 0) return null

  const scored = topN.map(r => ({ ...r, _score: scoreImage(r, manufacturer, name) }))
  scored.sort((a, b) => b._score - a._score)

  const best = scored[0]
  if (best._score < -10) return null  // スコアが著しく低い場合は採用しない
  return best.image || null
}

// ── メイン ────────────────────────────────────────────────────────
async function main() {
  const isReset = process.argv.includes("--reset")
  if (isReset && fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE)
    console.log("進捗リセット完了")
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // 進捗読み込み
  let doneIds = new Set()
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      const prog = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"))
      doneIds = new Set(prog.doneIds || [])
      console.log(`📂 前回の進捗を復元: ${doneIds.size} 件処理済み`)
    } catch {}
  }

  // 商品データ取得（image_url が空のものだけ）
  console.log("📦 商品データ取得中...")
  let all = []
  let from = 0
  while (true) {
    const { data } = await supabase
      .from("products")
      .select("id, name, manufacturer")
      .or("image_url.is.null,image_url.eq.")
      .order("manufacturer", { ascending: true })
      .order("name",         { ascending: true })
      .range(from, from + 999)
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < 1000) break
    from += 1000
  }
  console.log(`✅ 取得: ${all.length} 件`)

  const targets = all.filter(p => !doneIds.has(p.id))
  console.log(`🎯 処理対象: ${targets.length} 件（スキップ: ${doneIds.size} 件）\n`)

  if (targets.length === 0) {
    console.log("すべて処理済みです。")
    return
  }

  // ログCSV
  const logStream = fs.createWriteStream(LOG_FILE, { flags: doneIds.size === 0 ? "w" : "a" })
  if (doneIds.size === 0) logStream.write("id,name,manufacturer,image_url,score\n")

  let processed = 0, found = 0, notFound = 0, errors = 0
  const startTime = Date.now()

  for (const product of targets) {
    const query = [product.manufacturer, product.name].filter(Boolean).join(" ")

    let imageUrl = ""
    let scoreVal = 0
    try {
      const results = await searchDDG(query)
      if (results.length > 0) {
        const best = pickBest(results, product.manufacturer, product.name)
        if (best) {
          imageUrl = best
          // スコア再計算（ログ用）
          const topN = results.slice(0, TOP_N)
          const scored = topN.map(r => ({ ...r, _score: scoreImage(r, product.manufacturer, product.name) }))
          scored.sort((a, b) => b._score - a._score)
          scoreVal = scored[0]._score
          found++
        } else {
          notFound++
        }
      } else {
        notFound++
      }
    } catch (e) {
      errors++
      console.error(`  ❌ [${product.id.slice(0,8)}] ${query.slice(0,40)} → ${e.message}`)
    }

    // Supabase 更新（空文字の場合もマーク）
    await supabase.from("products")
      .update({ image_url: imageUrl || "" })
      .eq("id", product.id)

    // ログ書き込み
    const safeName = `"${(product.name || "").replace(/"/g, '""')}"`
    const safeMfr  = `"${(product.manufacturer || "").replace(/"/g, '""')}"`
    const safeUrl  = `"${imageUrl.replace(/"/g, '""')}"`
    logStream.write(`${product.id},${safeName},${safeMfr},${safeUrl},${scoreVal}\n`)

    doneIds.add(product.id)
    processed++

    // 進捗ログ（10件ごと）
    if (processed % 10 === 0) {
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ doneIds: [...doneIds] }))
      const pct     = ((doneIds.size / all.length) * 100).toFixed(1)
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
      const eta     = targets.length > processed
        ? Math.round(((Date.now() - startTime) / processed) * (targets.length - processed) / 1000)
        : 0
      console.log(
        `[${pct}%] ${processed}/${targets.length}件` +
        ` | 画像あり:${found} なし:${notFound} エラー:${errors}` +
        ` | 経過:${elapsed}s 残り:${eta}s`
      )
    }

    await sleep(jitter())
  }

  logStream.end()
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ doneIds: [...doneIds] }))

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log("\n🎉 完了!")
  console.log(`  処理: ${processed}件 | 画像あり: ${found}件 | なし: ${notFound}件 | エラー: ${errors}件`)
  console.log(`  所要時間: ${elapsed}s`)
  console.log(`  ログ: ${LOG_FILE}`)
}

main().catch(err => { console.error("予期せぬエラー:", err); process.exit(1) })
