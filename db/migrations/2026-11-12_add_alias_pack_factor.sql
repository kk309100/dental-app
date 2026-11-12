-- 仕入処理: 「ばらす」などの換算（納品書の数量の、N倍で在庫に入れる）も、覚えた記録に持たせる
alter table public.supplier_product_aliases add column if not exists pack_factor numeric;
notify pgrst, 'reload schema';
