/**
 * generate-reconciliation.mjs
 * Excel在庫表×DBの照合作業用ファイルを生成する
 *
 * 出力: C:\Users\user\Downloads\●照合作業用.xlsx
 * 使い方: node scripts/generate-reconciliation.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX   = require('xlsx');
const ExcelJS = require('exceljs');

const SOURCE = 'C:/Users/user/Downloads/●今見る在庫表.xlsx';
const OUTPUT = 'C:/Users/user/Downloads/●照合作業用.xlsx';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s　]+/g, '');

// 編集距離（Levenshtein）で類似度スコアを計算
function similarity(a, b) {
  if (!a || !b) return 0;
  const na = norm(a), nb = norm(b);
  if (na === nb) return 1;
  // 短い方の先頭N文字が一致する割合
  const minLen = Math.min(na.length, nb.length);
  let common = 0;
  for (let i = 0; i < minLen; i++) {
    if (na[i] === nb[i]) common++;
    else break;
  }
  // containsボーナス
  const contains = na.includes(nb.slice(0, Math.min(nb.length, 8))) ||
                   nb.includes(na.slice(0, Math.min(na.length, 8)));
  return (common / Math.max(na.length, nb.length)) + (contains ? 0.3 : 0);
}

async function fetchAll(selectCols, buildQuery = q => q) {
  const CHUNK = 1000;
  let from = 0;
  const all = [];
  while (true) {
    const base = sb.from('products').select(selectCols).range(from, from + CHUNK - 1);
    const { data, error } = await buildQuery(base);
    if (error) { console.error(error.message); break; }
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < CHUNK) break;
    from += CHUNK;
  }
  return all;
}

async function run() {
  // ── 元Excel読み込み ──
  console.log('元ファイル読み込み中...');
  const srcWb = XLSX.readFile(SOURCE);
  const srcWs = srcWb.Sheets[srcWb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(srcWs, { header: 1, defval: '' });
  const excelRows = raw.slice(4).filter(r => String(r[4] || '').trim() !== '');
  console.log(`Excel商品数: ${excelRows.length}件`);

  // ── DB全商品取得 ──
  console.log('DBデータ取得中...');
  const dbProducts = await fetchAll('id,name,product_code,purchase_maker,category,stock,reorder_level,cost');
  console.log(`DB商品数: ${dbProducts.length}件`);

  // ── 突合マップ構築 ──
  const dbByExact = new Map();
  const dbByPrefix = new Map();
  for (const p of dbProducts) {
    const key = norm(p.name);
    if (!dbByExact.has(key)) dbByExact.set(key, p);
    const pref = key.slice(0, 12);
    if (!dbByPrefix.has(pref)) dbByPrefix.set(pref, []);
    dbByPrefix.get(pref).push({ key, p });
  }

  function findDb(name) {
    const nk = norm(name);
    if (dbByExact.has(nk)) return { p: dbByExact.get(nk), score: 1.0, how: '完全一致' };
    const pref = nk.slice(0, 12);
    for (const { key, p } of (dbByPrefix.get(pref) || [])) {
      if (key.startsWith(nk) || nk.startsWith(key)) {
        const sc = Math.min(nk.length, key.length) / Math.max(nk.length, key.length);
        return { p, score: sc, how: '前方一致' };
      }
    }
    return null;
  }

  // ── 各Excelrow に対してDB候補を最大3件取得 ──
  function getCandidates(name, currentMatch) {
    const nk = norm(name);
    const scores = [];
    for (const p of dbProducts) {
      const s = similarity(name, p.name);
      if (s > 0.25) scores.push({ p, score: s });
    }
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, 3);
  }

  // ── ExcelJSでWorkbook生成 ──
  const wb = new ExcelJS.Workbook();

  // ============================================================
  // シート1: 突合済み（302件）
  // ============================================================
  const ws1 = wb.addWorksheet('✅突合済み（確認用）');
  ws1.columns = [
    { width: 5  }, // A: No
    { width: 8  }, // B: 棚番号
    { width: 5  }, // C: 棚段
    { width: 14 }, // D: Excel_メーカー
    { width: 42 }, // E: Excel_商品名
    { width: 42 }, // F: DB_商品名（正式）
    { width: 14 }, // G: DB_商品コード
    { width: 14 }, // H: DB_カテゴリ
    { width: 8  }, // I: DB在庫
    { width: 10 }, // J: 突合方法
    { width: 38 }, // K: DB_ID
  ];

  const thin1 = { style: 'thin', color: { argb: 'FFCCCCCC' } };
  const bdr1  = { top: thin1, left: thin1, bottom: thin1, right: thin1 };
  const ctr   = { horizontal: 'center', vertical: 'middle' };
  const lft   = { horizontal: 'left',   vertical: 'middle' };

  // ヘッダー
  const h1Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  const h1Font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 9 };
  const hdrs1 = ['No','棚番号','棚段','Excel_メーカー','Excel_商品名（元）','DB_商品名（正式）','DB_商品コード','DB_カテゴリ','DB_在庫','突合方法','DB_ID'];
  ws1.getRow(1).height = 18;
  hdrs1.forEach((h, i) => {
    const cell = ws1.getCell(1, i + 1);
    cell.value = h;
    cell.font = h1Font;
    cell.fill = h1Fill;
    cell.border = bdr1;
    cell.alignment = ctr;
  });

  let no = 0;
  let row1 = 2;
  for (const r of excelRows) {
    const name = String(r[4] || '').trim();
    const res = findDb(name);
    if (!res) continue;
    no++;
    const { p, score, how } = res;
    const nameSame = p.name === name;
    const rowObj = ws1.getRow(row1);
    rowObj.height = 15;
    const vals = [no, r[1], r[2], r[3], name, p.name, p.product_code || '', p.category || '', p.stock ?? '', how, p.id];
    vals.forEach((v, i) => {
      const cell = ws1.getCell(row1, i + 1);
      cell.value = v;
      cell.font = { name: 'Arial', size: 9 };
      cell.border = bdr1;
      cell.alignment = i < 3 ? ctr : lft;
      // 名前が違う場合はオレンジ背景
      if (i === 4 && !nameSame) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0B2' } };
      }
      if (i === 5 && !nameSame) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
        cell.font = { name: 'Arial', size: 9, color: { argb: 'FF1B5E20' } };
      }
    });
    row1++;
  }
  console.log(`突合済みシート: ${no}件`);

  // ============================================================
  // シート2: 未突合（300件）← ここに手動でDB商品IDを入力してもらう
  // ============================================================
  const ws2 = wb.addWorksheet('❌未突合（手動照合）');
  ws2.columns = [
    { width: 5  }, // A: No
    { width: 8  }, // B: 棚番号
    { width: 5  }, // C: 棚段
    { width: 14 }, // D: Excel_メーカー
    { width: 42 }, // E: Excel_商品名
    { width: 10 }, // F: 単価（元）
    { width: 42 }, // G: DB候補1_商品名
    { width: 38 }, // H: DB候補1_ID
    { width: 42 }, // I: DB候補2_商品名
    { width: 38 }, // J: DB候補2_ID
    { width: 42 }, // K: DB候補3_商品名
    { width: 38 }, // L: DB候補3_ID
    { width: 38 }, // M: ★確定DB_ID（ここに入力）
    { width: 10 }, // N: 処理方法
  ];

  const h2Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC62828' } };
  const h2Font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 9 };
  const hdrs2 = [
    'No','棚番号','棚段','Excel_メーカー','Excel_商品名',
    '単価（元）',
    'DB候補1_商品名','DB候補1_ID',
    'DB候補2_商品名','DB候補2_ID',
    'DB候補3_商品名','DB候補3_ID',
    '★確定DB_ID\n（ここに入力）',
    '処理方法\n（DBにない場合\n「新規追加」と記入）'
  ];
  ws2.getRow(1).height = 36;
  ws2.getRow(2).height = 14;
  ws2.getCell('A2').value = '※ M列に対応するDB商品IDを入力。DBにない商品はN列に「新規追加」と記入してください。';
  ws2.getCell('A2').font = { italic: true, size: 9, name: 'Arial', color: { argb: 'FF666666' } };
  ws2.mergeCells('A2:N2');

  hdrs2.forEach((h, i) => {
    const cell = ws2.getCell(1, i + 1);
    cell.value = h;
    cell.font = h2Font;
    cell.fill = h2Fill;
    cell.border = bdr1;
    cell.alignment = { ...ctr, wrapText: true };
  });

  let no2 = 0;
  let row2 = 3;
  console.log('未突合商品のDB候補検索中（時間がかかります）...');

  for (const r of excelRows) {
    const name = String(r[4] || '').trim();
    const res = findDb(name);
    if (res) continue; // マッチしたものは除外
    no2++;

    const cands = getCandidates(name);

    const rowObj = ws2.getRow(row2);
    rowObj.height = 15;

    const vals = [
      no2, r[1], r[2], r[3], name, Number(r[6]) || '',
      cands[0]?.p.name || '', cands[0]?.p.id || '',
      cands[1]?.p.name || '', cands[1]?.p.id || '',
      cands[2]?.p.name || '', cands[2]?.p.id || '',
      '', // M: ★確定DB_ID
      '', // N: 処理方法
    ];

    vals.forEach((v, i) => {
      const cell = ws2.getCell(row2, i + 1);
      cell.value = v;
      cell.font = { name: 'Arial', size: 9 };
      cell.border = bdr1;
      cell.alignment = i < 3 ? ctr : lft;

      // Excel名: 黄色
      if (i === 4) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF99' } };
      // DB候補1名: 薄緑
      if (i === 6) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
      // DB候補2名: 薄緑
      if (i === 8) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F8E9' } };
      // DB候補3名: 薄緑
      if (i === 10) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FBE7' } };
      // ★確定DB_ID: 薄い水色（入力欄）
      if (i === 12) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } };
      // 処理方法: 薄いピンク
      if (i === 13) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4EC' } };
    });

    row2++;
  }
  console.log(`未突合シート: ${no2}件`);

  // ============================================================
  // シート3: DB商品一覧（参照用）
  // ============================================================
  const ws3 = wb.addWorksheet('DB商品一覧（参照用）');
  ws3.columns = [
    { width: 38 }, // A: ID
    { width: 50 }, // B: 商品名
    { width: 14 }, // C: 商品コード
    { width: 14 }, // D: メーカー(purchase_maker)
    { width: 14 }, // E: カテゴリ
    { width: 8  }, // F: 在庫
    { width: 10 }, // G: 原価
  ];
  const h3Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF37474F' } };
  const h3Font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 9 };
  const hdrs3 = ['DB_ID', '商品名', '商品コード', 'メーカー(purchase_maker)', 'カテゴリ', '在庫数', '原価'];
  ws3.getRow(1).height = 18;
  hdrs3.forEach((h, i) => {
    const cell = ws3.getCell(1, i + 1);
    cell.value = h;
    cell.font = h3Font;
    cell.fill = h3Fill;
    cell.border = bdr1;
    cell.alignment = ctr;
  });
  ws3.getRow(2).height = 12;
  ws3.getCell('A2').value = '※ B列（商品名）またはC列（商品コード）でCtrl+Fして検索し、対応するDB_IDをM列に貼り付けてください。';
  ws3.getCell('A2').font = { italic: true, size: 9, name: 'Arial', color: { argb: 'FF666666' } };
  ws3.mergeCells('A2:G2');

  let row3 = 3;
  for (const p of dbProducts) {
    const rowObj = ws3.getRow(row3);
    rowObj.height = 14;
    [p.id, p.name, p.product_code || '', p.purchase_maker || '', p.category || '', p.stock ?? '', p.cost ?? ''].forEach((v, i) => {
      const cell = ws3.getCell(row3, i + 1);
      cell.value = v;
      cell.font = { name: 'Arial', size: 9 };
      cell.border = bdr1;
      cell.alignment = lft;
    });
    row3++;
  }

  // ウィンドウ固定
  ws1.views = [{ state: 'frozen', ySplit: 1 }];
  ws2.views = [{ state: 'frozen', ySplit: 2 }];
  ws3.views = [{ state: 'frozen', ySplit: 2 }];

  await wb.xlsx.writeFile(OUTPUT);
  console.log(`\n✅ 出力完了: ${OUTPUT}`);
  console.log('\n📋 作業手順:');
  console.log('  1. 「❌未突合」シートを開く');
  console.log('  2. Excel商品名（黄色列）を見て、DB候補（緑色列）から正しいものを探す');
  console.log('  3. 対応するDB_IDを M列（水色）にコピー&ペースト');
  console.log('  4. DBにない商品は N列に「新規追加」と記入');
  console.log('  5. DB商品一覧（参照用）シートでCtrl+Fして商品を探すことも可能');
  console.log('  6. ファイルを保存して次のスクリプトを実行');
}

run().catch(console.error);
