-- 仕入処理が、回数を重ねるほど、精度が上がるようにする:「この仕入先の、この表記（コード・商品名）は、この商品」を覚える表
-- 仕入登録を確定したとき、納品書の表記と、選んだ商品の組を、自動で記録する。次回から、突き合わせで、最優先で使う。
create table if not exists public.supplier_product_aliases (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid not null references public.suppliers(id) on delete cascade,
  alias_key    text not null,                 -- 'code:' + 正規化した仕入先の品番 / 'name:' + 正規化した商品名
  product_id   uuid not null references public.products(id) on delete cascade,
  times        integer not null default 1,    -- この組で、仕入登録した回数
  last_used_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (supplier_id, alias_key)
);
create index if not exists supplier_product_aliases_product_idx on public.supplier_product_aliases (product_id);
-- このアプリの他のテーブルと同じく、RLS は無効にする
alter table public.supplier_product_aliases disable row level security;
notify pgrst, 'reload schema';
