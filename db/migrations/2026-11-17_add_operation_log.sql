-- 操作の記録（強制発注・発注プール追加・入荷・注文の編集と削除・医院の変更・発注書の削除など）
create table if not exists public.operation_log (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  actor       text,
  action      text not null,
  entity_type text,
  entity_id   text,
  detail      jsonb,
  page        text
);
create index if not exists operation_log_created_idx on public.operation_log (created_at desc);
create index if not exists operation_log_entity_idx on public.operation_log (entity_id);
alter table public.operation_log disable row level security;
notify pgrst, 'reload schema';
