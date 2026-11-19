// 見積書・開設見積書の印刷レイアウト（共通のスタイル）。.oq の中だけで使う。
// 管理画面の共通スタイル（表・見出し）と衝突しないよう、表は table ではなく grid（.gt）で組む。
export const PRINT_CSS = `

        .oq.oq { font-family: "MS Mincho","ＭＳ 明朝","MS PMincho","Yu Mincho","Hiragino Mincho ProN","Noto Serif JP",serif; color:#000; background:#e5e7eb; }
        .oq.oq .bar { position:sticky; top:0; background:#111827; color:#fff; padding:8px 16px; display:flex; gap:12px; align-items:center; z-index:10; font-family:sans-serif; font-size:13px; }
        .oq.oq .bar button { background:#2563eb; color:#fff; border:none; padding:6px 18px; border-radius:6px; font-size:13px; cursor:pointer; }
        .oq.oq .page { width:210mm; height:297mm; margin:12px auto; background:#fff; padding:13mm 14mm 11mm; box-sizing:border-box; box-shadow:0 1px 6px rgba(0,0,0,.25); overflow:hidden; position:relative; }
        .oq.oq h1 { font-family:inherit !important; font-size:24px !important; font-weight:700 !important; letter-spacing:.45em !important; color:#000 !important; text-align:center; margin:0 !important; padding:0 0 0 .45em; line-height:1.3 !important; }
        .oq.oq .head { position:relative; border-bottom:2.5px double #111; padding-bottom:7px; margin-bottom:10px; }
        .oq.oq .meta { position:absolute; right:0; top:2px; font-size:10.5px; line-height:1.55; text-align:right; }
        .oq.oq .to { font-size:18px; font-weight:700; border-bottom:1px solid #111; display:inline-block; min-width:60%; padding:0 6px 3px 0; margin:6px 0 10px; }
        .oq.oq .subject { font-size:14px; font-weight:700; margin:0 0 8px; }
        .oq.oq .gt { display:grid; border-top:1px solid #111; border-left:1px solid #111; width:100%; box-sizing:border-box; }
        .oq.oq .gt > div { border-right:1px solid #111; border-bottom:1px solid #111; padding:2px 6px; font-size:11px; line-height:1.35; color:#000; min-width:0; box-sizing:border-box; }
        .oq.oq .gt > .h { background:#eef0f3; font-weight:700; font-size:10.5px; text-align:center; letter-spacing:.05em; display:flex; align-items:center; justify-content:center; padding:3px 5px; }
        .oq.oq .gt > .c { display:flex; align-items:center; justify-content:center; }
        .oq.oq .gt > .r { display:flex; align-items:center; justify-content:flex-end; font-variant-numeric:tabular-nums; }
        .oq.oq .gt > .l { display:flex; align-items:center; }
        .oq.oq .gt > .mono { display:flex; align-items:center; font-family:"Consolas","Courier New",monospace; font-size:10px; }
        .oq.oq .terms { width:44%; flex:none; grid-auto-rows:6.2mm; }
        .oq.oq .sumlist { grid-auto-rows:minmax(7.6mm,auto); }
        .oq.oq .detail { grid-auto-rows:minmax(11.2mm,auto); }
        .oq.oq .detail > .nmcell { display:flex; flex-direction:column; justify-content:center; }
        .oq.oq .detail > .pricecell { display:flex; flex-direction:column; justify-content:center; align-items:flex-end; font-variant-numeric:tabular-nums; }
        .oq.oq .company { position:relative; font-size:10.5px; line-height:1.65; padding-right:62px; }
        .oq.oq .company .nm { font-size:14px; font-weight:700; margin-bottom:2px; }
        .oq.oq .company .seal { position:absolute; top:-2px; right:0; }
        .oq.oq .grand-box { margin:14px 0 12px; text-align:center; border-top:1.5px solid #111; border-bottom:1.5px solid #111; padding:9px 0; }
        .oq.oq .grand-box .lb { font-size:13px; letter-spacing:.2em; margin-right:18px; }
        .oq.oq .grand-box .am { font-size:25px; font-weight:700; letter-spacing:.04em; }
        .oq.oq .grand-box .tx { font-size:10px; margin-left:8px; }
        .oq.oq .gt > .remark-h { text-align:center; display:block; background:#eef0f3; font-size:10.5px; line-height:1.4; }
        .oq.oq .gt > .remark { white-space:pre-wrap; min-height:23mm; font-size:10.5px; }
        .oq.oq .gt > .sums { padding:0; }
        .oq.oq .sums div { display:flex; justify-content:space-between; padding:2.5px 8px; border-bottom:1px solid #111; font-size:11px; }
        .oq.oq .sums div:last-child { border-bottom:none; }
        .oq.oq .sums .grand { background:#eef0f3; font-size:12.5px; font-weight:700; }
        .oq.oq .sec-title { text-align:center; font-size:15px; font-weight:700; margin:2px 0 4px; }
        .oq.oq .sec-total { text-align:center; margin:2px 0 11px; font-size:16px; font-weight:700; border-top:1px solid #111; border-bottom:1px solid #111; padding:6px 0; }
        .oq.oq table.detail tbody tr { height:11.2mm; }
        .oq.oq table.detail td.code { padding:0 !important; }
        .oq.oq .nm2 { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
        .oq.oq .pcode { display:flex; justify-content:space-between; font-size:9.5px; color:#000; gap:6px; }
        .oq.oq .lp { font-size:9.5px; color:#000; }
        .oq.oq .pgno { position:absolute; bottom:6mm; left:0; right:0; text-align:center; font-size:9.5px; color:#000; }
        @media print {
          .oq.oq { background:#fff; }
          .oq.oq .bar { display:none !important; }
          .no-print, .fab, .fab-fb, .mobile-bottom-nav, .admin-layout-header { display:none !important; }
          .oq.oq .page { margin:0; box-shadow:none; break-after:page; page-break-after:always; }
          .oq.oq .page:last-of-type { break-after:auto; page-break-after:auto; }
          @page { size:A4; margin:0; }
        }
              .oq.oq .gt > .sec { grid-column:1 / -1; background:#e9edf3; font-weight:700; font-size:12px; display:flex; align-items:center; border-top:1.5px solid #111; }
        .oq.oq .gt > .subl { background:#f6f7f9; font-weight:700; font-size:11.5px; display:flex; align-items:center; justify-content:flex-end; }
        .oq.oq .gt > .subr { background:#f6f7f9; font-weight:700; font-size:11.5px; display:flex; align-items:center; justify-content:flex-end; font-variant-numeric:tabular-nums; }
        .oq.oq .gt > .gapc { grid-column:1 / -1; height:3mm; padding:0; border-bottom:none; border-right:none; border-left:none; background:transparent; }
        .oq.oq .gt.quote { grid-auto-rows:auto; }
        .oq.oq .gt.quote > .c, .oq.oq .gt.quote > .nmcell, .oq.oq .gt.quote > .pricecell, .oq.oq .gt.quote > .r, .oq.oq .gt.quote > .nt { min-height:11.2mm; }
        .oq.oq .gt.quote.unit > .c, .oq.oq .gt.quote.unit > .nmcell, .oq.oq .gt.quote.unit > .r { min-height:9mm; }
        .oq.oq .gt.quote > .sec, .oq.oq .gt.quote > .subl, .oq.oq .gt.quote > .subr { min-height:7.5mm; }
        .oq.oq .gt.quote > .gapc { min-height:0; }
        .oq.oq .gt > .notecell { grid-column:1 / -1; white-space:pre-wrap; min-height:20mm; font-size:10.5px; }
        .oq.oq .lead { font-size:11px; margin:12px 0 6px; }
        .oq.oq .head { min-height:13mm; box-sizing:border-box; }
        .oq.oq .gt > .nt { font-size:11px; line-height:1.3; }
        .oq.oq .gt > .nt .ntt { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; white-space:pre-wrap; }
`
