-- 消費税の端数処理（四捨五入 / 切り捨て / 切り上げ）を、自社情報設定で選べるようにする。
-- round=四捨五入（初期値） / floor=切り捨て / ceil=切り上げ
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS tax_rounding text DEFAULT 'round';
