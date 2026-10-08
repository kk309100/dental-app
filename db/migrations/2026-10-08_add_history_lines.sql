-- 前システムの商品元帳（売上・仕入・戻入など）を、過去の実績として別テーブルに保存する。
-- 今の注文・請求・売上集計とは分離（読み取り専用の履歴）。既存テーブルは変更しない。
-- 参照できるのは管理者のみ（医院ユーザーに他医院の履歴が見えないようにする）。

create table if not exists public.history_lines (
  id            bigint generated always as identity primary key,
  batch         text not null,              -- 取り込みの単位（再取り込み時に入れ替える）
  slip_date     date not null,              -- 伝票日付
  slip_no       text,                       -- 伝票番号
  kind          text not null,              -- 売上 / 仕入 / 戻入 / 棚卸 / 値引
  partner_code  text,                       -- 前システムの取引先コード
  partner_name  text,                       -- 取引先名（医院名 / 仕入先名）
  clinic_id     uuid references public.clinics(id)   on delete set null,   -- 照合できた医院
  supplier_id   uuid references public.suppliers(id) on delete set null,   -- 照合できた仕入先
  maker_name    text,
  item_code     text,                       -- 前システムの商品コード
  item_name     text,
  product_id    uuid references public.products(id)  on delete set null,   -- 照合できた商品
  unit_price    numeric,
  quantity      numeric,
  amount        numeric,
  profit        numeric,
  memo          text
);

create index if not exists history_lines_clinic_date_idx  on public.history_lines (clinic_id, slip_date desc);
create index if not exists history_lines_product_date_idx on public.history_lines (product_id, slip_date desc);
create index if not exists history_lines_item_code_idx    on public.history_lines (item_code);
create index if not exists history_lines_date_idx         on public.history_lines (slip_date);
create index if not exists history_lines_batch_idx        on public.history_lines (batch);

alter table public.history_lines enable row level security;
drop policy if exists history_lines_admin_select on public.history_lines;
create policy history_lines_admin_select on public.history_lines
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
-- 書き込みは service role（取り込みスクリプト）のみ。
