-- 在庫管理テーブルに入数カラムを追加
-- category カラムはすでに存在する想定。存在しない場合はコメントアウトを外してください。

ALTER TABLE clinic_inventory_items
  ADD COLUMN IF NOT EXISTS units_per_package integer;

-- category が未作成の場合はこちらも実行
-- ALTER TABLE clinic_inventory_items
--   ADD COLUMN IF NOT EXISTS category text;
