alter table quote_items add column if not exists note text;
notify pgrst, 'reload schema';
