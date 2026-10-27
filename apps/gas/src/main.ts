/**
 * Apps Script の入口。build.mjs がここで export した関数を GAS のグローバル関数として公開する。
 */
import { buildIcs, appLink } from '@studio-attendance/shared';
import type { Ctx, Kv } from './app/ports';
import { richMenuDefinition } from './app/richmenu';
import { route } from './app/router';
import { INITIAL_SETTINGS, SHEETS, settingsToRows } from './app/schema';
import { hourlyJob as runHourly } from './app/triggers';
import { makeVerifiers } from './gas/auth';
import { DEFAULT_GEMINI_MODEL, GeminiReader } from './gas/gemini';
import { LineClient } from './gas/lineClient';
import { SheetStore } from './gas/sheetStore';

/** スクリプトプロパティに登録する値（秘密情報はシートに書かない） */
const PROP_KEYS = [
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_LOGIN_CHANNEL_ID',
  'LIFF_ID',
  'PAGES_URL',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'RELAY_SECRET',
  'GAS_URL',
] as const;

function props(): Record<(typeof PROP_KEYS)[number], string> {
  const p = PropertiesService.getScriptProperties().getProperties();
  return Object.fromEntries(PROP_KEYS.map((k) => [k, p[k] ?? ''])) as Record<(typeof PROP_KEYS)[number], string>;
}

function makeCtx(): Ctx {
  const p = props();
  const store = new SheetStore(SpreadsheetApp.getActiveSpreadsheet());
  const cache = CacheService.getScriptCache();
  const kv: Kv = {
    get: (k) => cache.get(k),
    put: (k, v, ttl) => cache.put(k, v, ttl),
    remove: (k) => cache.remove(k),
  };
  let lockDepth = 0;
  return {
    store,
    line: new LineClient(p.LINE_CHANNEL_ACCESS_TOKEN),
    reader: new GeminiReader(p.GEMINI_API_KEY, p.GEMINI_MODEL || DEFAULT_GEMINI_MODEL),
    kv,
    withLock(fn) {
      if (lockDepth > 0) return fn();
      const lock = LockService.getScriptLock();
      lock.waitLock(30000);
      lockDepth++;
      try {
        store.invalidate();
        return fn();
      } finally {
        lockDepth--;
        lock.releaseLock();
      }
    },
    config: {
      appUrl: `https://liff.line.me/${p.LIFF_ID}`,
      joinPageUrl: `${p.PAGES_URL.replace(/\/$/, '')}/join.html`,
      gasUrl: p.GAS_URL || ScriptApp.getService().getUrl(),
    },
    now: () => new Date(),
    uuid: () => Utilities.getUuid(),
    log: (...args) => console.log(args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')),
  };
}

export function doPost(e: GoogleAppsScript.Events.DoPost) {
  const p = props();
  const out = route(makeCtx(), e.postData?.contents ?? '', makeVerifiers({ relaySecret: p.RELAY_SECRET, loginChannelId: p.LINE_LOGIN_CHANNEL_ID }));
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

export function doGet(e: GoogleAppsScript.Events.DoGet) {
  if (e.parameter.action === 'ics' && e.parameter.id) {
    const ctx = makeCtx();
    const p = ctx.store.getPractice(e.parameter.id);
    if (p) {
      return ContentService.createTextOutput(buildIcs(p, appLink(ctx.config.appUrl, { p: p.id }), new Date()))
        .setMimeType(ContentService.MimeType.ICAL)
        .downloadAsFile('practice.ics');
    }
  }
  return ContentService.createTextOutput('ok');
}

export function hourlyJob() {
  runHourly(makeCtx());
}

/** 初回だけ実行：4つのシートと見出し、設定の初期値を作る（既にあるシートは見出しだけ足す） */
export function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  for (const def of Object.values(SHEETS)) {
    let sh = ss.getSheetByName(def.name);
    const created = !sh;
    if (!sh) sh = ss.insertSheet(def.name);
    const current = sh.getLastColumn() > 0 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
    const missing = def.headers.filter((h) => !current.includes(h));
    if (missing.length) sh.getRange(1, current.filter(Boolean).length + 1, 1, missing.length).setValues([missing]);
    // 日付や時刻が自動で日付型に変わらないよう、すべて書式なしテキストにする
    sh.getRange(1, 1, sh.getMaxRows(), Math.max(sh.getLastColumn(), def.headers.length)).setNumberFormat('@');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold');
    if (created && def.name === SHEETS.settings.name) {
      const rows = settingsToRows(INITIAL_SETTINGS);
      sh.getRange(2, 1, rows.length, def.headers.length).setValues(rows.map((r) => def.headers.map((h) => r[h] ?? '')));
    }
  }
  const first = ss.getSheetByName('シート1') ?? ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 1 && first.getLastRow() === 0) ss.deleteSheet(first);
}

