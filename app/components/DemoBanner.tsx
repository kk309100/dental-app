// 本番ではない環境でだけ表示する、画面上部の目印の帯。本番の画面と取り違えないため。
// - NEXT_PUBLIC_ENV_LABEL に文字を入れた環境: その文字を表示（例: 「やり直し用の環境です。本番ではありません」）
// - NEXT_PUBLIC_DEMO_MODE=1 の環境: デモ用の文言を表示
// どちらも未設定（本番）のときは、何も表示しない。
export default function DemoBanner() {
  const label = (process.env.NEXT_PUBLIC_ENV_LABEL || "").trim()
  const demo = process.env.NEXT_PUBLIC_DEMO_MODE === "1"
  if (!label && !demo) return null
  const text = label ? `🧪 ${label}` : "🧪 これはデモ環境です。表示されているデータは、すべて架空のダミーです。"
  return (
    <div
      className="no-print"
      style={{
        position: "sticky", top: 0, zIndex: 100000,
        background: label ? "#7c3aed" : "#f59e0b", color: label ? "#fff" : "#1f2937", textAlign: "center",
        fontSize: 13, fontWeight: 800, padding: "6px 12px", lineHeight: 1.4,
      }}
    >
      {text}
    </div>
  )
}
