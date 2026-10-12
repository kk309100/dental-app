// デモ環境（NEXT_PUBLIC_DEMO_MODE=1 のプロジェクト）でだけ表示する、画面上部の目印の帯。
// 本番の画面と取り違えないため。ダミーのデータであることを、常に見えるようにする。
export default function DemoBanner() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "1") return null
  return (
    <div
      className="no-print"
      style={{
        position: "sticky", top: 0, zIndex: 100000,
        background: "#f59e0b", color: "#1f2937", textAlign: "center",
        fontSize: 13, fontWeight: 800, padding: "6px 12px", lineHeight: 1.4,
      }}
    >
      🧪 これはデモ環境です。表示されているデータは、すべて架空のダミーです。
    </div>
  )
}
