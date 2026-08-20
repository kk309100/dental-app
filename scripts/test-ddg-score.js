// 数件だけテスト実行してスコアリングを確認
const { createClient } = require("@supabase/supabase-js")

const SUPABASE_URL         = "https://alcetorurdocopxatego.supabase.co"
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function searchDDG(query) {
  const r1 = await fetch(
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=images&iax=images`,
    { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) }
  )
  const html = await r1.text()
  const m = html.match(/vqd="([^"]+)"/) || html.match(/vqd=([0-9-]+)/)
  if (!m) return []
  await sleep(500)
  const params = new URLSearchParams({ q: query, vqd: m[1], o: "json", p: "-1", s: "0", u: "bing", f: ",,,,," })
  const r2 = await fetch(
    `https://duckduckgo.com/i.js?${params}`,
    { headers: { "User-Agent": UA, "Referer": "https://duckduckgo.com/" }, signal: AbortSignal.timeout(12000) }
  )
  if (!r2.ok) return []
  const json = await r2.json()
  return json.results || []
}

function scoreImage(result, manufacturer, name) {
  let score = 0
  const url    = (result.image  || "").toLowerCase()
  const source = (result.source || result.url || "").toLowerCase()
  const w = result.width  || 0
  const h = result.height || 0
  const mfr = (manufacturer || "").toLowerCase().replace(/\s/g, "")

  if (w > 0 && h > 0) {
    const ratio = Math.min(w, h) / Math.max(w, h)
    score += Math.round(ratio * 20)
    if (Math.min(w, h) >= 300) score += 15
    if (Math.min(w, h) >= 500) score += 10
    if (Math.max(w, h) < 100)  score -= 40
    if (Math.max(w, h) >= 100 && Math.max(w, h) <= 2500) score += 5
  }
  const officialDomains = ["gc.dental","gc-dental","gcdental","gc.co.jp","shofu","tokuyama-dental","kuraray","morita.com","ydm.co.jp","yoshida-dental","dentsply","ivoclar","3m.com","bsa-sakurai","mani.co.jp","lion-dental","sunstar","nakanishi-dental","dente.co.jp"]
  for (const d of officialDomains) {
    if (url.includes(d) || source.includes(d)) { score += 50; break }
  }
  const dentalShops = ["shop.pdr","denta-tec","dental","medicom","shika-shop","whitedental"]
  for (const d of dentalShops) {
    if (url.includes(d) || source.includes(d)) { score += 25; break }
  }
  if (url.includes("thumbnail.image.rakuten") || url.includes("tshop.r10s")) score += 20
  if (url.includes("images-amazon") || url.includes("m.media-amazon"))       score += 20
  if (mfr.length >= 3 && (url.includes(mfr.slice(0, 4)) || source.includes(mfr.slice(0, 4)))) score += 15
  if (/logo|banner|icon|avatar|button|sprite/.test(url)) score -= 30
  if (/\.(jpg|jpeg|png|webp)(\?|$|&)/.test(url)) score += 5
  if (/\.gif(\?|$)/.test(url)) score -= 15
  return score
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

  // テスト用に5件取得
  const { data } = await supabase
    .from("products")
    .select("id, name, manufacturer")
    .or("image_url.is.null,image_url.eq.")
    .order("manufacturer")
    .limit(5)

  for (const p of data || []) {
    const query = [p.manufacturer, p.name].filter(Boolean).join(" ")
    console.log(`\n━━ ${p.manufacturer} / ${p.name}`)
    console.log(`   検索: "${query}"`)

    const results = await searchDDG(query)
    if (results.length === 0) { console.log("   → 結果なし"); continue }

    const scored = results.slice(0, 5).map(r => ({
      url:   (r.image || "").slice(0, 70),
      size:  `${r.width}x${r.height}`,
      score: scoreImage(r, p.manufacturer, p.name),
    }))
    scored.sort((a, b) => b.score - a.score)

    scored.forEach((s, i) => {
      const mark = i === 0 ? "★選定" : `  ${i + 1}位`
      console.log(`   ${mark} [スコア:${s.score}] ${s.size} ${s.url}`)
    })

    await sleep(1800)
  }
}

main().catch(console.error)
