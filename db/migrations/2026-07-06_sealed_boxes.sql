-- 棚卸用：未開封箱数（本部提出用。日常の在庫数とは独立）
ALTER TABLE clinic_inventory_items
  ADD COLUMN IF NOT EXISTS sealed_boxes integer;
