-- ============================================================================
-- 修理依頼書にメーカー名を追加
-- 2026-09-12
-- Supabase Studio の SQL Editor で1回実行してください。
-- ============================================================================

ALTER TABLE IF EXISTS repair_orders ADD COLUMN IF NOT EXISTS manufacturer text;
