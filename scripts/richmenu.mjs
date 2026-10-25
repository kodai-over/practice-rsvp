// LINEのリッチメニュー画像（2500×843、4つのボタン）を作る。
// 出力先の apps/liff/public/richmenu.png は GitHub Pages で配信され、Apps Script の setupRichMenu が読み込む。
// 実行: node scripts/richmenu.mjs（macOS のヒラギノ角ゴシックを使う）
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';

const W = 2500;
const H = 843;
const GREEN = '#06C755';
const INK = '#1F2937';
const SUB = '#6B7280';
const CELL = W / 4;

const icon = {
  // スクショ（カメラ）で登録
  register: (cx) => `
    <rect x="${cx - 150}" y="200" width="250" height="185" rx="36"/>
    <path d="M${cx - 80} 200 L${cx - 60} 160 H${cx + 10} L${cx + 30} 200"/>
    <circle cx="${cx - 25}" cy="292" r="52"/>
    <path d="M${cx + 150} 110 V190 M${cx + 110} 150 H${cx + 190}" stroke-width="26"/>`,
  // メガホンで募集
  recruit: (cx) => `
    <path d="M${cx - 130} 245 V325 H${cx - 70} L${cx + 80} 395 V175 L${cx - 70} 245 Z"/>
    <path d="M${cx - 95} 325 L${cx - 70} 400"/>
    <path d="M${cx + 125} 235 Q${cx + 160} 285 ${cx + 125} 335"/>`,
  // カレンダーとチェックで予定
  schedule: (cx) => `
    <rect x="${cx - 125}" y="160" width="250" height="230" rx="32"/>
    <path d="M${cx - 125} 225 H${cx + 125} M${cx - 60} 130 V185 M${cx + 60} 130 V185"/>
    <path d="M${cx - 55} 310 L${cx - 15} 350 L${cx + 60} 270"/>`,
  // ふきだしで要望
  feedback: (cx) => `
    <path d="M${cx - 130} 175 H${cx + 130} Q${cx + 160} 175 ${cx + 160} 205 V325 Q${cx + 160} 355 ${cx + 130} 355 H${cx - 20} L${cx - 85} 410 V355 H${cx - 130} Q${cx - 160} 355 ${cx - 160} 325 V205 Q${cx - 160} 175 ${cx - 130} 175 Z"/>
    <path d="M${cx - 80} 245 H${cx + 80} M${cx - 80} 290 H${cx + 30}"/>`,
};

const items = [
  { key: 'register', label: '練習を登録', sub: 'スクショ・手入力' },
  { key: 'recruit', label: '募集する', sub: 'グループに送る' },
  { key: 'schedule', label: '予定を見る', sub: '自分が行く練習' },
  { key: 'feedback', label: '要望', sub: '改善のアイデア' },
];

const cells = items
  .map((it, i) => {
    const x = i * CELL;
    const cx = x + CELL / 2;
    return `
    <rect x="${x + 14}" y="14" width="${CELL - 28}" height="${H - 28}" rx="44" fill="#F1FAF4"/>
    <g fill="none" stroke="${GREEN}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round">${icon[it.key](cx)}</g>
    <text x="${cx}" y="610" text-anchor="middle" font-family="Hiragino Sans" font-weight="700" font-size="96" fill="${INK}">${it.label}</text>
    <text x="${cx}" y="715" text-anchor="middle" font-family="Hiragino Sans" font-weight="400" font-size="54" fill="${SUB}">${it.sub}</text>`;
  })
  .join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#FFFFFF"/>${cells}
</svg>`;

const fonts = ['W3', 'W6', 'W7'].map((w) => `/System/Library/Fonts/ヒラギノ角ゴシック ${w}.ttc`);
const png = new Resvg(svg, { font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'Hiragino Sans' } }).render().asPng();
const out = new URL('../apps/liff/public/richmenu.png', import.meta.url);
writeFileSync(out, png);
console.log(`wrote ${out.pathname} (${Math.round(png.length / 1024)} KB)`);
