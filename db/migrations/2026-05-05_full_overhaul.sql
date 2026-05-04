-- ============================================================================
-- dental-app 全面整備マイグレーション (2026-05-05)
--
-- 監査で見つかった構造的な問題を一気に解消するためのスキーマ拡張。
-- Supabase Studio の SQL Editor で上から順に実行してください。
-- 各ブロックは IF NOT EXISTS / IF EXISTS で冪等にしてあるので、
-- 途中でこけても安全に再実行できます。
--
-- 影響テーブル:
--   orders, order_items, invoices, clinics, products, suppliers,
--   purchase_orders (新規), purchase_order_items (新規),
--   stock_movements (新規), stocktakes (新規), stocktake_items (新規),
--   audit_logs (新規), sales_reps (新規), invoice_payments (新規)
-- ============================================================================

-- 1. orders に各種タイムスタンプ・営業マン・キャンセル理由
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS prepared_at  timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sales_rep text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source text DEFAULT 'admin'; -- admin / online / sales / phone

-- 既存の納品済みデータには delivered_at を created_at で埋め戻し（とりあえず）
UPDATE orders SET delivered_at = created_at WHERE status = '納品済み' AND delivered_at IS NULL;

-- 2. order_items: 発注/出庫の状態を細かく
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS purchase_status text DEFAULT '未発注'; -- 未発注 / 部分発注 / 発注済 / 入荷済
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS purchased_at timestamptz;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS shipped_quantity numeric DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS purchase_order_item_id uuid;

-- 3. clinics の typo 修正＋拡張
ALTER TABLE clinics RENAME COLUMN adress TO address;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS payment_terms text DEFAULT '翌月末'; -- 当月末 / 翌月末 / 翌々月末 / 30日後 …
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS bank_account text; -- 医院別の振込先指定があれば
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS active boolean DEFAULT true; -- 取引停止フラグ
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES clinics(id); -- 統合先（法人化等）
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS note text;

-- 4. products: 廃番フラグ・税率・賞味期限管理
ALTER TABLE products ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_rate numeric DEFAULT 0.10; -- 0.10 = 10% / 0.08 = 軽減税率
ALTER TABLE products ADD COLUMN IF NOT EXISTS location text; -- 棚番号
ALTER TABLE products ADD COLUMN IF NOT EXISTS lot_managed boolean DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS expiry_managed boolean DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS default_supplier_id uuid REFERENCES suppliers(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS lead_time_days integer DEFAULT 7;
-- product_code に部分一意性（NULL は重複OK）
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_code ON products(product_code) WHERE product_code IS NOT NULL;

-- 5. suppliers: 取引停止・最低発注額・FAX 等
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS fax text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS lead_time_days integer DEFAULT 7;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS min_order_amount numeric DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS note text;

-- 6. invoices: 部分入金・支払条件・備考
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_period_start date;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_period_end date;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at timestamptz; -- メール送信日時
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_to text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS note text;
-- status は今までは 'issued' / 'paid' / 'cancelled' のみ → 'partial' を追加運用
-- （CHECK 制約は付けず文字列で運用）

-- 7. NEW: invoice_payments （部分入金・按分入金）
CREATE TABLE IF NOT EXISTS invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  paid_at timestamptz NOT NULL,
  amount numeric NOT NULL,
  method text DEFAULT '振込', -- 振込/現金/相殺/値引/手数料相殺
  note text,
  created_at timestamptz DEFAULT now(),
  created_by text
);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);
ALTER TABLE invoice_payments DISABLE ROW LEVEL SECURITY;

-- 8. NEW: purchase_orders（発注書ヘッダ）
CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text UNIQUE,
  supplier_id uuid REFERENCES suppliers(id),
  status text DEFAULT '下書き', -- 下書き/発注済/部分入荷/入荷済/取消
  ordered_at timestamptz,
  expected_at date,
  total_amount numeric DEFAULT 0,
  note text,
  created_at timestamptz DEFAULT now(),
  created_by text,
  sent_method text, -- FAX/メール/電話/その他
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
ALTER TABLE purchase_orders DISABLE ROW LEVEL SECURITY;

-- 9. NEW: purchase_order_items
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id),
  product_name text,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  received_quantity numeric DEFAULT 0,
  source_order_item_id uuid, -- 元になった注文明細（あれば）
  note text
);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(purchase_order_id);
ALTER TABLE purchase_order_items DISABLE ROW LEVEL SECURITY;

