import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const norm = (s) =>
  String(s || '').normalize('NFKC').replace(/[\s　]/g, '').replace(/株式会社|㈱|（株）|\(株\)/g, '').toLowerCase();

// CSV ﾒｰｶｰ略称 → 仕入先名 マッピング
const SHORT_MAP = {
  'ﾊﾞｲｵﾃﾞﾝﾄ':       '株式会社 バイオデント',
  'ﾄﾐｰINT':          '株式会社 トミーインターナショナル',
  'JMｵﾙｿ':           '株式会社 ＪＭ Ｏrtho',
  'TP':               'TPオーソドンテックス・ジャパン',
  'ﾌｫﾚｽﾄﾜﾝ':         '株式会社 フォレスト・ワン',
  'Ksイシダ':          '株式会社 Kｓイシダ',
  'ﾖｼﾀﾞ':            '株式会社 ヨシダ',
  'ｼｰｱｲ':            '株式会社 歯愛メディカル 清新使用分',
  'ﾌｨｰﾄﾞ':           'フィード株式会社',
  'ｻｻｷ岡崎':          'ササキ株式会社 岡崎支店',
  'ササキ岡崎':        'ササキ株式会社 岡崎支店',
  'OCﾒﾃﾞｨｯｸ':        '株式会社 オーシーメディック',
  'BSAｻｸﾗｲ':         '株式会社 ビーエスエーサクライ',
  'BSAサクライ':       '株式会社 ビーエスエーサクライ',
  'SEO':              '株式会社 エス・イー・オー',
  'ﾅｶｼﾏ':            '株式会社ナカシマ',
  'ナカシマ':          '株式会社ナカシマ',
  'ﾘﾝｸ':             '株式会社 リンク',
  'リンク':            '株式会社 リンク',
  'ｵｰｿﾃﾞﾝﾄﾗﾑ':       'オーソデントラム',
  '愛知県歯科医師会':  '社団法人 愛知県歯科医師会',
  'ｱｸﾛｽ':            '株式会社アクロス',
  'ｱﾝﾌｧﾐｴ':          'アンファミエ',
  'ｸﾗｼｺ':            'クラシコ 株式会社',
  'PDR':              'P.D.R',
  'ﾌﾟﾛｼｰﾄﾞ':         '株式会社 プロシード',
  'ｱﾄﾞﾊﾞﾝｽｼﾞｬﾊﾟﾝ':   'アドバンスジャパン 株式会社',
  'ﾌｫﾚｽﾀﾃﾞﾝﾄ':       'フォレスタデント',
  'ｷﾝｸﾞ':            'キング',
  'ｿﾉﾀ':             'その他',
};

async function run() {
  // 1. カラム追加（Supabase SQLエディタで先に実行済みを想定、ここではスキップ）
  console.log('=== 仕入先データ統合開始 ===\n');

  // 2. Excel読み込み
  const wb = XLSX.readFile('C:/Users/user/Downloads/仕入れ先情報5.16.xlsx');
  const excelRows = XLSX.utils.sheet_to_json(wb.Sheets['Sheet1'], { defval: '' });
  console.log(`Excel仕入先: ${excelRows.length}件\n`);

  // 3. 既存データ取得
  const { data: existing, error: fetchErr } = await supabase.from('suppliers').select('*');
  if (fetchErr) { console.error('取得エラー:', fetchErr.message); return; }
  const existingMap = new Map(existing.map(s => [norm(s.name), s]));

  let updated = 0, inserted = 0;

  // 4. Excelデータをマージ（名前照合）
  for (const row of excelRows) {
    const name = String(row['仕入れ先名'] || '').trim();
    if (!name) continue;

    const payload = {
      phone:       String(row['電話番号'] || '').trim() || null,
      fax:         String(row['FAX']      || '').trim() || null,
      address:     String(row['住所']     || '').trim() || null,
      postal_code: String(row['郵便番号'] || '').trim() || null,
    };

    const matched = existingMap.get(norm(name));
    if (matched) {
      const { error } = await supabase.from('suppliers').update(payload).eq('id', matched.id);
      if (!error) { updated++; console.log(`✓ 更新: ${name}`); }
      else console.log(`✗ 更新エラー: ${name} - ${error.message}`);
    } else {
      const { error } = await supabase.from('suppliers').insert({ name, ...payload });
      if (!error) { inserted++; console.log(`＋ 新規: ${name}`); }
      else console.log(`✗ 挿入エラー: ${name} - ${error.message}`);
    }
  }

  // 5. short_name 設定
  console.log('\n--- short_name（CSV略称）設定 ---');
  const { data: allSuppliers } = await supabase.from('suppliers').select('id,name');
  const nameToId = new Map(allSuppliers.map(s => [norm(s.name), s.id]));

  let shortSet = 0, shortInserted = 0;
  const processed = new Set();

  for (const [shortName, supplierName] of Object.entries(SHORT_MAP)) {
    const id = nameToId.get(norm(supplierName));
    if (id) {
      if (!processed.has(id)) {
        await supabase.from('suppliers').update({ short_name: shortName }).eq('id', id);
        processed.add(id);
        shortSet++;
        console.log(`  ${shortName} → ${supplierName}`);
      }
    } else {
      // 存在しない仕入先は新規追加
      const { error } = await supabase.from('suppliers').insert({ name: supplierName, short_name: shortName });
      if (!error) { shortInserted++; console.log(`  ＋新規(略称): ${shortName} → ${supplierName}`); }
    }
  }

  console.log('\n========== 完了 ==========');
  console.log(`既存更新:      ${updated} 件`);
  console.log(`新規追加:      ${inserted + shortInserted} 件`);
  console.log(`short_name設定: ${shortSet} 件`);
  console.log('===========================');
}

run().catch(console.error);
