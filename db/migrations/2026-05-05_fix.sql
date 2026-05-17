-- ============================================================================
-- 2026-05-05 修正版マイグレーション
--
-- 既存 purchase_orders テーブルに supplier_id 等のカラムが無いため
-- CREATE TABLE IF NOT EXISTS だけでは追加されない問題を解消する。
--
-- 既に full_overhaul.sql を実行して supplier_id エラーで止まった環境向け。
-- 上から順に実行してください。冪等（何度実行してもOK）。
-- ============================================================================

-- 1. purchase_orders に不足カラムを追加（既存テーブル対応）
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS po_number text;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS status text DEFAULT '下書き';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS ordered_at timestamptz;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS expected_at date;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS total_amount numeric DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS sent_method text;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS sent_at timestamptz;

-- po_number に部分一意性
DROP INDEX IF EXISTS uq_purchase_orders_po_number;
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_po_number ON purchase_orders(po_number) WHERE po_number IS NOT NULL;

-- インデックス
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
ALTER TABLE purchase_orders DISABLE ROW LEVEL SECURITY;

-- 2. purchase_order_items（こちらも既存対応）
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id),
  product_name text,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  received_quantity numeric DEFAULT 0,
  source_order_item_id uuid,
  note text
);
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE CASCADE;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id);
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS product_name text;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS quantity numeric NOT NULL DEFAULT 1;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS unit_price numeric NOT NULL DEFAULT 0;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS received_quantity numeric DEFAULT 0;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS source_order_item_id uuid;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS note text;
CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(purchase_order_id);
ALTER TABLE purchase_order_items DISABLE ROW LEVEL SECURITY;

-- 3. stock_movements
CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  movement_type text NOT NULL,
  quantity numeric NOT NULL,
  before_stock numeric,
  after_stock numeric,
  ref_type text,
  ref_id uuid,
  reason text,
  occurred_at timestamptz DEFAULT now(),
  created_by text
);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS movement_type text;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS quantity numeric;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS before_stock numeric;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS after_stock numeric;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS ref_type text;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS ref_id uuid;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS occurred_at timestamptz DEFAULT now();
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS created_by text;
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_occurred ON stock_movements(occurred_at);
ALTER TABLE stock_movements DISABLE ROW LEVEL SECURITY;

-- 4. stocktakes
CREATE TABLE IF NOT EXISTS stocktakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_on date NOT NULL,
  status text DEFAULT '進行中',
  note text,
  created_at timestamptz DEFAULT now(),
  finalized_at timestamptz,
  created_by text
);
ALTER TABLE stocktakes ADD COLUMN IF NOT EXISTS taken_on date;
ALTER TABLE stocktakes ADD COLUMN IF NOT EXISTS status text DEFAULT '進行中';
ALTER TABLE stocktakes ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE stocktakes ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE stocktakes ADD COLUMN IF NOT EXISTS finalized_at timestamptz;
ALTER TABLE stocktakes ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE stocktakes DISABLE ROW LEVEL SECURITY;

-- 5. stocktake_items
CREATE TABLE IF NOT EXISTS stocktake_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_id uuid NOT NULL REFERENCES stocktakes(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  system_stock numeric NOT NULL,
  counted_stock numeric,
  diff numeric GENERATED ALWAYS AS (counted_stock - system_stock) STORED,
  reason text,
  note text
);
ALTER TABLE stocktake_items ADD COLUMN IF NOT EXISTS stocktake_id uuid REFERENCES stocktakes(id) ON DELETE CASCADE;
ALTER TABLE stocktake_items ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id);
ALTER TABLE stocktake_items ADD COLUMN IF NOT EXISTS system_stock numeric;
ALTER TABLE stocktake_items ADD COLUMN IF NOT EXISTS counted_stock numeric;
ALTER TABLE stocktake_items ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE stocktake_items ADD COLUMN IF NOT EXISTS note text;
CREATE INDEX IF NOT EXISTS idx_stocktake_items_st ON stocktake_items(stocktake_id);
ALTER TABLE stocktake_items DISABLE ROW LEVEL SECURITY;

