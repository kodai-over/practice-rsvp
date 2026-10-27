// LINEのリッチメニュー画像（2500×843、全面で1つのボタン）を作る。
// 出力先の apps/liff/public/richmenu.png は GitHub Pages で配信され、Apps Script の setupRichMenu が読み込む。
// アプリ下のナビと同じ線のアイコンと「アプリを開く」を、黒地に白で中央に横並びで置く。
// 実行: node scripts/richmenu.mjs（macOS ならヒラギノ角ゴシック、なければ IPA/Noto のゴシックを使う）
import { Resvg } from '@resvg/resvg-js';
import { existsSync, writeFileSync } from 'node:fs';

const W = 2500;
const H = 843;
const BG = '#000000';
const INK = '#FFFFFF';

// apps/liff/src/ui.tsx のアイコン（ticket）と同じ線（24×24 の座標）
const ICON = 'M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5V14a2 2 0 0 0 0-4zM15 6v2M15 11v2M15 16v2';
const LABEL = 'アプリを開く';

const font = (() => {
  const hira = ['W3', 'W6'].map((w) => `/System/Library/Fonts/ヒラギノ角ゴシック ${w}.ttc`);
  if (hira.every(existsSync)) return { files: hira, family: 'Hiragino Sans' };
  const noto = ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'];
  if (noto.every(existsSync)) return { files: noto, family: 'Noto Sans CJK JP' };
  return { files: ['/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'], family: 'IPAGothic' };
})();

const SCALE = 12; // 24 → 288px
const FONT_SIZE = 150;
const GAP = 90;
// 文字幅は全角1文字＝フォントサイズとして、アイコンと文字のまとまりを中央に置く
const textW = LABEL.length * FONT_SIZE;
const left = (W - (24 * SCALE + GAP + textW)) / 2;
const cells = `
    <g transform="translate(${left} ${H / 2 - 12 * SCALE}) scale(${SCALE})" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="${ICON}"/>
    </g>
    <text x="${left + 24 * SCALE + GAP}" y="${H / 2}" dominant-baseline="central" font-family="${font.family}" font-weight="bold" font-size="${FONT_SIZE}" fill="${INK}">${LABEL}</text>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>${cells}
</svg>`;

const png = new Resvg(svg, { font: { fontFiles: font.files, loadSystemFonts: false, defaultFontFamily: font.family } }).render().asPng();
const out = new URL('../apps/liff/public/richmenu.png', import.meta.url);
writeFileSync(out, png);
console.log(`wrote ${out.pathname} (${Math.round(png.length / 1024)} KB, ${font.family})`);
