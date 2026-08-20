const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function searchDDG(query) {
  const r1 = await fetch(
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=images&iax=images`,
    { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) }
  )
  const html = await r1.text()
  const m = html.match(/vqd="([^"]+)"/) || html.match(/vqd=([0-9-]+)/)
  if (!m) { console.log('vqd not found'); return [] }
  const vqd = m[1]
  console.log('vqd:', vqd)

  await sleep(600)

  const params = new URLSearchParams({ q: query, vqd, o: 'json', p: '-1', s: '0', u: 'bing', f: ',,,,,' })
  const r2 = await fetch(
    `https://duckduckgo.com/i.js?${params}`,
    { headers: { 'User-Agent': UA, 'Referer': 'https://duckduckgo.com/' }, signal: AbortSignal.timeout(10000) }
  )
  if (!r2.ok) { console.log('i.js error:', r2.status, await r2.text().catch(()=>'')); return [] }
  const json = await r2.json()
  return json.results || []
}

searchDDG('GC フジII LC 歯科').then(results => {
  console.log('取得件数:', results.length)
  results.slice(0, 5).forEach((r, i) => {
    console.log(`${i+1}. ${r.width}x${r.height} | ${(r.image||'').slice(0, 80)}`)
  })
}).catch(console.error)