-- 6. audit_logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz DEFAULT now(),
  actor text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  note text
);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS occurred_at timestamptz DEFAULT now();
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_id uuid;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS before_data jsonb;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS after_data jsonb;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS note text;
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_occurred ON audit_logs(occurred_at);
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;

-- 7. sales_reps
CREATE TABLE IF NOT EXISTS sales_reps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  phone text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE sales_reps DISABLE ROW LEVEL SECURITY;

-- 8. invoice_payments
CREATE TABLE IF NOT EXISTS invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  paid_at timestamptz NOT NULL,
  amount numeric NOT NULL,
  method text DEFAULT '振込',
  note text,
  created_at timestamptz DEFAULT now(),
  created_by text
);
ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES invoices(id) ON DELETE CASCADE;
ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS amount numeric;
ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS method text DEFAULT '振込';
ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS note text;
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);
ALTER TABLE invoice_payments DISABLE ROW LEVEL SECURITY;

-- 9. clinic_product_prices
CREATE TABLE IF NOT EXISTS clinic_product_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_price numeric NOT NULL,
  effective_from date,
  note text
);
DROP INDEX IF EXISTS uq_clinic_product;
CREATE UNIQUE INDEX IF NOT EXISTS uq_clinic_product ON clinic_product_prices(clinic_id, product_id);
ALTER TABLE clinic_product_prices DISABLE ROW LEVEL SECURITY;

-- 10. order_drafts
CREATE TABLE IF NOT EXISTS order_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text,
  clinic_id uuid REFERENCES clinics(id),
  payload jsonb NOT NULL,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  committed_at timestamptz,
  committed_order_id uuid REFERENCES orders(id)
);
CREATE INDEX IF NOT EXISTS idx_order_drafts_client ON order_drafts(client_id);
ALTER TABLE order_drafts DISABLE ROW LEVEL SECURITY;

-- 11. orders 拡張カラム（再実行で安全）
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS prepared_at  timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sales_rep text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source text DEFAULT 'admin';
UPDATE orders SET delivered_at = created_at WHERE status = '納品済み' AND delivered_at IS NULL;

-- 12. order_items 拡張カラム
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS purchase_status text DEFAULT '未発注';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS purchased_at timestamptz;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS shipped_quantity numeric DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS purchase_order_item_id uuid;

-- 13. clinics 拡張カラム + adress→address rename（既に rename されてたらスキップ）
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinics' AND column_name='adress') THEN
    ALTER TABLE clinics RENAME COLUMN adress TO address;
  END IF;
END $$;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS payment_terms text DEFAULT '翌月末';
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS bank_account text;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES clinics(id);
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS note text;

