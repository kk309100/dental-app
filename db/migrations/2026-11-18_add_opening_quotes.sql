create table if not exists public.opening_quotes (
  id uuid primary key default gen_random_uuid(),
  manage_no integer not null unique,
  clinic_id uuid,
  title text,
  issue_date date,
  delivery_date text,
  delivery_place text,
  inspection_period text,
  payment_terms text,
  expiry_text text,
  discount numeric not null default 0,
  note text,
  subtotal numeric not null default 0,
  tax numeric not null default 0,
  total numeric not null default 0,
  section_count integer not null default 0,
  status text not null default 'draft',
  order_id uuid,
  created_at timestamptz not null default now()
);
create table if not exists public.opening_quote_sections (
  id uuid primary key default gen_random_uuid(),
  opening_quote_id uuid not null references public.opening_quotes(id) on delete cascade,
  quote_id uuid not null,
  sort_order integer not null default 0,
  title_override text
);
create index if not exists opening_quote_sections_oq_idx on public.opening_quote_sections (opening_quote_id);
alter table public.opening_quotes disable row level security;
alter table public.opening_quote_sections disable row level security;
notify pgrst, 'reload schema';
