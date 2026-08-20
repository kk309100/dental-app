const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, LevelFormat, VerticalAlign,
} = require("docx")
const fs = require("fs")

const GREEN  = "1a7a3c"
const LGREEN = "e8f5ec"
const GRAY   = "6b7280"
const BLACK  = "111827"

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GREEN, space: 4 } },
    children: [new TextRun({ text, bold: true, size: 32, color: GREEN, font: "游ゴシック" })],
  })
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 80 },
    children: [new TextRun({ text, bold: true, size: 26, color: BLACK, font: "游ゴシック" })],
  })
}

function body(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    children: [new TextRun({ text, size: 22, color: BLACK, font: "游ゴシック", ...opts })],
  })
}

function note(text) {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    indent: { left: 220 },
    children: [
      new TextRun({ text: "★ ", size: 22, color: GREEN, bold: true, font: "游ゴシック" }),
      new TextRun({ text, size: 22, color: GREEN, font: "游ゴシック" }),
    ],
  })
}

function warn(text) {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    indent: { left: 220 },
    children: [
      new TextRun({ text: "注意：", size: 22, bold: true, color: "dc2626", font: "游ゴシック" }),
      new TextRun({ text, size: 22, color: "dc2626", font: "游ゴシック" }),
    ],
  })
}

function step(num, text) {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    indent: { left: 360, hanging: 360 },
    children: [
      new TextRun({ text: `${num}. `, size: 22, bold: true, color: GREEN, font: "游ゴシック" }),
      new TextRun({ text, size: 22, color: BLACK, font: "游ゴシック" }),
    ],
  })
}

function bullet(text) {
  return new Paragraph({
    spacing: { before: 40, after: 40 },
    indent: { left: 360, hanging: 200 },
    children: [
      new TextRun({ text: "・", size: 22, color: GRAY, font: "游ゴシック" }),
      new TextRun({ text, size: 22, color: BLACK, font: "游ゴシック" }),
    ],
  })
}

function space() {
  return new Paragraph({ spacing: { before: 80, after: 0 }, children: [new TextRun("")] })
}

function qaBlock(q, a) {
  return [
    new Paragraph({
      spacing: { before: 120, after: 40 },
      children: [
        new TextRun({ text: "Q.  ", size: 22, bold: true, color: "2563eb", font: "游ゴシック" }),
        new TextRun({ text: q, size: 22, bold: true, color: "2563eb", font: "游ゴシック" }),
      ],
    }),
    new Paragraph({
      spacing: { before: 0, after: 60 },
      indent: { left: 220 },
      children: [
        new TextRun({ text: "A.  ", size: 22, bold: true, color: GRAY, font: "游ゴシック" }),
        new TextRun({ text: a, size: 22, color: BLACK, font: "游ゴシック" }),
      ],
    }),
  ]
}

