-- 発注書を消したとき、いつ・どの画面で・中身は何だったかを残す履歴
create table if not exists public.po_delete_log (
  id            uuid primary key default gen_random_uuid(),
  po_id         uuid,
  po_number     text,
  status        text,
  supplier_id   uuid,
  total_amount  numeric,
  where_deleted text,
  lines         jsonb,
  deleted_at    timestamptz not null default now()
);
alter table public.po_delete_log disable row level security;
notify pgrst, 'reload schema';
