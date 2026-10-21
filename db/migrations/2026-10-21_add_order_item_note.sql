-- 注文の明細（商品ごと）に、備考を書けるようにする。納品書・請求明細書・注文管理に表示される。
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS note text;
