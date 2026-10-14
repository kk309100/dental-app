// ローマ字（半角英字）をカタカナに変える。日本語入力に切り替えずに「wantafuto」と打っても商品が探せるようにするための簡易変換。
// 変換できない文字が混ざる語は null を返す（英語の商品名「systema」などを誤って変換しない）。
const BASE: Record<string, string> = {
  a: "ア", i: "イ", u: "ウ", e: "エ", o: "オ",
  ka: "カ", ki: "キ", ku: "ク", ke: "ケ", ko: "コ",
  sa: "サ", si: "シ", shi: "シ", su: "ス", se: "セ", so: "ソ",
  ta: "タ", ti: "チ", chi: "チ", tu: "ツ", tsu: "ツ", te: "テ", to: "ト",
  na: "ナ", ni: "ニ", nu: "ヌ", ne: "ネ", no: "ノ",
  ha: "ハ", hi: "ヒ", hu: "フ", fu: "フ", he: "ヘ", ho: "ホ",
  ma: "マ", mi: "ミ", mu: "ム", me: "メ", mo: "モ",
  ya: "ヤ", yu: "ユ", yo: "ヨ",
  ra: "ラ", ri: "リ", ru: "ル", re: "レ", ro: "ロ",
  wa: "ワ", wo: "ヲ",
  ga: "ガ", gi: "ギ", gu: "グ", ge: "ゲ", go: "ゴ",
  za: "ザ", zi: "ジ", ji: "ジ", zu: "ズ", ze: "ゼ", zo: "ゾ",
  da: "ダ", di: "ヂ", du: "ヅ", de: "デ", do: "ド",
  ba: "バ", bi: "ビ", bu: "ブ", be: "ベ", bo: "ボ",
  pa: "パ", pi: "ピ", pu: "プ", pe: "ペ", po: "ポ",
  fa: "ファ", fi: "フィ", fe: "フェ", fo: "フォ",
  va: "ヴァ", vi: "ヴィ", vu: "ヴ", ve: "ヴェ", vo: "ヴォ",
  la: "ラ", li: "リ", lu: "ル", le: "レ", lo: "ロ",
  kya: "キャ", kyu: "キュ", kyo: "キョ", sha: "シャ", shu: "シュ", sho: "ショ", sya: "シャ", syu: "シュ", syo: "ショ",
  cha: "チャ", chu: "チュ", cho: "チョ", tya: "チャ", tyu: "チュ", tyo: "チョ",
  nya: "ニャ", nyu: "ニュ", nyo: "ニョ", hya: "ヒャ", hyu: "ヒュ", hyo: "ヒョ",
  mya: "ミャ", myu: "ミュ", myo: "ミョ", rya: "リャ", ryu: "リュ", ryo: "リョ",
  gya: "ギャ", gyu: "ギュ", gyo: "ギョ", ja: "ジャ", ju: "ジュ", jo: "ジョ", zya: "ジャ", zyu: "ジュ", zyo: "ジョ",
  bya: "ビャ", byu: "ビュ", byo: "ビョ", pya: "ピャ", pyu: "ピュ", pyo: "ピョ",
  tsa: "ツァ", thi: "ティ", dhi: "ディ", she: "シェ", che: "チェ", je: "ジェ",
  wi: "ウィ", we: "ウェ",
}

export function romajiToKatakana(word: string): string | null {
  const s = word.toLowerCase()
  if (!/^[a-z'-]+$/.test(s)) return null
  let out = "", i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === "-") { out += "ー"; i++; continue }
    if (c === "'") { i++; continue }
    // 促音: 子音の連続（kk, tt など）
    if (i + 1 < s.length && c === s[i + 1] && !"aiueon".includes(c)) { out += "ッ"; i++; continue }
    // 撥音: n の後が母音・y でなければ「ン」。nn も「ン」
    if (c === "n") {
      const nx = s[i + 1]
      if (nx === "n") { out += "ン"; i += 2; continue }
      if (!nx || !"aiueoy".includes(nx)) { out += "ン"; i++; continue }
    }
    let hit = ""
    for (const len of [3, 2, 1]) {
      const k = s.slice(i, i + len)
      if (k.length === len && BASE[k]) { hit = k; break }
    }
    if (!hit) return null
    out += BASE[hit]; i += hit.length
  }
  return out
}
