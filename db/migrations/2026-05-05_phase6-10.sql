-- ============================================================================
-- dental-app Phase 6-10 マイグレーション (2026-05-05)
--
-- Phase 6: セキュリティ・認証強化
-- Phase 7: コンプライアンス（自社情報DB化、適格請求書チェック）
-- Phase 8: ピッキング・検品・配送
-- Phase 9: 売掛金エイジング・試算表・ABC分析
-- Phase 10: 銀行入金消込・メール送信履歴・パラジウム自動取得
--
-- 前提: 2026-05-05_full_overhaul.sql 適用済み
-- ============================================================================

-- 1. company_settings (自社情報をDB化)
CREATE TABLE IF NOT EXISTS company_settings (
  id smallint PRIMARY KEY DEFAULT 1,
  company_name text NOT NULL,
  postal_code text,
  address text,
  phone text,
  fax text,
  email text,
  representative text,
  invoice_registration_number text, -- 適格請求書発行事業者登録番号 T1234567890123
  bank_account text,
  bank_name text,
  bank_branch text,
  bank_type text, -- 普通/当座
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

-- 2. notification_settings (メール送信設定)
CREATE TABLE IF NOT EXISTS notification_settings (
  id smallint PRIMARY KEY DEFAULT 1,
  smtp_host text,
  smtp_port integer DEFAULT 587,
  smtp_user text,
  smtp_pass_encrypted text,  -- 暗号化保存推奨だが暫定平文
  from_email text,
  from_name text DEFAULT '株式会社 清新',
  notify_new_order boolean DEFAULT true,
  notify_payment_overdue boolean DEFAULT false,
  notify_low_stock boolean DEFAULT false,
  CONSTRAINT only_one_setting CHECK (id = 1)
);
ALTER TABLE notification_settings DISABLE ROW LEVEL SECURITY;

-- 3. email_logs (送信履歴)
CREATE TABLE IF NOT EXISTS email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_at timestamptz DEFAULT now(),
  to_email text NOT NULL,
  subject text NOT NULL,
  body text,
  related_type text,    -- invoice / order / etc
  related_id uuid,
  status text DEFAULT 'sent', -- sent / failed
  error_message text,
  created_by text
);
CREATE INDEX IF NOT EXISTS idx_email_logs_related ON email_logs(related_type, related_id);
ALTER TABLE email_logs DISABLE ROW LEVEL SECURITY;

-- 4. bank_imports (銀行入金CSV取込履歴)
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

-- 5. bank_payment_lines (銀行明細1行 = 入金候補)
CREATE TABLE IF NOT EXISTS bank_payment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_import_id uuid REFERENCES bank_imports(id) ON DELETE CASCADE,
  paid_on date NOT NULL,
  amount numeric NOT NULL,
  payer_name text,            -- 振込人名（医院名と照合）
  memo text,
  matched_invoice_id uuid REFERENCES invoices(id), -- 自動 or 手動マッチ後の請求書
  matched_payment_id uuid REFERENCES invoice_payments(id), -- 消込後の入金記録
  status text DEFAULT '未消込', -- 未消込 / 消込済 / 保留
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bpl_status ON bank_payment_lines(status);
CREATE INDEX IF NOT EXISTS idx_bpl_payer ON bank_payment_lines(payer_name);
ALTER TABLE bank_payment_lines DISABLE ROW LEVEL SECURITY;

-- 6. delivery_slips (納品書 - 注文をまとめた1枚の伝票)
-- 納品書 = 1医院・1日 で複数注文をまとめて1枚にできる
CREATE TABLE IF NOT EXISTS delivery_slips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slip_number text UNIQUE,            -- DS-YYYYMMDD-NNNN
  clinic_id uuid REFERENCES clinics(id),
  delivered_on date NOT NULL,
  delivered_by text,
  carrier text,                       -- 配送業者
  tracking_number text,               -- 追跡番号
  total_amount numeric DEFAULT 0,
  note text,
  status text DEFAULT '出荷準備', -- 出荷準備 / 出荷済 / 配達済 / キャンセル
  created_at timestamptz DEFAULT now(),
  shipped_at timestamptz,
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ds_clinic ON delivery_slips(clinic_id);
CREATE INDEX IF NOT EXISTS idx_ds_date ON delivery_slips(delivered_on);
ALTER TABLE delivery_slips DISABLE ROW LEVEL SECURITY;

-- orders に delivery_slip_id を追加 (1納品書に複数注文)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_slip_id uuid REFERENCES delivery_slips(id);

-- 7. RLS ポリシーは Supabase Auth 統合後に有効化推奨
-- 暫定的に「全テーブル DISABLE」のまま運用。将来的には:
--   ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY clinic_admin_all ON clinics FOR ALL USING (auth.role() = 'authenticated');
-- などを追加。

-- 8. 商品の barcode フィールド（バーコード対応）
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode text;
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL;

-- 9. clinics に与信限度額・支払条件詳細
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS credit_limit numeric;

-- 10. 仕入先メーカーマッピング（複数仕入先対応の準備）
CREATE TABLE IF NOT EXISTS product_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_product_code text,
  supplier_price numeric,
  is_default boolean DEFAULT false,
  lead_time_days integer,
  min_order_quantity integer,
  UNIQUE (product_id, supplier_id)
);
ALTER TABLE product_suppliers DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 完了
-- ============================================================================
