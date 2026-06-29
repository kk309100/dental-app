-- 在庫管理テーブルに入数カラムを追加
ALTER TABLE clinic_inventory_items
  ADD COLUMN IF NOT EXISTS units_per_package integer;

-- カテゴリマスターテーブル（医院ごとにカテゴリを事前登録）
CREATE TABLE IF NOT EXISTS inventory_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  uuid NOT NULL,
  name       text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (clinic_id, name)
);
