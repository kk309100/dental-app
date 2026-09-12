-- ============================================================================
-- 見積書作成時の "row-level security policy" エラー修正
-- 2026-09-12
--
-- 原因: quotes / quote_items テーブルで RLS (Row Level Security) が
--       有効になっており、アプリが使う publishable key からの
--       INSERT が拒否されている。
--   ERROR: new row violates row-level security policy for table "quotes"
--
-- 修正: このアプリの他の全テーブルと同様に RLS を無効化する
--       （2026-05-05_disable_rls_again.sql と同じ対応）
-- Supabase Studio の SQL Editor で1回実行してください。
-- ============================================================================

ALTER TABLE IF EXISTS quotes DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS quote_items DISABLE ROW LEVEL SECURITY;