-- 14. products 拡張カラム
ALTER TABLE products ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_rate numeric DEFAULT 0.10;
ALTER TABLE products ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS lot_managed boolean DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS expiry_managed boolean DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS default_supplier_id uuid REFERENCES suppliers(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS lead_time_days integer DEFAULT 7;
DROP INDEX IF EXISTS uq_products_code;
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_code ON products(product_code) WHERE product_code IS NOT NULL;

-- 15. suppliers 拡張カラム
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS fax text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS lead_time_days integer DEFAULT 7;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS min_order_amount numeric DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS note text;

-- 16. invoices 拡張カラム
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_period_start date;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_period_end date;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_to text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS note text;

-- 17. order_items.product_name バックフィル
UPDATE order_items
SET product_name = p.name
FROM products p
WHERE order_items.product_id = p.id
  AND order_items.product_name IS NULL;

-- 18. stock_receipts 拡張
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
-- Phase 6-10 用の追加テーブル
-- ============================================================================

-- 19. company_settings
CREATE TABLE IF NOT EXISTS company_settings (
  id smallint PRIMARY KEY DEFAULT 1,
  company_name text NOT NULL DEFAULT '株式会社 清新',
  postal_code text,
  address text,
  phone text,
  fax text,
  email text,
  representative text,
  invoice_registration_number text,
  bank_account text,
  bank_name text,
  bank_branch text,
  bank_type text,
  bank_number text,
  bank_holder text,
  seal_image_url text,
  logo_image_url text,
  invoice_footer text,
  updated_at timestamptz DEFAULT now(),
  updated_by text,
  CONSTRAINT only_one_row CHECK (id = 1)
);

INSERT INTO company_settings (id, company_name, postal_code, address, phone, fax, invoice_registration_number, representative)
VALUES (1, '株式会社 清新', '454-0812', '名古屋市中川区五月通2-37 黄金ステーションビル3階',
        '052-526-3223', '052-655-5977', 'T4180001119611', '小池 拓未')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE company_settings DISABLE ROW LEVEL SECURITY;

-- 20. notification_settings
CREATE TABLE IF NOT EXISTS notification_settings (
  id smallint PRIMARY KEY DEFAULT 1,
  smtp_host text,
  smtp_port integer DEFAULT 587,
  smtp_user text,
  smtp_pass_encrypted text,
  from_email text,
  from_name text DEFAULT '株式会社 清新',
  notify_new_order boolean DEFAULT true,
  notify_payment_overdue boolean DEFAULT false,
  notify_low_stock boolean DEFAULT false,
  CONSTRAINT only_one_setting CHECK (id = 1)
);
ALTER TABLE notification_settings DISABLE ROW LEVEL SECURITY;

-- 21. email_logs
CREATE TABLE IF NOT EXISTS email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_at timestamptz DEFAULT now(),
  to_email text NOT NULL,
  subject text NOT NULL,
  body text,
  related_type text,
  related_id uuid,
  status text DEFAULT 'sent',
  error_message text,
  created_by text
);
CREATE INDEX IF NOT EXISTS idx_email_logs_related ON email_logs(related_type, related_id);
ALTER TABLE email_logs DISABLE ROW LEVEL SECURITY;

-- 22. bank_imports
CREATE TABLE IF NOT EXISTS bank_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  imported_at timestamptz DEFAULT now(),
  filename text,
  bank_name text,
  total_lines integer,
  matched_lines integer DEFAULT 0,
  total_amount numeric DEFAULT 0,
  matched_amount numeric DEFAULT 0,
  imported_by text
);
ALTER TABLE bank_imports DISABLE ROW LEVEL SECURITY;

-- 23. bank_payment_lines
CREATE TABLE IF NOT EXISTS bank_payment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_import_id uuid REFERENCES bank_imports(id) ON DELETE CASCADE,
  paid_on date NOT NULL,
  amount numeric NOT NULL,
  payer_name text,
  memo text,
  matched_invoice_id uuid REFERENCES invoices(id),
  matched_payment_id uuid REFERENCES invoice_payments(id),
  status text DEFAULT '未消込',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bpl_status ON bank_payment_lines(status);
CREATE INDEX IF NOT EXISTS idx_bpl_payer ON bank_payment_lines(payer_name);
ALTER TABLE bank_payment_lines DISABLE ROW LEVEL SECURITY;

-- 24. delivery_slips
CREATE TABLE IF NOT EXISTS delivery_slips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slip_number text UNIQUE,
  clinic_id uuid REFERENCES clinics(id),
  delivered_on date NOT NULL,
  delivered_by text,
  carrier text,
  tracking_number text,
  total_amount numeric DEFAULT 0,
  note text,
  status text DEFAULT '出荷準備',
  created_at timestamptz DEFAULT now(),
  shipped_at timestamptz,
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ds_clinic ON delivery_slips(clinic_id);
CREATE INDEX IF NOT EXISTS idx_ds_date ON delivery_slips(delivered_on);
ALTER TABLE delivery_slips DISABLE ROW LEVEL SECURITY;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_slip_id uuid REFERENCES delivery_slips(id);

-- 25. products に barcode
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode text;
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL;

-- 26. clinics に与信
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS credit_limit numeric;

-- 27. product_suppliers
CREATE TABLE IF NOT EXISTS product_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_product_code text,
  supplier_price numeric,
  is_default boolean DEFAULT false,
  lead_time_days integer,
  min_order_quantity integer
);
DROP INDEX IF EXISTS uq_product_supplier;
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_supplier ON product_suppliers(product_id, supplier_id);
ALTER TABLE product_suppliers DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 完了！すべて適用されたはずです。
-- 確認: select * from purchase_orders; など各テーブルが見えれば成功
-- ============================================================================
