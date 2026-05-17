// 注文ステータスの正規化ヘルパー
// DB に「納品済」（み無し）と「納品済み」（み有り）の両方が混在している可能性があるため、
// フィルタリング時は両方を等価に扱う必要がある（書き込み時は常に「納品済み」を使う）。

export const DELIVERED_STATUSES = ["納品済み", "納品済"] as const
export const CANCELLED_STATUSES = ["キャンセル", "取消"] as const
export const FINISHED_STATUSES = [...DELIVERED_STATUSES, ...CANCELLED_STATUSES] as const

export const isDelivered = (status: string | null | undefined): boolean =>
  !!status && (DELIVERED_STATUSES as readonly string[]).includes(status)

export const isCancelled = (status: string | null | undefined): boolean =>
  !!status && (CANCELLED_STATUSES as readonly string[]).includes(status)

export const isFinished = (status: string | null | undefined): boolean =>
  !!status && (FINISHED_STATUSES as readonly string[]).includes(status)

export const isUndelivered = (status: string | null | undefined): boolean => !isFinished(status)
