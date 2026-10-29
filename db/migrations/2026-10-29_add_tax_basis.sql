-- 請求書の消費税を出す単位（invoice = 請求書ごとに1回 / slip = 納品書ごとに出して合計）
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS tax_basis text DEFAULT 'invoice';
NOTIFY pgrst, 'reload schema';
