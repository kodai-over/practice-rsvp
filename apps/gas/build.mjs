// src/main.ts を1ファイルにまとめ、GASから呼べるグローバル関数を末尾に足して dist/ に出力する
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const GLOBALS = ['doPost', 'doGet', 'hourlyJob', 'setupSheets', 'installTriggers', 'checkConfig', 'setupRichMenu', 'backfillGroupMembers'];

mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'App',
  target: 'es2019',
  outfile: 'dist/Code.js',
  charset: 'utf8',
  legalComments: 'none',
});
const footer = GLOBALS.map((n) => `function ${n}(e) { return App.${n}(e); }`).join('\n');
writeFileSync('dist/Code.js', readFileSync('dist/Code.js', 'utf8') + '\n' + footer + '\n');
copyFileSync('appsscript.json', 'dist/appsscript.json');
console.log('built dist/Code.js');
