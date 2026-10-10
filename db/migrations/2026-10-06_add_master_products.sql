-- 商品マスター（データランド等の外部マスタ）を「辞書」として保持し、
-- 実際に使う商品（products）へは、必要になった品目だけを移行する構成にする。
-- 既存データは変更しない（テーブル追加 + products に紐づけ列を1つ追加するだけ）。

create extension if not exists pg_trgm;

create table if not exists public.master_products (
  id          uuid primary key default gen_random_uuid(),
  item_code   text not null unique,        -- 品目コード（例: 0202X5001）
  jan         text,
  maker_kana  text,
  name_kana   text,
  name        text not null,
  list_price  numeric,
  source      text not null default 'dataland',
  search_key  text,                        -- 検索用（全角半角・ひらがな/カタカナ・空白の違いを無視）。自動で入る
  created_at  timestamptz not null default now()
);

create or replace function public.master_products_set_search_key() returns trigger
language plpgsql as $$
begin
  new.search_key := lower(
    regexp_replace(
      translate(
        normalize(
          coalesce(new.name, '') || ' ' || coalesce(new.name_kana, '') || ' ' ||
          coalesce(new.item_code, '') || ' ' || coalesce(new.jan, '') || ' ' || coalesce(new.maker_kana, ''),
          NFKC),
        'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔ',
        'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴ'),
      '\s+', '', 'g'));
  return new;
end;
$$;

drop trigger if exists master_products_set_search_key_trg on public.master_products;
create trigger master_products_set_search_key_trg
  before insert or update of name, name_kana, item_code, jan, maker_kana on public.master_products
  for each row execute function public.master_products_set_search_key();

create index if not exists master_products_jan_idx        on public.master_products (jan);
create index if not exists master_products_search_trgm_idx on public.master_products using gin (search_key gin_trgm_ops);

-- 参照は認証済みユーザーのみ。書き込みは service role（取り込みスクリプト）だけ。
alter table public.master_products enable row level security;
drop policy if exists master_products_select on public.master_products;
create policy master_products_select on public.master_products
  for select to authenticated using (true);

-- 使う商品 → マスター品目への紐づけ
alter table public.products
  add column if not exists master_product_id uuid references public.master_products(id) on delete set null;
create index if not exists products_master_product_id_idx on public.products (master_product_id);
