-- ============================================================================
-- 歯式図からの注文機能: テンプレート保存用テーブル
-- 2026-09-17
--
-- 歯の位置（例: U1R = 上顎右側1番）ごとに、どの商品を注文するかを
-- テンプレートとして保存する。テンプレートを選べば、次回から歯式図を
-- クリックするだけで注文明細を作れるようにするため。
-- Supabase Studio の SQL Editor で1回実行してください。
-- ============================================================================

CREATE TABLE IF NOT EXISTS tooth_chart_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

CREATE TABLE IF NOT EXISTS tooth_chart_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references tooth_chart_templates(id) on delete cascade,
  position text not null,  -- 'U1R'〜'U8R','U1L'〜'U8L','L1R'〜'L8R','L1L'〜'L8L'
  product_id uuid references products(id),
  product_name text,       -- product_id が無い場合のフォールバック表示用
  unique (template_id, position)
);

ALTER TABLE IF EXISTS tooth_chart_templates DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tooth_chart_template_items DISABLE ROW LEVEL SECURITY;
