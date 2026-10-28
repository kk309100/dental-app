-- 合算見積の、元の見積書ごとの見出し（明細の上に出す。空なら、見出しなし）
alter table quote_items add column if not exists section_label text;
notify pgrst, 'reload schema';
