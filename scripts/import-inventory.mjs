/**
 * 棚卸表 5月.xlsx → Supabase 在庫インポートスクリプト
 *
 * マッチング順序:
 *   1) product_code（商品コード）が一致
 *   2) 商品名が完全一致（半角カナ→全角正規化後）
 *   3) 商品名が部分一致（先頭20文字）
 *
 * 更新フィールド: stock（棚卸数量）, cost（単価）
 *
 * 使い方:
 *   node scripts/import-inventory.mjs [--dry-run]
 *   --dry-run: DBを更新せず照合結果だけ表示
 */

import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const SUPABASE_URL     = "https://alcetorurdocopxatego.supabase.co"
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE)
const DRY_RUN  = process.argv.includes("--dry-run")

// 半角カナ → 全角カナ 変換テーブル
const HANKAKU_MAP = {
  "ｦ":"ヲ","ｧ":"ァ","ｨ":"ィ","ｩ":"ゥ","ｪ":"ェ","ｫ":"ォ","ｬ":"ャ","ｭ":"ュ","ｮ":"ョ",
  "ｯ":"ッ","ｰ":"ー","ｱ":"ア","ｲ":"イ","ｳ":"ウ","ｴ":"エ","ｵ":"オ","ｶ":"カ","ｷ":"キ",
  "ｸ":"ク","ｹ":"ケ","ｺ":"コ","ｻ":"サ","ｼ":"シ","ｽ":"ス","ｾ":"セ","ｿ":"ソ","ﾀ":"タ",
  "ﾁ":"チ","ﾂ":"ツ","ﾃ":"テ","ﾄ":"ト","ﾅ":"ナ","ﾆ":"ニ","ﾇ":"ヌ","ﾈ":"ネ","ﾉ":"ノ",
  "ﾊ":"ハ","ﾋ":"ヒ","ﾌ":"フ","ﾍ":"ヘ","ﾎ":"ホ","ﾏ":"マ","ﾐ":"ミ","ﾑ":"ム","ﾒ":"メ",
  "ﾓ":"モ","ﾔ":"ヤ","ﾕ":"ユ","ﾖ":"ヨ","ﾗ":"ラ","ﾘ":"リ","ﾙ":"ル","ﾚ":"レ","ﾛ":"ロ",
  "ﾜ":"ワ","ﾝ":"ン","ﾞ":"゛","ﾟ":"゜",
  "ｶﾞ":"ガ","ｷﾞ":"ギ","ｸﾞ":"グ","ｹﾞ":"ゲ","ｺﾞ":"ゴ","ｻﾞ":"ザ","ｼﾞ":"ジ","ｽﾞ":"ズ",
  "ｾﾞ":"ゼ","ｿﾞ":"ゾ","ﾀﾞ":"ダ","ﾁﾞ":"ヂ","ﾂﾞ":"ヅ","ﾃﾞ":"デ","ﾄﾞ":"ド","ﾊﾞ":"バ",
  "ﾋﾞ":"ビ","ﾌﾞ":"ブ","ﾍﾞ":"ベ","ﾎﾞ":"ボ","ﾊﾟ":"パ","ﾋﾟ":"ピ","ﾌﾟ":"プ","ﾍﾟ":"ペ","ﾎﾟ":"ポ",
  "ｳﾞ":"ヴ",
}

function toFullKana(str) {
  // 濁点・半濁点の合成を先に処理
  let s = str
  for (const [h, f] of Object.entries(HANKAKU_MAP)) {
    if (h.length === 2) s = s.replaceAll(h, f)
  }
  for (const [h, f] of Object.entries(HANKAKU_MAP)) {
    if (h.length === 1) s = s.replaceAll(h, f)
  }
  return s
}

function normalize(name) {
  return toFullKana(name ?? "")
    .trim()
    .toLowerCase()
    // 単位・記号の表記ゆれを統一
    .replace(/㎖/g, "ml")
    .replace(/㎎/g, "mg")
    .replace(/㎝/g, "cm")
    .replace(/㎞/g, "km")
    .replace(/㎜/g, "mm")
    .replace(/㎡/g, "m2")
    .replace(/×/g, "x")
    .replace(/　/g, " ")           // 全角スペース→半角
    .replace(/ +/g, " ")           // 連続スペース→1つ
    .replace(/[‐－―ｰ]/g, "-")    // 各種ダッシュ→ハイフン
    .trim()
}

