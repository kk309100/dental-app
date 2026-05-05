-- 医院の決済方法カラム追加
-- "振込" / "カード" / "現金" / "口座引落" / "その他"
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS payment_method text DEFAULT '振込';

-- 既知のカード決済医院を初期設定（部分一致）
UPDATE clinics SET payment_method = 'カード'
WHERE name LIKE '%清翔会%'
   OR name LIKE '%正翔会%'
   OR name LIKE '%名古屋みなと歯科%'
   OR name LIKE '%とみ歯科%'
   OR corporate_name LIKE '%清翔会%'
   OR corporate_name LIKE '%正翔会%';
