// 医院の支払方法を視覚的に表示するバッジ
// clinics.payment_method = "振込" | "カード" | "現金" | "口座引落" | "その他" | null

const STYLES: Record<string, { icon: string; label: string; bg: string; color: string; border: string }> = {
  "カード":   { icon: "💳", label: "カード",   bg: "#fee2e2", color: "#b91c1c", border: "#fca5a5" },
  "振込":     { icon: "🏦", label: "振込",     bg: "#dbeafe", color: "#1e40af", border: "#93c5fd" },
  "現金":     { icon: "💵", label: "現金",     bg: "#dcfce7", color: "#15803d", border: "#86efac" },
  "口座引落": { icon: "🏧", label: "口座引落", bg: "#f3e8ff", color: "#6b21a8", border: "#d8b4fe" },
  "その他":   { icon: "❔", label: "その他",   bg: "#f3f4f6", color: "#6b7280", border: "#d1d5db" },
}

const DEFAULT_STYLE = STYLES["振込"]

export default function PaymentBadge({
  method,
  size = "sm",
  showLabel = true,
}: {
  method: string | null | undefined
  size?: "xs" | "sm" | "md"
  showLabel?: boolean
}) {
  if (!method) return <span style={{ fontSize: 10, color: "#9ca3af" }}>—</span>
  const style = STYLES[method] || DEFAULT_STYLE
  const fontSize = size === "xs" ? 9 : size === "md" ? 12 : 10
  const padding = size === "xs" ? "1px 4px" : size === "md" ? "3px 8px" : "1.5px 6px"
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 2,
      fontSize,
      padding,
      borderRadius: 99,
      background: style.bg,
      color: style.color,
      border: `1px solid ${style.border}`,
      fontWeight: 700,
      whiteSpace: "nowrap",
    }}>
      <span>{style.icon}</span>
      {showLabel && <span>{style.label}</span>}
    </span>
  )
}
