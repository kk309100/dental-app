-- ============================================================================
-- 商品マスタ画面（/admin/products）が参照している stocktake_exclude 列が
-- 実テーブルに存在せず、一覧取得クエリが全滅（0件表示）していた不具合の修正
-- 2026-09-02
--
-- stocktake_exclude: true の場合「棚卸し対象外（すぐ使う消耗品など）」を表す
--
-- Supabase Studio の SQL Editor で1回実行してください。
-- ============================================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS stocktake_exclude boolean DEFAULT false;
