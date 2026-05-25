import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function run() {
  console.log('=== default_supplier_id 自動設定 ===\n');

  // 1. suppliers の short_name → id マップを作成
  const { data: suppliers, error: se } = await supabase
    .from('suppliers')
    .select('id, name, short_name')
    .not('short_name', 'is', null);
  if (se) { console.error('仕入先取得エラー:', se.message); return; }

  // NFKC正規化：半角ｶﾅ→全角カナ に統一してマッチ
  const norm = (s) => String(s || '').normalize('NFKC').trim();
  const shortNameToId = new Map(suppliers.map(s => [norm(s.short_name), s.id]));
  const shortNameToName = new Map(suppliers.map(s => [norm(s.short_name), s.name]));
  console.log(`仕入先（short_name設定済み）: ${suppliers.length}件`);

  // 2. purchase_maker が設定されていて default_supplier_id が未設定の商品を取得
  const { data: products, error: pe } = await supabase
    .from('products')
    .select('id, name, purchase_maker, default_supplier_id')
    .not('purchase_maker', 'is', null)
    .is('default_supplier_id', null)
    .limit(100000);
  if (pe) { console.error('商品取得エラー:', pe.message); return; }
  console.log(`対象商品（purchase_maker有り・default_supplier_id未設定）: ${products.length}件\n`);

  let matched = 0, unmatched = 0;
  const unmatchedMakers = new Set();

  // 3. バッチ更新
  const BATCH = 100;
  for (let i = 0; i < products.length; i += BATCH) {
    const batch = products.slice(i, i + BATCH);
    for (const p of batch) {
      const supplierId = shortNameToId.get(norm(p.purchase_maker));
      if (supplierId) {
        const { error } = await supabase
          .from('products')
          .update({ default_supplier_id: supplierId })
          .eq('id', p.id);
        if (error) {
          console.error(`  ✗ エラー: ${p.name} - ${error.message}`);
        } else {
          matched++;
        }
      } else {
        unmatched++;
        unmatchedMakers.add(p.purchase_maker);
      }
    }
    process.stdout.write(`\r進捗: ${Math.min(i + BATCH, products.length)}/${products.length} (設定済み: ${matched})`);
  }

  console.log('\n\n========== 完了 ==========');
  console.log(`default_supplier_id を設定: ${matched} 件`);
  console.log(`仕入先が見つからず未設定:   ${unmatched} 件`);
  if (unmatchedMakers.size > 0) {
    console.log(`\n未マッチのﾒｰｶｰ略称:`);
    [...unmatchedMakers].forEach(m => console.log(`  「${m}」`));
  }
  console.log('===========================');
}

run().catch(console.error);