-- 10. NEW: stock_movements（在庫移動履歴 = 入庫/出庫/棚卸/破損/紛失）
CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  movement_type text NOT NULL, -- 入庫/出庫/棚卸調整/破損/紛失/返品
  quantity numeric NOT NULL,    -- 符号付き（-3 = 3個減）
  before_stock numeric,
  after_stock numeric,
  ref_type text, -- order_item / purchase_order_item / stocktake_item / manual
  ref_id uuid,
  reason text,
  occurred_at timestamptz DEFAULT now(),
  created_by text
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_occurred ON stock_movements(occurred_at);
ALTER TABLE stock_movements DISABLE ROW LEVEL SECURITY;

-- 11. NEW: stocktakes（棚卸ヘッダ）
CREATE TABLE IF NOT EXISTS stocktakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_on date NOT NULL,
  status text DEFAULT '進行中', -- 進行中/確定/取消
  note text,
  created_at timestamptz DEFAULT now(),
  finalized_at timestamptz,
  created_by text
);
ALTER TABLE stocktakes DISABLE ROW LEVEL SECURITY;

-- 12. NEW: stocktake_items（棚卸明細）
CREATE TABLE IF NOT EXISTS stocktake_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_id uuid NOT NULL REFERENCES stocktakes(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  system_stock numeric NOT NULL,   -- 棚卸開始時のシステム値
  counted_stock numeric,           -- 実数
  diff numeric GENERATED ALWAYS AS (counted_stock - system_stock) STORED,
  reason text, -- 差異理由（破損/紛失/売上未計上/その他）
  note text
);
CREATE INDEX IF NOT EXISTS idx_stocktake_items_st ON stocktake_items(stocktake_id);
ALTER TABLE stocktake_items DISABLE ROW LEVEL SECURITY;

-- 13. NEW: audit_logs（監査ログ）
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz DEFAULT now(),
  actor text,            -- ユーザー識別（簡易: localStorage の名前 / 後で Supabase Auth に置換）
  action text NOT NULL,  -- INSERT / UPDATE / DELETE / VIEW など
  entity_type text NOT NULL, -- orders, invoices, products, etc.
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  note text
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_occurred ON audit_logs(occurred_at);
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;

-- 14. NEW: sales_reps（営業マンマスタ）
CREATE TABLE IF NOT EXISTS sales_reps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  phone text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE sales_reps DISABLE ROW LEVEL SECURITY;

-- 15. NEW: clinic_product_prices（医院別単価マスタ）
CREATE TABLE IF NOT EXISTS clinic_product_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_price numeric NOT NULL,
  effective_from date,
  note text,
  UNIQUE (clinic_id, product_id)
);
ALTER TABLE clinic_product_prices DISABLE ROW LEVEL SECURITY;

-- 16. NEW: order_drafts（営業マンのオフライン下書き同期用）
CREATE TABLE IF NOT EXISTS order_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text,           -- ブラウザ端末識別 (localStorage)
  clinic_id uuid REFERENCES clinics(id),
  payload jsonb NOT NULL,   -- {sales_rep, items: [...]}
  status text DEFAULT 'pending', -- pending / committed / discarded
  created_at timestamptz DEFAULT now(),
  committed_at timestamptz,
  committed_order_id uuid REFERENCES orders(id)
);
CREATE INDEX IF NOT EXISTS idx_order_drafts_client ON order_drafts(client_id);
ALTER TABLE order_drafts DISABLE ROW LEVEL SECURITY;

-- 17. NEW: 商品名 NULL のバックフィル
UPDATE order_items
SET product_name = p.name
FROM products p
WHERE order_items.product_id = p.id
  AND order_items.product_name IS NULL;

-- 18. 既存 stock_receipts に product_name を保存できるようにする
ALTER TABLE stock_receipts ADD COLUMN IF NOT EXISTS product_name text;
ALTER TABLE stock_receipts ADD COLUMN IF NOT EXISTS lot_number text;
ALTER TABLE stock_receipts ADD COLUMN IF NOT EXISTS expiry_date date;
ALTER TABLE stock_receipts ADD COLUMN IF NOT EXISTS received_by text;
ALTER TABLE stock_receipts ADD COLUMN IF NOT EXISTS damaged_quantity numeric DEFAULT 0;

UPDATE stock_receipts sr
SET product_name = p.name
FROM products p
WHERE sr.product_id = p.id
  AND sr.product_name IS NULL;

-- ============================================================================
-- 完了。これでアプリ側の機能が一気に増やせます。
-- ============================================================================
