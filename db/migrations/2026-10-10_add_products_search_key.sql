-- 商品検索を速くするための検索用の列（products.search_key）。
-- 商品名・コード・メーカー・カテゴリを、「全角半角・大文字小文字・ひらがな/カタカナ・空白」の違いを無視できる形にして持つ。
-- アプリは、この列を使って、必要な商品だけをサーバーで検索する（全商品を読み込まずに済む）。
-- 既存のデータは変更しない（列の追加と、自動で値を入れる仕組みの追加のみ）。

create extension if not exists pg_trgm;

alter table public.products add column if not exists search_key text;

create or replace function public.products_set_search_key() returns trigger
language plpgsql as $$
begin
  new.search_key := lower(
    regexp_replace(
      translate(
        normalize(
          coalesce(new.name, '') || ' ' || coalesce(new.product_code, '') || ' ' ||
          coalesce(new.manufacturer, '') || ' ' || coalesce(new.category, ''),
          NFKC),
        'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔ',
        'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴ'),
      '\s+', '', 'g'));
  return new;
end;
$$;

drop trigger if exists products_set_search_key_trg on public.products;
create trigger products_set_search_key_trg
  before insert or update of name, product_code, manufacturer, category on public.products
  for each row execute function public.products_set_search_key();

-- 既存の全商品に値を入れる（名前を同じ値で更新して、上のトリガーを動かす）
update public.products set name = name;

create index if not exists products_search_key_trgm_idx on public.products using gin (search_key gin_trgm_ops);
