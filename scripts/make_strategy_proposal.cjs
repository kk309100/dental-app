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
    return (i>0?'<w:r><w:br/></w:r>':'')+(line
      ?'<w:r>'+rpr+'<w:t xml:space="preserve">'+esc(line)+'</w:t></w:r>'
      :'<w:r>'+rpr+'<w:t></w:t></w:r>');
  }).join('');
  return '<w:p>'+ppr+runs+'</w:p>';
}

function h1(t){ return para(t,{sz:36,bold:true,color:'1F497D',spaceAfter:160}); }
function h2(t){ return para(t,{sz:26,bold:true,color:'2E74B5',spaceAfter:120,spaceBefore:280}); }
function h3(t){ return para(t,{sz:22,bold:true,color:'365F91',spaceAfter:80,spaceBefore:140}); }
function body(t,opts){ return para(t,Object.assign({sz:20},opts||{})); }
function note(t){ return para(t,{sz:18,italic:true,color:'595959',spaceAfter:60}); }
function sep(){ return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="2E74B5"/></w:pBdr><w:spacing w:after="80" w:before="80"/></w:pPr></w:p>'; }
function highlight(t,opts){
  opts=opts||{};
  return para(t,{sz:opts.sz||24,bold:true,color:opts.color||'C00000',align:opts.align||'left',spaceAfter:opts.spaceAfter||80,spaceBefore:opts.spaceBefore||80,indent:opts.indent||0});
}

function trow(cells,header,opts){
  opts=opts||{};
  return '<w:tr>'+cells.map(function(c){
    var fill=header?'<w:shd w:val="clear" w:color="auto" w:fill="2E74B5"/>'
      :(opts.hl?'<w:shd w:val="clear" w:color="auto" w:fill="FFF2CC"/>':'<w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/>');
    var fsz=header?'18':(opts.fsz||'18');
    var rpr=header
      ?'<w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="'+fsz+'"/><w:szCs w:val="'+fsz+'"/></w:rPr>'
      :(opts.hl
        ?'<w:rPr><w:b/><w:color w:val="7F4F00"/><w:sz w:val="'+fsz+'"/><w:szCs w:val="'+fsz+'"/></w:rPr>'
        :'<w:rPr><w:sz w:val="'+fsz+'"/><w:szCs w:val="'+fsz+'"/></w:rPr>');
    var borders='<w:tcBorders><w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/></w:tcBorders>';
    return '<w:tc><w:tcPr>'+fill+borders+'</w:tcPr><w:p><w:pPr><w:spacing w:after="60"/></w:pPr><w:r>'+rpr+'<w:t xml:space="preserve">'+esc(c)+'</w:t></w:r></w:p></w:tc>';
  }).join('')+'</w:tr>';
}
function table(rows){ return '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblLook w:val="04A0"/></w:tblPr>'+rows.join('')+'</w:tbl><w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>'; }
function box(lines,color){
  color=color||'DEEAF1';
  var bcolor=color==='FFF2CC'?'F4B942':color==='FFE7E7'?'C00000':'2E74B5';
  var tcolor=color==='FFF2CC'?'7F4F00':color==='FFE7E7'?'C00000':'1F497D';
  return '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="8" w:color="'+bcolor+'"/><w:left w:val="single" w:sz="8" w:color="'+bcolor+'"/><w:bottom w:val="single" w:sz="8" w:color="'+bcolor+'"/><w:right w:val="single" w:sz="8" w:color="'+bcolor+'"/></w:tblBorders><w:shd w:val="clear" w:color="auto" w:fill="'+color+'"/></w:tblPr>'
    +'<w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="'+color+'"/><w:tcBorders><w:top w:val="single" w:sz="8" w:color="'+bcolor+'"/><w:left w:val="single" w:sz="8" w:color="'+bcolor+'"/><w:bottom w:val="single" w:sz="8" w:color="'+bcolor+'"/><w:right w:val="single" w:sz="8" w:color="'+bcolor+'"/></w:tcBorders></w:tcPr>'
    +lines.map(function(l,i){ return '<w:p><w:pPr><w:spacing w:after="60"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/><w:color w:val="'+tcolor+'"/></w:rPr><w:t xml:space="preserve">'+esc(l)+'</w:t></w:r></w:p>'; }).join('')
    +'</w:tc></w:tr></w:tbl><w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>';
}

var paras = [
  // ── 表紙 ──
  para('',{spaceAfter:600}),
  h1('歯科材料　新規販路拡大 ＆'),
  h1('顧客定着強化　戦略提案書'),
  sep(),
  body('　〜 発注管理システムを活用した持続的成長モデルの構築 〜',{sz:22,italic:true,color:'2E74B5',spaceAfter:200}),
  body('2026年5月',{spaceAfter:40}),
  body('提案者：松浦',{bold:true,spaceAfter:40}),
  body('提出先：株式会社清新　経営責任者　様',{spaceAfter:300}),
  sep(),

  // ── 0. エグゼクティブサマリー ──
  h2('0. エグゼクティブサマリー'),
  box([
    '【この提案で実現できること】',
    '',
    '① 個人仲介業者ネットワークを活用し、清新の歯科材料販路を低コストで全国拡大',
    '② 発注管理システムを軸に、医院・仲介業者の両方を清新から離れにくくする構造を構築',
    '③ 初期投資150万円（またはPoC後100万円）で、長期的な競争優位を確立',
  ],'DEEAF1'),

  // ── 1. 現状と課題 ──
  h2('1. 現状の課題'),
  body('歯科材料の販売において、以下の構造的課題があります。',{spaceAfter:80}),
  table([
    trow(['課題','現状','影響'],true),
    trow(['販路の限界','営業担当者の数に販路が依存','新規開拓にコストがかかる']),
    trow(['顧客の流動性','医院は複数業者を使い分ける','価格競争に巻き込まれやすい']),
    trow(['仲介業者の忠誠心','仲介業者が複数社を並行取扱い','清新の優先度が下がりやすい']),
    trow(['データ非保有','医院の発注傾向が見えない','需要予測・提案営業ができない']),
  ]),

  // ── 2. 提案する戦略の全体像 ──
  h2('2. 提案する戦略の全体像'),
  box([
    '　　　　　　松浦（開発者）',
    '　　　　　　　　↓ システムを清新ブランドで提供',
    '　　　　　　　　　　',
    '　　★　　株式会社清新　　★',
    '　　　　「Dental Connect」として販売・管理',
    '　　　　　　　　↓ 個人仲介業者にシステムを販売',
    '　　　　　　　　　　',
    '　　個人仲介業者A　個人仲介業者B　個人仲介業者C …',
    '　　　各担当医院に導入支援・サポート',
    '　　　　　　　　↓',
    '　　歯科医院（全国 約68,700軒）',
    '　　　システム経由で清新に発注し続ける',
  ],'DEEAF1'),
  body('このモデルの最大の特徴は、システムが「清新との取引を継続する理由」を医院・仲介業者の双方に自動的に作り出す点です。',{bold:true}),

  // ── 3. メリット① 販路拡大 ──
  h2('3. 清新のメリット① ─ 販路の低コスト拡大'),
  h3('【従来モデルとの比較】'),
  table([
    trow(['','従来の販路拡大','本提案モデル'],true),
    trow(['方法','清新が直接営業・採用','仲介業者が各自で開拓']),
    trow(['コスト','営業人件費・交通費 等','システム販売費のみ']),
    trow(['スピード','担当者数に依存','仲介業者数に比例して拡大']),
    trow(['リスク','担当者退職で顧客喪失','システムが関係を維持']),
    trow(['スケール','物理的限界あり','全国展開が可能']),
  ]),
  h3('【市場ポテンシャル】'),
  table([
    trow(['指標','数値','出典'],true),
    trow(['全国の歯科医院数','約 68,700 軒','厚生労働省 医療施設動態調査（2024年）']),
    trow(['清新の現在の担当医院数（推定）','数百〜数千軒','社内データ']),
    trow(['仲介業者1人あたり担当医院（想定）','20〜50軒','業界標準']),
    trow(['仲介業者10人導入時の追加到達数','200〜500軒','試算']),
    trow(['仲介業者50人導入時の追加到達数','1,000〜2,500軒','試算']),
  ]),
  note('※ 仲介業者1人が担当する医院が清新に乗り換えるだけで、材料売上の大幅増が見込まれます。'),

  // ── 4. メリット② 離れにくい構造 ──
  h2('4. 清新のメリット② ─ 医院が離れにくい構造の構築'),
  highlight('【核心】システムを使い続けるほど「清新から離れるコスト」が上がる',{color:'C00000',sz:22}),
  body('医院がシステムを日常業務に使い始めると、以下のデータが清新のシステム上に蓄積されます。',{spaceAfter:80}),
  table([
    trow(['蓄積されるデータ','内容','乗り換えた場合の損失'],true),
    trow(['発注履歴','いつ・何を・何個注文したか','過去の発注パターンがすべて消える']),
    trow(['在庫データ','現在の在庫量・発注点設定','在庫管理をゼロから再設定が必要']),
    trow(['請求・入金履歴','取引の全財務データ','税務・経営管理データが失われる']),
    trow(['納品書・請求書','過去の書類アーカイブ','監査・確認作業が不可能になる']),
    trow(['仕入先情報','取引条件・担当者情報','関係構築のやり直しが必要']),
  ]),
  box([
    '【乗り換えコストの試算】',
    '',
    '・データ移行作業：数十万円相当の工数',
    '・新システム導入費用：50万円〜（別業者）',
    '・スタッフ再教育：数週間の業務停滞',
    '・過去データの喪失：会計・税務上のリスク',
    '',
    '→ システム利用1年後には「乗り換えコスト＞節約できる材料費差額」の状態になる',
  ],'FFE7E7'),
  body('これは業界では「スイッチングコスト」と呼ばれる競争優位の核心です。AmazonやSalesforceが高いシェアを維持できる理由と同じ原理です。',{italic:true,color:'595959'}),

  // ── 5. メリット③ 仲介業者との関係強化 ──
  h2('5. 清新のメリット③ ─ 仲介業者も離れにくくなる'),
  body('仲介業者にとっても、清新のシステムを医院に導入することで以下の恩恵があります。',{spaceAfter:80}),
  table([
    trow(['仲介業者の得られるメリット','内容'],true),
    trow(['新たな収益源','システム販売による初期収入・紹介マージン']),
    trow(['医院との関係強化','単なる「材料の売り人」から「ITパートナー」へ格上げ']),
    trow(['競合との差別化','同様のシステムを持たない他業者より優位に立てる']),
    trow(['顧客の囲い込み','自分が導入した医院が清新から離れると自分の立場も弱まる']),
  ]),
  box([
    '【重要な構造】',
    '',
    '仲介業者が清新のシステムで医院を囲い込んでいる以上、',
    '仲介業者自身が清新から離れると「自分の顧客も失う」リスクを負う。',
    '',
    '→ 仲介業者も清新に対して「離れにくい」状態になる。',
  ],'FFF2CC'),

  // ── 6. 収益シミュレーション ──
  h2('6. 収益シミュレーション（試算）'),
  h3('【システム販売収益】'),
  table([
    trow(['シナリオ','仲介業者数','初期費用収入','月額収入（年換算）','初年度合計'],true),
    trow(['小規模スタート','5人','750万円','30万円/年','780万円']),
    trow(['中規模展開','20人','3,000万円','120万円/年','3,120万円'],{hl:true}),
    trow(['本格展開','50人','7,500万円','300万円/年','7,800万円']),
  ]),
  note('※ 仲介業者への販売価格を初期費用150万円・月額5,000円/医院として試算。'),
  note('※ 仲介業者が複数医院に展開する場合、月額収入はさらに増加。'),
  h3('【材料売上への波及効果（重要）】'),
  table([
    trow(['条件','試算'],true),
    trow(['仲介業者20人・各20医院が清新に切替','400医院の新規獲得']),
    trow(['医院1軒あたり年間材料購入額（推定）','100万〜500万円']),
    trow(['新規材料売上（保守的試算・100万円/院）','400院 × 100万円 ＝ 年4億円規模']),
    trow(['システム自体の収益（上記+月額）','上記に加算'],{hl:true}),
  ]),
  note('※ 材料売上の増加がこの戦略の最大の目的。システム収益はあくまで副次的なものです。'),

  // ── 7. 競合との差別化 ──
  h2('7. 競合との差別化　─ なぜ今やるべきか'),
  body('歯科材料業界において、この戦略を先行して実施した企業が「プラットフォーム」を握ります。',{bold:true,spaceAfter:80}),
  table([
    trow(['観点','競合他社（現状）','清新（本提案後）'],true),
    trow(['販売方法','営業担当者による個別営業','仲介業者ネットワーク＋システム']),
    trow(['医院との関係','材料の売買のみ','業務システムも含む深い依存関係']),
    trow(['乗り換えリスク','価格次第で乗り換え可','乗り換えコストが高く現実的でない']),
    trow(['データ保有','なし','医院の発注・在庫・財務データを保有']),
    trow(['成長性','担当者数に依存','仲介業者数に比例して自動拡大']),
  ]),
  highlight('先行者が市場を握る ─ 医院が他社システムを採用する前に実施することが重要',{color:'C00000',sz:20}),

  // ── 8. 清新が負担すること ──
  h2('8. 清新の必要投資と回収'),
  table([
    trow(['項目','内容','金額（税抜）'],true),
    trow(['システム導入費（松浦への支払い）','清新ブランドでの提供・カスタマイズ','150万円（PoC後100万円も可）']),
    trow(['月額運用費','サーバー・保守・サポート','5,000円/月']),
    trow(['仲介業者向け説明資料','営業マニュアル・操作説明書','含む']),
    trow(['初期研修','仲介業者への操作研修','含む']),
  ]),
  box([
    '【投資回収の試算】',
    '',
    '仲介業者5人にシステム販売できれば → 150万円（初期費用）を回収',
    '仲介業者10人以上 → システム収益だけで黒字化',
    '材料売上への波及を含めると → 数倍〜数十倍のROIが期待できる',
  ],'DEEAF1'),

  // ── 9. 実施スケジュール ──
  h2('9. 実施スケジュール'),
  table([
    trow(['フェーズ','期間','内容'],true),
    trow(['Phase 1：PoC検証','〜3か月','1〜2医院での試験導入。効果測定・課題洗出し']),
    trow(['Phase 2：清新ブランド化','PoC終了後1か月','ロゴ・会社名の切替。仲介業者向け資料整備']),
    trow(['Phase 3：仲介業者開拓','〜6か月','既存仲介業者への説明・販売開始。5人目標']),
    trow(['Phase 4：本格展開','〜1年','仲介業者20人規模へ拡大。全国展開開始']),
    trow(['Phase 5：プラットフォーム化','1年以降','データ活用・需要予測・ターゲット提案営業']),
  ]),

  // ── 10. まとめ ──
  h2('10. まとめ　─ この戦略の本質的価値'),
  box([
    '本提案は「システムを売る」提案ではありません。',
    '',
    '「医院が清新から離れられない構造」を、',
    '個人仲介業者ネットワークを通じて低コストで全国に展開する',
    '持続的競争優位の構築提案です。',
    '',
    '初期投資：150万円（PoC後は100万円も交渉可）',
    '月額運用：5,000円',
    '',
    '対して得られるもの：',
    '・新規販路（仲介業者ネットワーク）',
    '・顧客定着（スイッチングコストによる離脱防止）',
    '・材料売上の持続的増加',
    '・競合他社に先行したプラットフォームの確立',
  ],'DEEAF1'),
  para('',{spaceAfter:100}),
  body('ご不明点・ご質問は提案者（松浦）までお気軽にお申し付けください。',{bold:true,spaceAfter:80}),
  body('以上',{align:'right'}),
];

var docXml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  +'<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
  +' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  +'<w:body>'+paras.join('\n')
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
  +'</w:rPr></w:rPrDefault></w:docDefaults></w:styles>';

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
  fs.writeFileSync('C:/Users/user/Downloads/清新向け_販路拡大戦略提案書_松浦.docx',buf);
  console.log('done');
}).catch(function(e){ console.error(e); process.exit(1); });
