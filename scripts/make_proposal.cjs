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
    +(color!=='000000'?'<w:color w:val="'+color+'"/></w:rPr>':'</w:rPr>');
  var ppr='<w:pPr><w:jc w:val="'+align+'"/>'
    +'<w:spacing w:after="'+spaceAfter+'" w:before="'+spaceBefore+'"/>'
    +(indent?'<w:ind w:left="'+indent+'"/>':'')
    +'</w:pPr>';
  var runs=String(text).split('\n').map(function(line,i){
    return (i>0?'<w:r><w:br/></w:r>':'')+(line?'<w:r>'+rpr+'<w:t xml:space="preserve">'+esc(line)+'</w:t></w:r>':'');
  }).join('');
  return '<w:p>'+ppr+runs+'</w:p>';
}

function h1(t){ return para(t,{sz:36,bold:true,color:'1F497D',spaceAfter:200,spaceBefore:0}); }
function h2(t){ return para(t,{sz:26,bold:true,color:'2E74B5',spaceAfter:160,spaceBefore:240}); }
function h3(t){ return para(t,{sz:22,bold:true,color:'365F91',spaceAfter:80,spaceBefore:120}); }
function body(t,opts){ return para(t,Object.assign({sz:20},opts||{})); }
function sep(){ return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="2E74B5"/></w:pBdr><w:spacing w:after="80" w:before="80"/></w:pPr></w:p>'; }

function trow(cells, header){
  return '<w:tr>'+cells.map(function(c){
    var fill=header?'<w:shd w:val="clear" w:color="auto" w:fill="2E74B5"/>':'<w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/>';
    var rpr=header?'<w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>':'<w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>';
    var borders='<w:tcBorders><w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/></w:tcBorders>';
    return '<w:tc><w:tcPr>'+fill+borders+'</w:tcPr><w:p><w:pPr><w:spacing w:after="60"/></w:pPr><w:r>'+rpr+'<w:t xml:space="preserve">'+esc(c)+'</w:t></w:r></w:p></w:tc>';
  }).join('')+'</w:tr>';
}
function table(rows){ return '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid>'+rows[0].split('<w:tc>').slice(1).map(function(){return '<w:gridCol/>';}).join('')+'</w:tblGrid>'+rows.join('')+'</w:tbl><w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>'; }

var paras = [
  para('',{spaceAfter:600}),
  h1('歯科医院向け 材料発注管理アプリ'),
  h1('試験導入（PoC）提案書'),
  sep(),
  body('本資料は、現場の発注業務における課題解決を目的として、\n試験導入（PoC）の実施をご検討いただくための提案資料です。',{spaceAfter:120}),
  para('',{spaceAfter:60}),
  body('2026年5月',{spaceAfter:40}),
  body('提案者：松浦　（株式会社清新）',{bold:true,spaceAfter:40}),
  body('提出先：[責任者・決裁者 氏名]　様',{spaceAfter:300}),
  sep(),

  h2('1. 提案の背景'),
  body('近年、医療現場においても業務効率化・デジタル化への期待が高まっています。特に材料の発注業務においては、LINE・電話・口頭など複数の手段が混在し、発注履歴の管理や確認作業に多くの手間が生じている状況です。'),
  body('こうした現場課題に対し、提案者は業務時間外・個人PCにて歯科医院向けの発注管理アプリを開発しました。本資料は、当アプリを社内資産としてではなく、外部サービスとして位置づけた上で、「実業務に本当に役立つか」を検証するための試験導入（PoC）についてご提案するものです。'),
  body('目的はあくまで現場課題の解決および効果の検証にあります。本導入への移行可否は、PoC期間中のデータ・現場評価をもとに、提案者以外の責任者・決裁者が判断してください。'),

  h2('2. 現状課題'),
  body('現在の発注業務における課題を以下に整理します。',{spaceAfter:60}),
  table([
    trow(['カテゴリ','現状の課題','生じている影響'],true),
    trow(['発注手段','LINE・電話・口頭での発注が主体','履歴が残らず、あとからの確認が困難']),
    trow(['履歴管理','発注履歴が紙・メモ・記憶に依存','発注漏れ・重複発注が頻発しやすい']),
    trow(['担当者把握','誰が何を注文したか不明確','責任の所在が曖昧になる']),
    trow(['確認漏れ','受信側の確認・集計作業に時間がかかる','管理業務の非効率化・ミス発生']),
    trow(['医院間格差','医院ごとに発注運用がバラバラ','標準化・品質管理が難しい']),
  ]),
  body('上記の課題により、スタッフの業務負荷・管理側のコスト・発注精度に影響が生じています。'),

  h2('3. アプリ概要'),
  body('本アプリは、歯科医院における材料発注業務をデジタル化・一元化することを目的としています。PoC段階では現在実装済みのすべての機能を検証対象とします。'),
  sep(),
  h3('【医院スタッフ向け機能（実装済み）】'),
  table([
    trow(['機能','説明'],true),
    trow(['商品検索・カテゴリ表示','商品をカテゴリ別に閲覧・キーワード検索']),
    trow(['カートへの追加・数量調整','複数商品をまとめてカートに追加し数量を調整']),
    trow(['注文確定・送信','注文内容を確認してそのまま送信。注文履歴の参照も可能']),
  ]),
  h3('【管理者向け機能（実装済み）】'),
  table([
    trow(['機能','説明'],true),
    trow(['受注確認・一覧表示','医院からの注文をリアルタイムで確認・医院別・ステータス別フィルタ']),
    trow(['納品ステータス管理','注文受付→確認中→準備中→納品済みの進捗管理']),
    trow(['納品書発行','A4印刷対応の納品書を自動生成。同一医院の複数注文をまとめて1枚発行も可能']),
    trow(['請求書発行・管理','月次一括請求書の自動発行。締日設定・支払期限の自動計算']),
    trow(['請求明細書（詳細版）','商品別明細・カテゴリ別集計・税率内訳付きの詳細請求書（複数ページ対応）']),
    trow(['入金処理・売掛金管理','入金記録・一部入金・完済の管理、売掛金台帳、銀行CSV自動消込']),
    trow(['仕入れ管理（入荷登録）','仕入先PDFをAI読込して在庫を自動更新。入荷後に出荷可能な注文を自動検出']),
    trow(['発注管理','仕入先への発注書作成・入荷管理・部分入荷対応']),
    trow(['在庫管理','リアルタイム在庫・発注点管理・在庫評価（原価ベース）']),
    trow(['棚卸','実棚入力と在庫差異の確認・反映。棚卸履歴の保持']),
    trow(['在庫履歴','入庫・出庫・調整の全ログを時系列で管理']),
    trow(['仕入先請求書付け合わせ','月末に仕入先から届く請求書と入荷データの照合']),
    trow(['分析ダッシュボード','売上・注文傾向・医院別実績の可視化']),
  ]),
  body('【動作環境】',{bold:true,spaceAfter:40}),
  body('・ブラウザベースのWebアプリケーション（インストール不要）\n・スマートフォン・タブレット・PCのいずれでも動作\n・インターネット接続環境があれば利用可能'),
  body('【開発・運営の位置づけ】',{bold:true,spaceAfter:40}),
  body('・本アプリは提案者が個人で開発・運営するサービスです（会社資産ではありません）\n・PoC期間中は無償または低額での提供を予定しており、正式サービスとしての契約はPoC後に別途締結します'),

  h2('4. 試験導入（PoC）の目的'),
  body('今回の試験導入では、以下の観点を検証します。本格導入の可否は、この検証結果に基づき判断いただくことを想定しています。',{spaceAfter:60}),
  body('① 実際の医院現場でシステムが問題なく動作するか検証する',{indent:360}),
  body('② 発注業務にかかる時間の削減効果を定量的に確認する',{indent:360}),
  body('③ 発注漏れ・確認漏れが減少するか、ミス発生率を測定する',{indent:360}),
  body('④ 医院スタッフが無理なく操作・継続利用できるか評価する',{indent:360}),
  body('⑤ 管理側（受注・請求・在庫管理）の作業効率が向上するか確認する',{indent:360}),
  body('⑥ 本導入前に洗い出すべき改善点・要望を収集する',{indent:360,spaceAfter:80}),
  body('PoC段階は「効果検証の期間」と位置づけており、本導入・正式契約の判断はPoC終了後に別途行っていただきます。'),

  h2('5. PoCの実施範囲'),
  table([
    trow(['項目','内容'],true),
    trow(['対象医院数','1〜2医院（希望医院を優先）']),
    trow(['実施期間','1〜3か月（開始日より）']),
    trow(['利用対象者','発注担当スタッフ・管理担当者']),
    trow(['対象業務','材料の発注操作・受注確認・納品書発行・請求書管理・在庫管理']),
    trow(['端末環境','スマートフォン・タブレット・PCいずれも可（ブラウザ動作）']),
    trow(['データ管理','クラウド管理。アクセス権限は医院単位で分離。バックアップを定期実施']),
    trow(['サポート体制','PoC期間中は提案者が一次対応（平日〜週末対応可）']),
  ]),

  h2('6. PoC期間中の費用'),
  table([
    trow(['費用区分','金額','備考'],true),
    trow(['利用費（PoC期間中）','無償 または 実費相当','サーバー・通信費等の実費が生じる場合は別途協議']),
    trow(['導入支援・研修','無償','操作説明・マニュアル提供を含む']),
    trow(['本導入後の費用','PoC後に別途協議','正式契約締結後に月額・年額を決定。PoC結果を踏まえ提示']),
  ]),
  body('※ PoC期間中に発生するサーバー費用等の実費については、金額確定後に事前にご報告・協議の上、対応を決定します。高額費用が発生する場合は事前に承認を得ます。',{italic:true,color:'595959'}),

  h2('7. 効果測定項目'),
  body('PoC終了時に以下の指標を用いて効果を測定し、報告書にまとめます。',{spaceAfter:60}),
  table([
    trow(['測定指標（KPI）','ベースライン','目標値（目安）','測定方法'],true),
    trow(['発注にかかる時間','PoC前の平均作業時間','30%以上の削減','スタッフへのアンケート']),
    trow(['発注ミス・発注漏れ件数','PoC前の月次発生件数','50%以上の削減','発注履歴との照合']),
    trow(['医院スタッフの利用率','0%（未導入）','対象者の80%以上','ログイン履歴確認']),
    trow(['管理側の確認作業時間','PoC前の平均作業時間','20%以上の削減','作業ログ・担当者確認']),
    trow(['請求処理時間','PoC前の月次作業時間','40%以上の削減','請求書発行〜入金確認の作業時間計測']),
    trow(['在庫差異・発注漏れ','PoC前の月次発生件数','50%以上の削減','在庫履歴・棚卸データとの照合']),
    trow(['問い合わせ件数（口頭等）','PoC前の月次件数','件数の減少傾向確認','担当者記録']),
    trow(['現場からの改善要望数','—','要望の収集・分類','フィードバックシート']),
  ]),

  h2('8. リスクと対応策'),
  table([
    trow(['想定リスク','対応策'],true),
    trow(['利益相反への懸念','提案者は意思決定・承認プロセスに関与しない。最終決裁は提案者以外の責任者が行う']),
    trow(['個人依存による引継ぎリスク','PoC開始時に運用マニュアルを整備。退職・担当変更時でも継続運用できる引継ぎ資料を作成']),
    trow(['正式契約前の権利・責任の曖昧さ','PoC段階は「検証扱い」とし、法的拘束力を持つ正式契約はPoC完了後に締結']),
    trow(['データ漏洩・セキュリティリスク','アクセス権限を医院・役割単位で設定。定期バックアップ実施。第三者が医院データに触れない設計']),
    trow(['スタッフの操作・定着リスク','導入前に操作説明会を実施。マニュアルを常時参照可能な形で配布。問い合わせ窓口を明確にする']),
    trow(['将来的な個人サービス運営リスク','将来的には法人化または外部サービスとして正式な契約体制を整備し、個人依存を排除する']),
  ]),

  h2('9. PoC後の流れ'),
  table([
    trow(['フェーズ','内容','時期（目安）','詳細'],true),
    trow(['Step 1','PoC実施','1〜3か月','アプリを実業務に試験導入。発注・受注・請求・在庫業務を通じて検証を行う']),
    trow(['Step 2','効果測定集計','PoC終了後 1週間以内','KPIデータを集計し、改善要望と合わせて報告書を作成']),
    trow(['Step 3','報告・評価会議','PoC終了後 2週間以内','決裁者・責任者に効果測定結果を報告。本導入可否を協議']),
    trow(['Step 4','本導入判断','協議完了後','導入継続の場合は正式契約条件（費用・保守・所有権等）を確定']),
    trow(['Step 5','正式契約・本導入','判断後 速やかに','法的効力を持つ契約書を締結。対象医院を拡大・サービス体制を整備']),
  ]),
  body('※ 本導入を判断しない（見送り・中止）という結論も当然あり得ます。その場合も、蓄積されたデータ・知見は現場改善の参考として活用いただけます。',{italic:true,color:'595959'}),

  h2('10. 次回打合せで確認したい事項'),
  table([
    trow(['No.','確認事項','補足'],true),
    trow(['①','PoC参加医院の確定','参加を検討いただける医院名、担当者をご教示ください']),
    trow(['②','PoC開始時期の調整','準備期間を含め、開始可能な時期をご確認ください']),
    trow(['③','利用者・権限範囲の確認','どのスタッフが使用するか、管理者権限の範囲を確認']),
    trow(['④','ベースラインデータの収集方法','現状の発注時間・ミス件数の把握方法をすり合わせ']),
    trow(['⑤','セキュリティ・データ取扱方針','院内のセキュリティポリシーとの整合性を確認']),
    trow(['⑥','PoC期間中の連絡体制','担当窓口・連絡手段・緊急時対応を決定']),
    trow(['⑦','本導入判断の基準・プロセス','誰がどの基準で判断するか、社内決裁フローを確認']),
  ]),
  para('',{spaceAfter:120}),
  body('本提案に関するご質問・ご不明点は提案者（松浦）までお気軽にお申し付けください。',{bold:true,spaceAfter:80}),
  body('以上',{align:'right'}),
];

var docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
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
  fs.writeFileSync('C:/Users/user/Downloads/歯科医院向け発注管理アプリ_PoC提案書_松浦.docx',buf);
  console.log('done');
}).catch(function(e){ console.error(e); });
