/**
 * generate-inventory-sheet.mjs
 * 元の在庫表ExcelをベースにDBの商品データと突合し、アプリ連動版を生成する
 *
 * 使い方: node scripts/generate-inventory-sheet.mjs
 * 出力:   C:\Users\user\Downloads\●在庫表（アプリ連動）.xlsx
 */

import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const XLSX   = require('xlsx');
const ExcelJS = require('exceljs');

const SOURCE = 'C:/Users/user/Downloads/●今見る在庫表.xlsx';
const OUTPUT = 'C:/Users/user/Downloads/●在庫表（アプリ連動）.xlsx';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// テキスト正規化（半角↔全角・大小文字・スペース統一）
const norm = s => String(s || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[\s　]+/g, '');

async function fetchAll(selectCols, buildQuery = q => q) {
  const CHUNK = 1000;
  let from = 0;
  const all = [];
  while (true) {
    const base = sb.from('products').select(selectCols).range(from, from + CHUNK - 1);
    const { data, error } = await buildQuery(base);
    if (error) { console.error(error.message); break; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < CHUNK) break;
    from += CHUNK;
  }
  return all;
}

async function run() {
  // ── 1. 元Excelを読み込む ──────────────────────────────
  console.log('元ファイル読み込み中...');
  const srcWb = XLSX.readFile(SOURCE);
  const sheetName = srcWb.SheetNames[0];
  const srcWs = srcWb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(srcWs, { header: 1, defval: '' });

  // データ行（row[4]に商品名があるもの）
  const srcRows = raw.slice(4).filter(r => String(r[4] || '').trim() !== '');
  console.log(`元ファイル商品数: ${srcRows.length}件`);

  // ── 2. DBから全商品を取得 ──────────────────────────────
  console.log('DBデータ取得中...');
  const dbProducts = await fetchAll(
    'id,name,product_code,purchase_maker,category,stock,reorder_level,cost,price,active',
    q => q.order('name', { ascending: true })
  );
  console.log(`DB商品数: ${dbProducts.length}件`);

  // DB商品を正規化名でマップ化（高速突合用）
  // DBの商品名は「商品名＋末尾に商品コード数字」の場合あり → 前方一致も使う
  const dbByExact = new Map();  // 完全一致
  const dbByPrefix = new Map(); // DBの先頭N文字で前方一致
  const dbByCode = new Map();
  for (const p of dbProducts) {
    const key = norm(p.name);
    if (!dbByExact.has(key)) dbByExact.set(key, p);
    // 先頭10文字をキーにして前方一致用マップ
    const prefix = key.slice(0, 10);
    if (!dbByPrefix.has(prefix)) dbByPrefix.set(prefix, []);
    dbByPrefix.get(prefix).push({ key, p });
    if (p.product_code) dbByCode.set(String(p.product_code).trim(), p);
  }

  // Excel商品名に対してDB突合する関数
  function findDbProduct(excelName) {
    const nk = norm(excelName);
    // 1. 完全一致
    if (dbByExact.has(nk)) return dbByExact.get(nk);
    // 2. DBのnorm名がExcel名で始まる（DBに末尾コードが付いているケース）
    const prefix = nk.slice(0, 10);
    const candidates = dbByPrefix.get(prefix) || [];
    for (const { key, p } of candidates) {
      if (key.startsWith(nk) || nk.startsWith(key)) return p;
    }
    return null;
  }

  // ── 3. ExcelJSでワークブック作成 ────────────────────────
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('棚卸表');

  // 列定義
  ws.columns = [
    { key: 'no',        width: 5  },   // A
    { key: 'location',  width: 8  },   // B: 棚番号
    { key: 'shelfNo',   width: 5  },   // C: 棚段
    { key: 'maker',     width: 14 },   // D: メーカー
    { key: 'name',      width: 42 },   // E: 商品名
    { key: 'code',      width: 14 },   // F: 商品コード(DB)
    { key: 'category',  width: 12 },   // G: カテゴリ(DB)
    { key: 'dbStock',   width: 9  },   // H: DB現在庫
    { key: 'countQty',  width: 9  },   // I: 棚卸数量（手記入）
    { key: 'diff',      width: 8  },   // J: 差異(I-H)
    { key: 'unitCost',  width: 11 },   // K: 単価（元Excel）
    { key: 'total',     width: 13 },   // L: 棚卸金額（I×K）
    { key: 'reorder',   width: 9  },   // M: 発注点(DB)
    { key: 'dbId',      width: 38 },   // N: DB商品ID
    { key: 'matched',   width: 8  },   // O: 突合結果
  ];

  // スタイル定数
  const thin  = { style: 'thin', color: { argb: 'FFAAAAAA' } };
  const bdr   = { top: thin, left: thin, bottom: thin, right: thin };
  const ctr   = { horizontal: 'center', vertical: 'middle' };
  const lft   = { horizontal: 'left',   vertical: 'middle' };
  const rgt   = { horizontal: 'right',  vertical: 'middle' };
  const hFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  const hFont = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 9 };

  // ── タイトル行 ──
  ws.getRow(1).height = 28;
  ws.getCell('A1').value = '在庫表（棚卸用・アプリ連動版）';
  ws.getCell('A1').font = { bold: true, size: 15, name: 'Arial', color: { argb: 'FF1F4E79' } };
  ws.getCell('A1').alignment = lft;
  ws.mergeCells('A1:H1');
  ws.getCell('I1').value = `出力日: ${new Date().toLocaleDateString('ja-JP')}`;
  ws.getCell('I1').font = { size: 10, name: 'Arial', color: { argb: 'FF888888' } };
  ws.getCell('I1').alignment = { horizontal: 'right', vertical: 'middle' };
  ws.mergeCells('I1:O1');

  // ── 合計金額行 ──
  ws.getRow(2).height = 22;
  ws.getCell('A2').value = '棚卸合計金額';
  ws.getCell('A2').font = { bold: true, size: 11, name: 'Arial' };
  ws.mergeCells('A2:K2');
  const totalCell = ws.getCell('L2');
  totalCell.font = { bold: true, size: 13, name: 'Arial', color: { argb: 'FF1F4E79' } };
  totalCell.alignment = rgt;
  totalCell.numFmt = '¥#,##0';

  // 使い方メモ
  ws.getRow(3).height = 14;
  ws.getCell('A3').value = '※ 黄色セル（I列）に棚卸数量を記入。差異(J列)＝棚卸数量 − DB在庫。';
  ws.getCell('A3').font = { italic: true, size: 9, name: 'Arial', color: { argb: 'FF666666' } };
  ws.mergeCells('A3:O3');

  // ── ヘッダー行 ──
  ws.getRow(4).height = 20;
  const headers = [
    'No', '棚番号', '棚段', 'メーカー', '商品名', '商品コード\n(DB)', 'カテゴリ\n(DB)',
    'DB在庫', '棚卸数量\n（記入）', '差異', '単価', '棚卸金額', '発注点\n(DB)',
    'DB商品ID', '突合'
  ];
  headers.forEach((h, i) => {
    const cell = ws.getCell(4, i + 1);
    cell.value = h;
    cell.font = hFont;
    cell.fill = hFill;
    cell.border = bdr;
    cell.alignment = { ...ctr, wrapText: true };
  });

  // ── データ行 ──
  const DATA_START = 5;
  let rowNum = DATA_START;
  let matched = 0, unmatched = 0;
  let prevLoc = null;

  for (const r of srcRows) {
    const location = String(r[1] || '').trim();
    const shelfNo  = r[2];
    const maker    = String(r[3] || '').trim();
    const name     = String(r[4] || '').trim();
    const qty      = r[5];          // 元Excelの棚卸数量（参考値）
    const unitCost = Number(r[6]) || 0;

    // DB突合（商品名で照合：完全一致→前方一致）
    const dbP = findDbProduct(name);
    const isMatched = !!dbP;
    if (isMatched) matched++; else unmatched++;

    const isNewLoc = location !== prevLoc;
    prevLoc = location;
    const rowBg = isNewLoc
      ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F7FF' } }
      : null;

    const row = ws.getRow(rowNum);
    row.height = 15;

    const setCel = (col, val, align, fmt, formula) => {
      const cell = ws.getCell(rowNum, col);
      if (formula) { cell.value = { formula }; }
      else         { cell.value = val; }
      cell.font      = { name: 'Arial', size: 9 };
      cell.alignment = { ...align, wrapText: col === 5 };
      cell.border    = bdr;
      if (rowBg) cell.fill = rowBg;
      if (fmt)   cell.numFmt = fmt;
    };

    // A: No
    setCel(1, rowNum - DATA_START + 1, ctr);
    // B: 棚番号
    setCel(2, location, ctr);
    if (isNewLoc && location) {
      ws.getCell(rowNum, 2).font = { bold: true, size: 9, name: 'Arial', color: { argb: 'FF1F4E79' } };
    }
    // C: 棚段
    setCel(3, shelfNo, ctr);
    // D: メーカー
    setCel(4, maker, lft);
    // E: 商品名
    setCel(5, name, lft);
    // F: 商品コード（DB）
    setCel(6, dbP?.product_code || '', lft);
    // G: カテゴリ（DB）
    setCel(7, dbP?.category || '', ctr);
    // H: DB現在庫
    {
      const cell = ws.getCell(rowNum, 8);
      const stock = dbP?.stock ?? null;
      cell.value = stock;
      cell.font  = { name: 'Arial', size: 9 };
      cell.alignment = ctr;
      cell.border = bdr;
      if (stock === null) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } };
        cell.font = { ...cell.font, color: { argb: 'FF999999' } };
        cell.value = '―';
      } else if (stock === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD7D7' } };
        cell.font = { ...cell.font, color: { argb: 'FFCC0000' }, bold: true };
      } else if (dbP?.reorder_level && stock <= dbP.reorder_level) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0B2' } };
        cell.font = { ...cell.font, color: { argb: 'FFE65100' } };
      } else if (rowBg) {
        cell.fill = rowBg;
      }
    }
    // I: 棚卸数量（黄色入力欄）
    {
      const cell = ws.getCell(rowNum, 9);
      cell.value = '';
      cell.font = { name: 'Arial', size: 9 };
      cell.alignment = ctr;
      cell.border = bdr;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF99' } };
    }
    // J: 差異
    setCel(10, null, ctr, '+#,##0;-#,##0;"-"', `IF(I${rowNum}="","",I${rowNum}-H${rowNum})`);
    // K: 単価
    setCel(11, unitCost, rgt, '#,##0');
    // L: 棚卸金額
    setCel(12, null, rgt, '¥#,##0', `IF(I${rowNum}="","",I${rowNum}*K${rowNum})`);
    // M: 発注点
    setCel(13, dbP?.reorder_level ?? '', ctr);
    // N: DB商品ID
    setCel(14, dbP?.id || '', lft);
    // O: 突合結果
    {
      const cell = ws.getCell(rowNum, 15);
      cell.value = isMatched ? '✓' : '✗';
      cell.font  = { name: 'Arial', size: 9, bold: true,
                     color: { argb: isMatched ? 'FF006600' : 'FFCC0000' } };
      cell.alignment = ctr;
      cell.border = bdr;
      cell.fill = isMatched
        ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }
        : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E0' } };
    }

    rowNum++;
  }

  // 合計金額の数式
  const lastRow = rowNum - 1;
  totalCell.value = { formula: `SUM(L${DATA_START}:L${lastRow})` };

  // ウィンドウ固定
  ws.views = [{ state: 'frozen', ySplit: 4, xSplit: 0, activeCell: 'A5' }];

  // ── 突合できなかった商品リスト（別シート） ──
  const unmatchedRows = srcRows.filter(r => {
    const name = String(r[4] || '').trim();
    return !findDbProduct(name);
  });
  if (unmatchedRows.length > 0) {
    const ws2 = wb.addWorksheet('未突合リスト');
    ws2.columns = [
      { header: '棚番号', key: 'loc',   width: 8  },
      { header: '棚段',   key: 'shelf', width: 6  },
      { header: 'メーカー', key: 'maker', width: 16 },
      { header: '商品名（元Excel）', key: 'name',  width: 50 },
      { header: '単価',   key: 'cost',  width: 12 },
    ];
    ws2.getRow(1).font = hFont;
    ws2.getRow(1).fill = hFill;
    unmatchedRows.forEach(r => {
      ws2.addRow({
        loc: r[1], shelf: r[2], maker: r[3], name: r[4], cost: r[6]
      });
    });
  }

  await wb.xlsx.writeFile(OUTPUT);

  console.log(`\n✅ 出力完了: ${OUTPUT}`);
  console.log(`   元Excel商品数:  ${srcRows.length}件`);
  console.log(`   DB突合成功:     ${matched}件`);
  console.log(`   DB突合失敗:     ${unmatched}件 → 「未突合リスト」シートに記載`);
}

run().catch(console.error);
