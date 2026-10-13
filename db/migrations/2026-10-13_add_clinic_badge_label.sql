-- 医院マスターに「バッジの文字」を追加する。
-- 注文管理の医院名の隣に、紫色のバッジとして表示される（例: 個人分、要注意、至急対応）。
-- 既存のデータは変更しない（列を1つ足すだけ）。
alter table public.clinics add column if not exists badge_label text;
