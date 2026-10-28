-- 発注書の「変更あり」の印（注文の編集で、送信済みの発注書の行を変えたとき、変えた内容を残す）
alter table purchase_orders add column if not exists change_log text;
notify pgrst, 'reload schema';
