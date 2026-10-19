// 「在庫管理しない」商品（パソコン関係・工事費など、在庫を持たない商品）の扱い。
// products.stock_managed が false の商品は、在庫が常に足りているものとして扱い、入荷・発注の対象にもしない。
// 在庫の数が「足りるか」で判定する既存の処理を変えずに済むよう、読み込んだ商品の在庫を、十分に大きい数に置き換える（画面の中だけで、DBは変えない）。
export const NO_STOCK_LIMIT = 1_000_000_000

export function withStockFlag<T extends { stock: number | null; stock_managed?: boolean | null }>(rows: T[] | null | undefined): T[] {
  return (rows || []).map(p => (p.stock_managed === false ? { ...p, stock: NO_STOCK_LIMIT } : p))
}

export function isNoStock(p: { stock_managed?: boolean | null } | null | undefined): boolean {
  return !!p && p.stock_managed === false
}
