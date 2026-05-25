import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const norm = v => String(v || '').toLowerCase().normalize('NFKC').replace(/\s+/g, '');

async function run() {
  // 全件取得
  const { data, error } = await sb.from('products')
    .select('id,name,product_code,created_at,active,purchase_maker')
    .order('created_at', { ascending: true })
    .limit(100000);
  if (error) { console.error(error.message); return; }
  console.log(`総件数: ${data.length}`);

  // 商品名で重複グループ化（古い方を残す）
  const byName = new Map();
  data.forEach(p => {
    const k = norm(p.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(p);
  });

  const dupGroups = [...byName.values()].filter(g => g.length > 1);
  const toDelete = [];

  dupGroups.forEach(group => {
    // created_at が古い順（先頭）を残し、残りを削除候補に
    const [keep, ...remove] = group;
    remove.forEach(p => toDelete.push(p));
    console.log(`  重複: 「${keep.name}」 x${group.length} → 残す:${keep.id.slice(0,8)} 削除:${remove.map(p=>p.id.slice(0,8)).join(',')}`);
  });

  console.log(`\n重複グループ: ${dupGroups.length}件`);
  console.log(`削除対象: ${toDelete.length}件`);

  if (toDelete.length === 0) { console.log('重複なし。終了。'); return; }

  // 削除実行
  let deleted = 0;
  for (const p of toDelete) {
    const { error: de } = await sb.from('products').delete().eq('id', p.id);
    if (de) console.error(`削除エラー: ${p.name} - ${de.message}`);
    else deleted++;
  }

  console.log(`\n✅ 削除完了: ${deleted}件`);

  // 最終件数確認
  const { count } = await sb.from('products').select('*', { count: 'exact', head: true });
  console.log(`削除後の総件数: ${count}`);
}

run().catch(console.error);
