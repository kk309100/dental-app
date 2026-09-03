-- ============================================================================
-- 管理画面の「修正メモ」を、ブラウザのlocalStorage保存からDB保存に変更する
-- 2026-09-03
--
-- 従来はブラウザのlocalStorageに保存していたため、端末やブラウザが変わると
-- 消えてしまう問題があった。DBに保存することで、どの端末からでも
-- 同じ修正メモ一覧を確認・蓄積できるようにする。
--
-- Supabase Studio の SQL Editor で1回実行してください。
-- ============================================================================

CREATE TABLE IF NOT EXISTS feedback_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page        text,
  content     text NOT NULL,
  priority    text NOT NULL DEFAULT '中',
  status      text NOT NULL DEFAULT '未対応',
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE feedback_notes DISABLE ROW LEVEL SECURITY;
