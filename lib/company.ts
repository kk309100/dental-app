// 自社情報（請求書・納品書に印字）
// 将来 company テーブルに移行する場合はここを差し替える

export const COMPANY = {
  name: "株式会社 清新",
  postalCode: "454-0812",
  address: "名古屋市中川区五月通2-37 黄金ステーションビル3階",
  phone: "052-526-3223",
  fax: "052-655-5977",
  email: "",
  representative: "代表取締役　小池拓未",
  invoiceNumber: "T4180001119611", // 適格請求書発行事業者登録番号
  bankName: "岐阜信用金庫",
  bankBranch: "名古屋支店",
  bankType: "普通",
  bankAccount: "1132391",
  bankHolder: "カ）セイシン",
  notes: "振込手数料は貴院負担でお願いいたします。",
} as const

export type Company = typeof COMPANY
