/**
 * fetch-product-images.js
 *
 * Google Custom Search API を使って商品画像URLを取得し、
 * Supabase の image_url 更新用 CSV を生成するスクリプト。
 *
 * 実行方法:
 *   node scripts/fetch-product-images.js
 *
 * 出力:
 *   scripts/product_images.csv     — id,image_url の CSV
 *   scripts/fetch_progress.json    — 中断・再開用の進捗ファイル
 */

const { createClient } = require("@supabase/supabase-js")
const fs   = require("fs")
const path = require("path")

// ── 設定 ─────────────────────────────────────────────────────────
const SUPABASE_URL         = "https://alcetorurdocopxatego.supabase.co"
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const GOOGLE_API_KEY       = "AIzaSyDwmojqHiFQo4EwkELn58cJlIHWLZuMyB8"
const GOOGLE_CX            = "d5248059a8c174c01"

const OUTPUT_CSV     = path.join(__dirname, "product_images.csv")
const PROGRESS_FILE  = path.join(__dirname, "fetch_progress.json")

const DELAY_MS       = 200   // 1リクエスト間隔 (ms) → 5req/sec
const PAGE_SIZE      = 1000  // Supabase 取得ページサイズ
// ──────────────────────────────────────────────────────────────────

/** Google Custom Search Image Search */
async function searchImage(query) {
  const params = new URLSearchParams({
    key:        GOOGLE_API_KEY,
    cx:         GOOGLE_CX,
    searchType: "image",
    q:          query,
    num:        "1",
    imgType:    "photo",
    safe:       "off",
  })
  const res = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`, {
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const msg = body?.error?.message || res.statusText
    throw Object.assign(new Error(msg), { status: res.status, body })
  }
  const json = await res.json()
  return json.items?.[0]?.link ?? null
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function escapeCsv(str) {
  if (str == null) return ""
  return `"${String(str).replace(/"/g, '""')}"`
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── 進捗ファイル読み込み（中断再開対応） ──
  let doneIds = new Set()
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      const prog = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"))
      doneIds = new Set(prog.doneIds || [])
      console.log(`📂 前回の進捗を復元: ${doneIds.size} 件処理済み`)
    } catch { /* 壊れていたら無視 */ }
  }

  // ── Supabase から商品データ全件取得 ──
  console.log("📦 Supabase から商品データを取得中...")
  let allProducts = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from("products")
      .select("id, name, manufacturer")
      .range(from, from + PAGE_SIZE - 1)
      .order("id")
    if (error) {
      console.error("❌ Supabase エラー:", error.message)
      process.exit(1)
    }
    if (!data || data.length === 0) break
    allProducts = allProducts.concat(data)
    console.log(`   取得中... ${allProducts.length} 件`)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  console.log(`✅ 合計 ${allProducts.length} 件取得完了\n`)

  // 未処理の商品のみ対象
  const targets = allProducts.filter(p => !doneIds.has(p.id))
  console.log(`🎯 処理対象: ${targets.length} 件（処理済みスキップ: ${doneIds.size} 件）`)

  if (targets.length === 0) {
    console.log("✅ すべて処理済みです。CSV を確認してください。")
    return
  }

  // ── CSV 準備 ──
  const isFirstRun = doneIds.size === 0
  const csvStream = fs.createWriteStream(OUTPUT_CSV, { flags: isFirstRun ? "w" : "a" })
  if (isFirstRun) {
    csvStream.write("id,image_url\n")
  }

  let processed = 0
  let found     = 0
  let notFound  = 0
  let errCount  = 0
  const startTime = Date.now()

  for (const product of targets) {
    const query = [product.manufacturer, product.name].filter(Boolean).join(" ")

    let imageUrl = ""
    try {
      imageUrl = (await searchImage(query)) ?? ""
      if (imageUrl) {
        found++
      } else {
        notFound++
      }
    } catch (e) {
      errCount++
      const status = e.status ?? 0

      if (status === 429 || (e.body?.error?.errors?.[0]?.reason === "rateLimitExceeded")) {
        // 無料枠超過（100件/日）
        console.log("\n⚠️  API の無料枠（100件/日）に達しました。")
        console.log("   → 明日また実行するか、GCP で課金を有効化してください。")
        console.log("   → 進捗は保存済みです。再実行すると続きから再開します。\n")
        csvStream.end()
        saveProgress(doneIds)
        printSummary(processed, found, notFound, errCount, startTime)
        return
      }
      console.error(`  ⚠ [${product.id}] ${query.slice(0, 40)} → ${e.message}`)
    }

    // CSV 書き込み
    csvStream.write(`${product.id},${escapeCsv(imageUrl)}\n`)
    doneIds.add(product.id)
    processed++

    // 10件ごとにログ & 進捗保存
    if (processed % 10 === 0) {
      saveProgress(doneIds)
      const pct  = ((doneIds.size / allProducts.length) * 100).toFixed(1)
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
      console.log(
        `[${pct}%] ${doneIds.size}/${allProducts.length} 件` +
        ` | 画像あり: ${found}  なし: ${notFound}  エラー: ${errCount}` +
        ` | 経過: ${elapsed}s`
      )
    }

    await sleep(DELAY_MS)
  }

  csvStream.end()
  saveProgress(doneIds)
  console.log("\n🎉 完了!")
  printSummary(processed, found, notFound, errCount, startTime)
  console.log(`📄 CSV 出力先: ${OUTPUT_CSV}`)
}

function saveProgress(doneIds) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ doneIds: [...doneIds] }, null, 2))
}

function printSummary(processed, found, notFound, errCount, startTime) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n  処理件数 : ${processed}`)
  console.log(`  画像あり : ${found}`)
  console.log(`  画像なし : ${notFound}`)
  console.log(`  エラー   : ${errCount}`)
  console.log(`  所要時間 : ${elapsed}s`)
}

main().catch(err => {
  console.error("❌ 予期せぬエラー:", err)
  process.exit(1)
})