// タイトルブロック（表紙風）
function titleBlock() {
  return new Table({
    width: { size: 9240, type: WidthType.DXA },
    columnWidths: [9240],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 9240, type: WidthType.DXA },
            shading: { fill: LGREEN, type: ShadingType.CLEAR },
            margins: { top: 280, bottom: 280, left: 400, right: 400 },
            borders: {
              top:    { style: BorderStyle.SINGLE, size: 12, color: GREEN },
              bottom: { style: BorderStyle.SINGLE, size: 12, color: GREEN },
              left:   { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              right:  { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
            },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 80, after: 40 },
                children: [new TextRun({ text: "DentHub　在庫管理　操作マニュアル", bold: true, size: 40, color: GREEN, font: "游ゴシック" })],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 40, after: 80 },
                children: [new TextRun({ text: "医院スタッフ向け　　2026年6月", size: 22, color: GRAY, font: "游ゴシック" })],
              }),
            ],
          }),
        ],
      }),
    ],
  })
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: "游ゴシック", size: 22 } } },
  },
  sections: [{
    properties: {
      page: {
        size:   { width: 11906, height: 16838 },
        margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 },
      },
    },
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GREEN, space: 4 } },
            children: [new TextRun({ text: "DentHub 在庫管理マニュアル", size: 18, color: GRAY, font: "游ゴシック" })],
          }),
        ],
      }),
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: GREEN, space: 4 } },
            children: [
              new TextRun({ children: [PageNumber.CURRENT], size: 18, color: GRAY, font: "游ゴシック" }),
            ],
          }),
        ],
      }),
    },
    children: [
      // ── タイトル ──
      titleBlock(),
      space(),

      // ── 第1章 ──
      h1("第1章　基本操作"),

      h2("1-1　ログイン方法"),
      step(1, "ブラウザで https://dental-app-brown.vercel.app を開く"),
      step(2, "スタッフコードとパスワードを入力してログイン"),
      step(3, "ログイン後、画面下のメニューから「在庫管理」をタップ"),
      note("ブックマーク登録をおすすめします"),
      space(),

      h2("1-2　画面の見方"),
      body("在庫管理画面上部には以下のボタンが並んでいます："),
      bullet("📋 棚卸し　→　棚卸しモードを開く"),
      bullet("📤　→　在庫リストをCSV出力"),
      bullet("📥 CSV　→　商品データを一括インポート"),
      bullet("🏷 ラベル　→　棚ラベルを印刷"),
      bullet("＋ 追加　→　商品を手動追加"),
      space(),

      h2("1-3　商品の検索方法"),
      body("検索バーにキーワードを入力すると、ひらがな・カタカナ・半角カタカナ・漢字・英字、どれでも検索できます。"),
      bullet("例：「もんだみん」「モンダミン」「ﾓﾝﾀﾞﾐﾝ」→ すべて同じ結果がヒット"),
      bullet("短いキーワードで検索するとヒットしやすいです"),
      space(),

      // ── 第2章 ──
      h1("第2章　日常の在庫記録"),

      h2("2-1　商品を使ったとき（消費記録）"),
      step(1, "在庫画面で商品名を検索して探す"),
      step(2, "商品カードをタップ → 「使用」ボタンを押す"),
      step(3, "使用数量を入力して「確定」"),
      step(4, "在庫数が自動で減ります"),
      space(),

      h2("2-2　商品が補充されたとき（入荷記録）"),
      step(1, "在庫画面で商品を探す"),
      step(2, "「補充」ボタンをタップ"),
      step(3, "入荷数量を入力して「確定」"),
      step(4, "在庫数が増えます"),
      space(),

      h2("2-3　バーコードで素早く記録する"),
      step(1, "在庫画面の「📷 スキャンして記録」をタップ"),
      step(2, "カメラが起動するので、商品のバーコードを読み取る"),
      step(3, "該当商品が自動で選択されるので、使用 / 補充を選んで数量を入力"),
      note("バーコードが読めない場合は商品名で検索してください"),
      space(),

      h2("2-4　在庫数を直接修正する"),
      step(1, "商品カードの在庫数をタップ"),
      step(2, "正しい数量を入力して「✓」を押す"),
      note("誤入力の修正など、少量の修正に使用してください"),
      space(),

      // ── 第3章 ──
      h1("第3章　棚卸し作業"),

      h2("3-1　棚卸しモードを開く"),
      step(1, "在庫画面右上の「📋 棚卸し」ボタンをタップ"),
      step(2, "場所別に商品が並んだ棚卸し画面が開きます"),
      space(),

      h2("3-2　実数量を入力する"),
      step(1, "実際に棚を数えて、各商品の「実数量」欄に数字を入力する"),
      step(2, "数字が変わると行の背景が黄色になります（変更マーク）"),
      step(3, "Enterキーで次の商品の入力欄に移動できます"),
      step(4, "バーコードを読み取ると、その商品にジャンプしてフォーカスします"),
      bullet("現在の在庫数（参考）は薄いグレーで表示されています"),
      bullet("変更差分（+2 / -1）が赤/緑で表示されます"),
      space(),

      h2("3-3　棚卸しを確定する"),
      step(1, "入力が終わったら画面下「✅ ○件の変更を確定する」をタップ"),
      step(2, "確認ダイアログが出るので「OK」を押す"),
      step(3, "変更した商品だけ在庫数が更新されます"),
      warn("確定ボタンを押すまで在庫数は変わりません。入力後は必ず確定してください。"),
      space(),

      h2("3-4　報告書の作成（本部提出用）"),
      step(1, "棚卸しモード画面右上の「📄 報告書」をタップ"),
      step(2, "商品ごとに「数量 × 単価 ＝ 金額」が自動計算されます"),
      step(3, "単価が自動で入らない商品は赤字で表示 → 直接入力してください"),
      step(4, "「🖨 印刷」で本部提出用の帳票を印刷"),
      step(5, "「📥 CSV出力」でExcel用データをダウンロード"),
      note("在庫0の商品は既定で除外されます。含める場合は「在庫0の商品も含める」にチェック"),
      space(),

      // ── 第4章 ──
      h1("第4章　よくある質問"),

      ...qaBlock(
        "商品が検索で見つからない",
        "ひらがな・カタカナ・英字どれでも検索できます。短いキーワードで試してください。それでも見つからない場合は「＋ 追加」から新規登録してください。"
      ),
      ...qaBlock(
        "在庫数が実際と合わない",
        "棚卸しモードで実数量を入力して「確定」すると正しい数量に修正できます。"
      ),
      ...qaBlock(
        "バーコードが読み取れない",
        "照明が暗い場合は明るい場所で試してください。読み取れない場合は商品名での検索をご利用ください。"
      ),
      ...qaBlock(
        "印刷がうまくできない",
        "iPadをお使いの場合、「🖨 印刷」ボタンからAirPrintで印刷できます。iPhoneは画面サイズが小さいため、iPadまたはPCでの印刷を推奨します。"
      ),
      ...qaBlock(
        "ログインできない",
        "スタッフコードとパスワードをご確認ください。わからない場合は本部にお問い合わせください。"
      ),
      ...qaBlock(
        "報告書の単価が空欄（赤字）になっている",
        "単価データに登録されていない商品です。その場で金額を直接入力してください。入力すると金額が自動計算されます。"
      ),
      space(),
    ],
  }],
})

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync("C:\\Users\\user\\Desktop\\DentHub_在庫管理マニュアル.docx", buf)
  console.log("OK: DentHub_在庫管理マニュアル.docx を作成しました")
})
