-- 「在庫管理しない」商品（パソコン関係・工事費など）を扱えるようにする。
-- stock_managed = false の商品は、在庫の不足・入荷・発注の対象にならず、納品しても在庫を引かない。
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_managed boolean DEFAULT true;
