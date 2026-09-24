// 自社管理在庫の商品であることを示す小さなタグ
// products.location = "自社管理" のときだけ表示する
// （在庫管理画面の「🏷 自社管理在庫のみ」フィルタと同じ判定基準）

export default function ManagedBadge({ location }: { location: string | null | undefined }) {
  if (location !== "自社管理") return null
  return (
    <span
      title="自社管理在庫の商品です"
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 9,
        padding: "1px 5px",
        borderRadius: 99,
        background: "#e0f2fe",
        color: "#0369a1",
        border: "1px solid #7dd3fc",
        fontWeight: 700,
        whiteSpace: "nowrap",
        marginLeft: 4,
      }}
    >
      🏷 自社管理
    </span>
  )
}
