// 「在庫分発注用」の医院（医院コード 100）。自社の在庫を補充するための注文なので、
// 在庫の数に関係なく、注文数をそのまま発注する。
export const STOCK_ORDER_CLINIC_CODE = "100"

export function isStockOrderClinic(c: { name?: string | null; clinic_code?: string | null } | null | undefined): boolean {
  if (!c) return false
  return String(c.clinic_code || "").trim() === STOCK_ORDER_CLINIC_CODE || String(c.name || "").includes("在庫分発注用")
}
