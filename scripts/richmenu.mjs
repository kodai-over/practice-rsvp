// LINEのリッチメニュー画像（2500×843、4つのボタン）を作る。
// 出力先の apps/liff/public/richmenu.png は GitHub Pages で配信され、Apps Script の setupRichMenu が読み込む。
// アプリ下のナビと同じ線のアイコンを、黒地に白で大きく置く（文字は短い一語だけ）。
// 実行: node scripts/richmenu.mjs（macOS ならヒラギノ角ゴシック、なければ IPA/Noto のゴシックを使う）
import { Resvg } from '@resvg/resvg-js';
import { existsSync, writeFileSync } from 'node:fs';

const W = 2500;
const H = 843;
const CELL = W / 4;
const BG = '#000000';
const INK = '#FFFFFF';
const SUB = '#8C8C8A';
const RULE = '#2A2A28';

// apps/liff/src/ui.tsx のアイコンと同じ線（24×24 の座標）
const ICONS = {
  plus: 'M12 5v14M5 12h14',
  send: 'M4 12 20 4l-6 16-3-7zM11 13l9-9',
  ticket: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5V14a2 2 0 0 0 0-4zM15 6v2M15 11v2M15 16v2',
  chat: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4 3.5V17h0a2 2 0 0 1-2-2z',
};

// apps/gas/src/app/richmenu.ts の RICH_MENU_VIEWS と同じ順
const items = [
  { icon: 'plus', label: '登録' },
  { icon: 'send', label: '募集' },
  { icon: 'ticket', label: '予定' },
  { icon: 'chat', label: '要望' },
];

const font = (() => {
  const hira = ['W3', 'W6'].map((w) => `/System/Library/Fonts/ヒラギノ角ゴシック ${w}.ttc`);
  if (hira.every(existsSync)) return { files: hira, family: 'Hiragino Sans' };
  const noto = ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'];
  if (noto.every(existsSync)) return { files: noto, family: 'Noto Sans CJK JP' };
  return { files: ['/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'], family: 'IPAGothic' };
})();

const SCALE = 13; // 24 → 312px
const cells = items
  .map((it, i) => {
    const x = i * CELL;
    const cx = x + CELL / 2;
    const rule = i > 0 ? `<rect x="${x - 1}" y="190" width="2" height="${H - 380}" fill="${RULE}"/>` : '';
    return `${rule}
    <g transform="translate(${cx - 12 * SCALE} 150) scale(${SCALE})" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="${ICONS[it.icon]}"/>
    </g>
    <text x="${cx}" y="640" text-anchor="middle" font-family="${font.family}" font-size="64" letter-spacing="12" fill="${SUB}">${it.label}</text>`;
  })
  .join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>${cells}
</svg>`;

const png = new Resvg(svg, { font: { fontFiles: font.files, loadSystemFonts: false, defaultFontFamily: font.family } }).render().asPng();
const out = new URL('../apps/liff/public/richmenu.png', import.meta.url);
writeFileSync(out, png);
console.log(`wrote ${out.pathname} (${Math.round(png.length / 1024)} KB, ${font.family})`);
