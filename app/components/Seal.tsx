// 自社印影
// /public/seal.png を表示。透過PNG推奨（500x500想定、正方形）
//
// usage:
//   <Seal />              // デフォルト60px
//   <Seal size={50} />    // サイズ指定（px）

export default function Seal({ size = 60 }: { size?: number }) {
  return (
    <img
      src="/seal.png"
      alt="株式会社 清新 印影"
      width={size}
      height={size}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        objectFit: "contain",
        // 印刷時に色が出るよう
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
        flexShrink: 0,
      }}
    />
  )
}
