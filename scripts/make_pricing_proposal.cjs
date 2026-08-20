const JSZip = require('jszip');
const fs = require('fs');

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function para(text, opts){
  opts = opts||{};
  var sz=opts.sz||20, bold=opts.bold||false, color=opts.color||'000000', italic=opts.italic||false,
      spaceAfter=opts.spaceAfter!=null?opts.spaceAfter:80, spaceBefore=opts.spaceBefore||0,
      align=opts.align||'left', indent=opts.indent||0;
  var rpr='<w:rPr>'+(bold?'<w:b/>':'')+(italic?'<w:i/>':'')
    +'<w:sz w:val="'+sz+'"/><w:szCs w:val="'+sz+'"/>'
    +(color!=='000000'?'<w:color w:val="'+color+'"/>':'')
    +'</w:rPr>';
  var ppr='<w:pPr><w:jc w:val="'+align+'"/>'
    +'<w:spacing w:after="'+spaceAfter+'" w:before="'+spaceBefore+'"/>'
    +(indent?'<w:ind w:left="'+indent+'"/>':'')
    +'</w:pPr>';
  var runs=String(text).split('\n').map(function(line,i){
    return (i>0?'<w:r><w:br/></w:r>':'')+(line?'<w:r>'+rpr+'<w:t xml:space="preserve">'+esc(line)+'</w:t></w:r>':'<w:r>'+rpr+'<w:t></w:t></w:r>');
  }).join('');
  return '<w:p>'+ppr+runs+'</w:p>';
}