async function fetchAllProducts() {
  const all = []
  const CHUNK = 1000
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from("products")
      .select("id, name, product_code, manufacturer, stock, cost")
      .range(from, from + CHUNK - 1)
    if (error) { console.error("Supabase error:", error.message); break }
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < CHUNK) break
    from += CHUNK
  }
  return all
}

async function main() {
  console.log(DRY_RUN ? "🔍 ドライランモード（DBは更新しません）\n" : "🚀 インポート開始\n")

  // inventory.json 読み込み
  const jsonPath = join(dirname(fileURLToPath(import.meta.url)), "../../Downloads/inventory.json")
  const inventory = JSON.parse(readFileSync(jsonPath, "utf8"))
  console.log(`📋 棚卸データ: ${inventory.length} 件`)

  // Supabase 全商品取得
  const products = await fetchAllProducts()
  console.log(`📦 DB商品数: ${products.length} 件\n`)

  // 検索用インデックス作成（名前のみでマッチング）
  const byName    = new Map()   // normalize(name) → product（完全一致）
  const byPrefix  = new Map()   // normalize(name).slice(0,15) → product（前方一致）
  for (const p of products) {
    const nk = normalize(p.name)
    if (!byName.has(nk)) byName.set(nk, p)
    const pk = nk.slice(0, 15)
    if (!byPrefix.has(pk)) byPrefix.set(pk, p)
  }

  let matched   = 0
  let unmatched = 0
  const unmatchedList = []
  const updates = []

  for (const item of inventory) {
    const excelName = normalize(item.name)

    let product = null
    let matchBy = ""

    // 1) 商品名 完全一致
    if (byName.has(excelName)) {
      product = byName.get(excelName)
      matchBy = "完全一致"
    }
    // 2) 一方の名前がもう一方の先頭と完全に一致（25文字以上）
    if (!product && excelName.length >= 25) {
      if (byPrefix.has(excelName.slice(0, 15))) {
        const candidate = byPrefix.get(excelName.slice(0, 15))
        const ck = normalize(candidate.name)
        // Excel名がDB名のprefixか、DB名がExcel名のprefixのとき採用
        if (excelName.startsWith(ck) || ck.startsWith(excelName)) {
          product = candidate
          matchBy = "前方一致"
        }
      }
    }

    if (product) {
      matched++
      console.log(`  ✅ [${matchBy}] ${item.name} → ${product.name} | 在庫: ${product.stock ?? "?"} → ${item.stock} | 単価: ${product.cost ?? "?"} → ${item.cost}`)
      updates.push({ id: product.id, stock: item.stock, cost: item.cost || product.cost })
    } else {
      unmatched++
      unmatchedList.push(item)
      console.log(`  ❌ 未一致: ${item.name}（コード: ${item.code}、メーカー: ${item.manufacturer}）`)
    }
  }

  console.log(`\n📊 照合結果: 一致 ${matched}件 / 未一致 ${unmatched}件\n`)

  if (DRY_RUN) {
    console.log("ドライランのため更新はスキップします。")
    if (unmatchedList.length > 0) {
      console.log("\n未一致リスト:")
      unmatchedList.forEach(i => console.log(`  - [${i.code}] ${i.manufacturer} / ${i.name}`))
    }
    return
  }

  // DB更新（バッチ処理）
  console.log("💾 DB更新中...")
  let ok = 0, ng = 0
  for (const u of updates) {
    const { error } = await supabase
      .from("products")
      .update({ stock: u.stock, ...(u.cost ? { cost: u.cost } : {}) })
      .eq("id", u.id)
    if (error) {
      console.error(`  ✗ ${u.id}: ${error.message}`)
      ng++
    } else {
      ok++
    }
  }

  console.log(`\n✅ 更新完了: 成功 ${ok}件 / 失敗 ${ng}件`)

  if (unmatchedList.length > 0) {
    console.log(`\n⚠️  未一致（DB未更新）: ${unmatchedList.length}件`)
    unmatchedList.forEach(i => console.log(`  - [${i.code}] ${i.manufacturer} / ${i.name}`))
  }
}

main().catch(console.error)
