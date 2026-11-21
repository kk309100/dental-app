alter table public.products add column if not exists legacy_code text;
create index if not exists products_legacy_code_idx on public.products (legacy_code);