function h1(t){ return para(t,{sz:36,bold:true,color:'1F497D',spaceAfter:160,spaceBefore:0}); }
function h2(t){ return para(t,{sz:26,bold:true,color:'2E74B5',spaceAfter:120,spaceBefore:280}); }
function h3(t){ return para(t,{sz:22,bold:true,color:'365F91',spaceAfter:80,spaceBefore:140}); }
function body(t,opts){ return para(t,Object.assign({sz:20},opts||{})); }
function note(t){ return para(t,{sz:18,italic:true,color:'595959',spaceAfter:60}); }
function sep(){ return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="2E74B5"/></w:pBdr><w:spacing w:after="80" w:before="80"/></w:pPr></w:p>'; }
function bigPrice(t,opts){
  opts=opts||{};
  return para(t,{sz:opts.sz||44,bold:true,color:opts.color||'1F497D',align:'center',spaceAfter:80,spaceBefore:80});
}

function trow(cells, header){
  return '<w:tr>'+cells.map(function(c, ci){
    var fill=header?'<w:shd w:val="clear" w:color="auto" w:fill="2E74B5"/>':'<w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/>';
    var rpr=header
      ?'<w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>'
      :'<w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>';
    var borders='<w:tcBorders><w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/></w:tcBorders>';
    return '<w:tc><w:tcPr>'+fill+borders+'</w:tcPr><w:p><w:pPr><w:spacing w:after="60"/></w:pPr><w:r>'+rpr+'<w:t xml:space="preserve">'+esc(c)+'</w:t></w:r></w:p></w:tc>';
  }).join('')+'</w:tr>';
}
function trowHL(cells){  // highlight row (light blue)
  return '<w:tr>'+cells.map(function(c,ci){
    var fill='<w:shd w:val="clear" w:color="auto" w:fill="DEEAF1"/>';
    var rpr='<w:rPr><w:b/><w:sz w:val="20"/><w:szCs w:val="20"/><w:color w:val="1F497D"/></w:rPr>';
    var borders='<w:tcBorders><w:top w:val="single" w:sz="6" w:color="2E74B5"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="6" w:color="2E74B5"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/></w:tcBorders>';
    return '<w:tc><w:tcPr>'+fill+borders+'</w:tcPr><w:p><w:pPr><w:spacing w:after="80"/></w:pPr><w:r>'+rpr+'<w:t xml:space="preserve">'+esc(c)+'</w:t></w:r></w:p></w:tc>';
  }).join('')+'</w:tr>';
}
function table(rows){ return '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblLook w:val="04A0"/></w:tblPr>'+rows.join('')+'</w:tbl><w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>'; }

var paras = [
  para('',{spaceAfter:500}),
  h1('歯科医院向け 材料発注管理アプリ'),
  h1('正式導入　料金提案書'),
  sep(),
  body('本資料は、試験導入（PoC）終了後の正式契約に向けた料金・サービス内容のご提案です。',{spaceAfter:80}),
  body('2026年5月',{spaceAfter:40}),
  body('提案者：松浦　（株式会社清新）',{bold:true,spaceAfter:40}),
  body('提出先：[責任者・決裁者 氏名]　様',{spaceAfter:300}),
  sep(),

  // 1. 料金プラン
  h2('1. 料金プラン'),
  body('正式導入にあたり、以下の2プランをご提案します。',{spaceAfter:100}),

  // プランA
  h3('【プランA　スタンダード】'),
  table([
    trow(['費用区分','金額（税抜）','内容'],true),
    trowHL(['初期費用','1,500,000 円','システム導入・初期設定・研修・マニュアル整備一式']),
    trowHL(['月額利用料','5,000 円 / 月','サーバー・保守・サポート費用込み']),
    trow(['年間コスト（初年度）','1,560,000 円','初期費用 + 月額 × 12か月']),
    trow(['年間コスト（2年目以降）','60,000 円','月額のみ']),
  ]),
  note('※ 対象医院数に上限はありません。複数医院をご利用の場合も月額5,000円です。'),

  // プランB
  h3('【プランB　早期導入割引】'),
  body('PoC評価後、速やかにご契約いただける場合（PoC終了から30日以内）に適用可能な特別価格です。',{spaceAfter:80}),
  table([
    trow(['費用区分','金額（税抜）','内容'],true),
    trowHL(['初期費用','1,000,000 円','通常価格より500,000円割引']),
    trowHL(['月額利用料','5,000 円 / 月','同上（変更なし）']),
    trow(['年間コスト（初年度）','1,060,000 円','初期費用 + 月額 × 12か月']),
    trow(['年間コスト（2年目以降）','60,000 円','月額のみ']),
  ]),
  note('※ 早期導入割引の適用条件：PoC終了確認日から30日以内に正式契約書を締結いただいた場合。'),
  note('※ 割引の適用可否は、PoC終了後に改めて協議の上で確定します。'),

  // 2. 初期費用の内訳
  h2('2. 初期費用の内訳'),
  body('初期費用（1,500,000円）には以下の作業・サービスが含まれます。',{spaceAfter:80}),
  table([
    trow(['項目','内容'],true),
    trow(['システム初期設定','医院・商品・仕入先マスタの登録。権限・アクセス設定']),
    trow(['データ移行支援','既存の発注リスト・商品マスタ等のデータ移行サポート']),
    trow(['操作研修','管理者・スタッフ向け操作説明会（現地またはオンライン）']),
    trow(['マニュアル整備','貴社業務フローに合わせたカスタムマニュアルの作成・納品']),
    trow(['導入後サポート（3か月）','導入後3か月間の優先サポート対応（問い合わせ・不具合対応）']),
    trow(['カスタマイズ対応（軽微なもの）','PoCで判明した改善要望のうち、軽微なものを初期費用内で対応']),
  ]),

  // 3. 月額利用料の内訳
  h2('3. 月額利用料（5,000円）の内訳'),
  table([
    trow(['項目','内容'],true),
    trow(['サーバー・インフラ費','クラウドサーバー・データベース・ストレージ費用']),
    trow(['保守・障害対応','システム障害時の一次対応・復旧作業']),
    trow(['定期バックアップ','データの定期バックアップ・復元対応']),
    trow(['機能アップデート','軽微な機能改善・UI改善の反映']),
    trow(['ヘルプデスクサポート','操作に関する問い合わせ対応（平日対応）']),
  ]),
  note('※ 大規模なカスタマイズ・新機能開発は別途お見積りとなります。'),

  // 4. 含まれる機能
  h2('4. ご利用いただける機能一覧'),
  table([
    trow(['カテゴリ','機能'],true),
    trow(['医院スタッフ向け','商品検索・カート発注・注文確認・発注履歴']),
    trow(['受注・納品管理','受注一覧・ステータス管理・納品書発行（医院別まとめ対応）']),
    trow(['請求・入金管理','月次一括請求書発行・請求明細書・入金処理・売掛金台帳・銀行CSV消込']),
    trow(['仕入れ管理','仕入先発注書作成・入荷登録（PDFのAI読込）・在庫自動更新']),
    trow(['在庫管理','リアルタイム在庫・発注点管理・棚卸・在庫評価・在庫履歴']),
    trow(['分析・レポート','売上分析・注文傾向・医院別実績ダッシュボード']),
    trow(['マスター管理','商品・医院・仕入先マスタ管理']),
  ]),

  // 5. 契約条件
  h2('5. 契約条件'),
  table([
    trow(['項目','内容'],true),
    trow(['契約形態','サービス利用契約（月額）']),
    trow(['契約期間','最低契約期間：1年間。以後1年ごとの自動更新']),
    trow(['解約通知','更新日の30日前までに書面にて通知']),
    trow(['支払方法','初期費用：契約締結後30日以内に一括払い\n月額：毎月末日払い（翌月分前払い）']),
    trow(['消費税','上記金額はすべて税抜表示。別途消費税（10%）が加算されます']),
    trow(['データ返却','解約時、希望に応じてCSV形式でデータを返却']),
    trow(['所有権','システムの所有権・著作権は提案者（松浦）に帰属']),
  ]),

  // 6. プラン比較
  h2('6. プラン比較'),
  table([
    trow(['','プランA（スタンダード）','プランB（早期導入割引）'],true),
    trow(['初期費用','1,500,000円','1,000,000円']),
    trow(['月額利用料','5,000円','5,000円']),
    trow(['初年度合計','1,560,000円','1,060,000円']),
    trow(['2年目以降（年間）','60,000円','60,000円']),
    trow(['適用条件','制限なし','PoC終了後30日以内の契約締結']),
    trow(['5年間総コスト','1,800,000円','1,300,000円']),
  ]),
  note('※ 5年間総コスト = 初期費用 + 月額5,000円 × 60か月'),

  // 7. 想定ROI
  h2('7. 費用対効果（参考）'),
  body('PoC検証データをもとに、以下の削減効果が見込まれます。',{spaceAfter:80}),
  table([
    trow(['削減項目','想定削減効果（月次）','年間換算（参考）'],true),
    trow(['発注・確認作業時間の削減','時間削減 × スタッフ人件費','管理工数削減']),
    trow(['発注ミス・重複対応コスト削減','月次ミス件数の50%削減','クレーム・再発注コスト削減']),
    trow(['請求・入金処理の効率化','月次請求処理時間40%削減','経理工数削減']),
    trow(['在庫ロス・過剰発注の削減','在庫差異50%削減','廃棄・過剰在庫コスト削減']),
  ]),
  note('※ 具体的な削減金額はPoC終了後の効果測定データをもとに算出します。'),

  // 8. 今後のスケジュール
  h2('8. 今後のスケジュール（目安）'),
  table([
    trow(['時期','内容'],true),
    trow(['PoC終了後 2週間以内','効果測定報告書の提出・評価会議の実施']),
    trow(['評価会議後 2週間以内','本提案書をもとに料金・契約条件の最終協議']),
    trow(['合意後 速やかに','正式契約書の締結（初期費用の請求）']),
    trow(['契約締結後 2〜4週間','初期設定・データ移行・研修の実施']),
    trow(['本稼働開始','正式サービスとして全業務に適用開始']),
  ]),

  // 9. お問い合わせ
  h2('9. ご質問・ご相談'),
  body('本提案内容に関するご不明点・ご要望は、下記までお気軽にお申し付けください。',{spaceAfter:80}),
  table([
    trow(['項目','内容'],true),
    trow(['提案者','松浦（株式会社清新）']),
    trow(['対応時間','平日・週末対応可']),
    trow(['ご連絡方法','口頭・メール・その他ご希望の方法で承ります']),
  ]),
  para('',{spaceAfter:120}),
  body('料金・条件はご状況に応じて柔軟にご相談いたします。まずはお気軽にお声がけください。',{bold:true,spaceAfter:80}),
  body('以上',{align:'right'}),
];

var docXml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  +'<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
  +' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  +'<w:body>'
  +paras.join('\n')
  +'<w:sectPr>'
  +'<w:pgSz w:w="11906" w:h="16838"/>'
  +'<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/>'
  +'</w:sectPr>'
  +'</w:body></w:document>';

var stylesXml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  +'<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  +'<w:docDefaults><w:rPrDefault><w:rPr>'
  +'<w:rFonts w:ascii="游明朝" w:hAnsi="游明朝" w:eastAsia="游明朝" w:cs="游明朝"/>'
  +'<w:sz w:val="20"/><w:szCs w:val="20"/>'
  +'</w:rPr></w:rPrDefault></w:docDefaults>'
  +'</w:styles>';

var relsXml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  +'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  +'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
  +'</Relationships>';

var rootRels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  +'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  +'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  +'</Relationships>';

var contentTypes='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  +'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  +'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  +'<Default Extension="xml" ContentType="application/xml"/>'
  +'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  +'<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
  +'</Types>';

var zip=new JSZip();
zip.file('[Content_Types].xml',contentTypes);
zip.file('_rels/.rels',rootRels);
zip.file('word/document.xml',docXml);
zip.file('word/styles.xml',stylesXml);
zip.file('word/_rels/document.xml.rels',relsXml);

zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}).then(function(buf){
  fs.writeFileSync('C:/Users/user/Downloads/歯科医院向け発注管理アプリ_料金提案書_松浦.docx',buf);
  console.log('done');
}).catch(function(e){ console.error(e); process.exit(1); });
