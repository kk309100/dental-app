// 自社印影（CSS で作成、印刷対応）
// 朱印風の赤い円形ハンコ
//
// usage:
//   <Seal />              // デフォルト「清新」
//   <Seal text="清新" />   // テキスト指定
//   <Seal size={50} />    // サイズ指定（px、デフォルト60）

import { COMPANY } from "@/lib/company"

export default function Seal({ text, size = 60 }: { text?: string; size?: number }) {
  // 会社名から漢字2-3文字を抽出（例: "株式会社 清新" → "清新"）
  const defaultText = (() => {
    const stripped = COMPANY.name.replace(/株式会社|有限会社|合同会社|医療法人|社団法人/g, "").trim().replace(/\s+/g, "")
    return stripped.slice(0, 3) || "印"
  })()
  const displayText = text || defaultText
  const fontSize = displayText.length === 1 ? size * 0.5 : displayText.length === 2 ? size * 0.4 : size * 0.32

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        border: `${Math.max(2, size / 30)}px solid #c8102e`,
        color: "#c8102e",
        fontFamily: "'Noto Serif JP', 'Yu Mincho', 'YuMincho', serif",
        fontWeight: 700,
        fontSize,
        letterSpacing: displayText.length > 1 ? "-0.05em" : 0,
        // 印刷時に色が出るよう
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
        // 朱肉感（少し回転 + 透過）
        transform: "rotate(-3deg)",
        opacity: 0.92,
        flexShrink: 0,
      }}
    >
      {displayText}
    </div>
  )
}
