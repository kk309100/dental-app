import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Simple CSV split (handles no quotes in this file)
    const vals = line.split(',');
    const row = {};
    headers.forEach((h, idx) => { row[h] = (vals[idx] || '').replace(/^"|"$/g, '').trim(); });
    rows.push(row);
  }
  return rows;
}

const norm = (v) => String(v || '').toLowerCase().normalize('NFKC').replace(/\s+/g, '');

async function run() {
  console.log('=== 商品データ一括インポート開始 ===\n');

  const csvText = fs.readFileSync('C:/Users/user/Downloads/products_import_utf8.csv', 'utf-8');
  const rows = parseCSV(csvText);
  console.log(`CSV行数: ${rows.length}件`);

  // 既存商品を取得
  const { data: existing, error: fetchErr } = await supabase
    .from('products')
    .select('id,name,product_code')
    .limit(100000);
  if (fetchErr) { console.error('取得エラー:', fetchErr.message); return; }
  console.log(`既存商品: ${existing.length}件\n`);

  const byCode = new Map(existing.filter(p => p.product_code).map(p => [norm(p.product_code), p]));
  const byName = new Map(existing.map(p => [norm(p.name), p]));

  let updated = 0, created = 0, skipped = 0, errors = 0;
  const BATCH = 50;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    for (const r of batch) {
      const name = (r['name'] || r['商品名'] || '').trim();
      const code = (r['product_code'] || r['商品コード'] || '').trim();
      if (!name && !code) { skipped++; continue; }

      const payload = {
        name: name || code,
        product_code: code || null,
        manufacturer: r['manufacturer'] || r['メーカー'] || null,
        category: r['category'] || r['カテゴリ'] || null,
        cost: Number((r['cost'] || r['仕入価格'] || '').replace(/[¥,]/g, '')) || null,
        price: Number((r['price'] || r['定価'] || '').replace(/[¥,]/g, '')) || null,
        reorder_level: Number(r['reorder_level'] || r['発注点'] || '') || null,
        location: r['location'] || r['棚番号'] || null,
        purchase_maker: r['ﾒｰｶｰ'] || r['仕入れメーカー'] || null,
        active: r['is_active'] === 'FALSE' ? false : true,
      };
      // nullify empty strings
      Object.keys(payload).forEach(k => { if (payload[k] === '' || payload[k] === null || payload[k] === undefined) payload[k] = null; });

      const existingRow = (code && byCode.get(norm(code))) || byName.get(norm(name));
      if (existingRow) {
        const { error } = await supabase.from('products').update(payload).eq('id', existingRow.id);
        if (error) { errors++; console.error(`✗ 更新エラー: ${name} - ${error.message}`); }
        else updated++;
      } else {
        const { error } = await supabase.from('products').insert(payload);
        if (!error) { created++; }
        else if (error.message.includes('duplicate key') || error.message.includes('uq_products_code')) {
          // 連番コードが衝突した場合はコードをnullにして再挿入
          const { error: e2 } = await supabase.from('products').insert({ ...payload, product_code: null });
          if (e2) { errors++; console.error(`✗ 挿入エラー(再試行): ${name} - ${e2.message}`); }
          else created++;
        } else {
          errors++;
          console.error(`✗ 挿入エラー: ${name} - ${error.message}`);
        }
      }
    }
    process.stdout.write(`\r進捗: ${Math.min(i + BATCH, rows.length)}/${rows.length} (更新${updated} 新規${created} エラー${errors})`);
  }

  console.log('\n\n========== 完了 ==========');
  console.log(`更新: ${updated}件`);
  console.log(`新規: ${created}件`);
  console.log(`スキップ: ${skipped}件`);
  console.log(`エラー: ${errors}件`);
  console.log('===========================');
}

run().catch(console.error);
