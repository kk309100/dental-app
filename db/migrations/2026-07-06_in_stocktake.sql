-- 棚卸し対象フラグ（手動追加=true, 一括インポート=false）
ALTER TABLE clinic_inventory_items
  ADD COLUMN IF NOT EXISTS in_stocktake boolean NOT NULL DEFAULT true;