/** 初回だけ実行：毎時のトリガー（キャンセル期限前警告・終了処理）を作る */
export function installTriggers() {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'hourlyJob') ScriptApp.deleteTrigger(t);
  }
  ScriptApp.newTrigger('hourlyJob').timeBased().everyHours(1).create();
}

/** 設定の確認用：足りないスクリプトプロパティをログに出す */
export function checkConfig() {
  const p = props();
  const missing = PROP_KEYS.filter((k) => !p[k] && k !== 'GEMINI_MODEL' && k !== 'GAS_URL');
  console.log(missing.length ? `未設定: ${missing.join(', ')}` : 'スクリプトプロパティはそろっています');
  console.log(`ウェブアプリURL: ${ScriptApp.getService().getUrl()}`);
}

/**
 * 初回とメニューを変えたときに実行：Botとの個別トークの下にメニュー（リッチメニュー）を出す。
 * 画像は GitHub Pages の richmenu.png を使う。古いメニューは消してから作り直す。
 */
export function setupRichMenu() {
  const p = props();
  if (!p.LINE_CHANNEL_ACCESS_TOKEN || !p.LIFF_ID || !p.PAGES_URL) {
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN・LIFF_ID・PAGES_URL を設定してから実行してください');
  }
  const auth = { Authorization: `Bearer ${p.LINE_CHANNEL_ACCESS_TOKEN}` };
  const call = (method: 'get' | 'post' | 'delete', url: string, opts: { json?: unknown; blob?: GoogleAppsScript.Base.Blob } = {}) => {
    const res = UrlFetchApp.fetch(url, {
      method,
      headers: auth,
      muteHttpExceptions: true,
      ...(opts.json !== undefined ? { contentType: 'application/json', payload: JSON.stringify(opts.json) } : {}),
      ...(opts.blob ? { contentType: opts.blob.getContentType() ?? 'image/png', payload: opts.blob.getBytes() } : {}),
    });
    if (res.getResponseCode() >= 300) throw new Error(`${method} ${url} ${res.getResponseCode()}: ${res.getContentText()}`);
    const text = res.getContentText();
    return text ? JSON.parse(text) : {};
  };

  const image = UrlFetchApp.fetch(`${p.PAGES_URL.replace(/\/$/, '')}/richmenu.png`).getBlob().setContentType('image/png');
  const old = call('get', 'https://api.line.me/v2/bot/richmenu/list').richmenus as { richMenuId: string }[];
  const { richMenuId } = call('post', 'https://api.line.me/v2/bot/richmenu', { json: richMenuDefinition(`https://liff.line.me/${p.LIFF_ID}`) });
  call('post', `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, { blob: image });
  call('post', `https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`);
  for (const m of old) call('delete', `https://api.line.me/v2/bot/richmenu/${m.richMenuId}`);
  console.log(`リッチメニューを設定しました（${richMenuId}）。古いメニュー${old.length}件を削除しました`);
}
