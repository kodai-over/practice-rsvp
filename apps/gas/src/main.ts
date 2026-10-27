/**
 * Apps Script の入口。build.mjs がここで export した関数を GAS のグローバル関数として公開する。
 */
import { buildIcs, appLink } from '@studio-attendance/shared';
import type { Ctx, Kv } from './app/ports';
import { richMenuDefinition } from './app/richmenu';
import { route } from './app/router';
import { INITIAL_SETTINGS, SHEETS, settingsToRows, toCell } from './app/schema';
import { backfillGroupMembers as runBackfill } from './app/practices';
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

/**
 * シートを書き換えるたびに変える目印。表の写し（CacheService）はこの目印ごとに置き、
 * 書き換えがあれば次の実行は新しい写しを作る。写しを使うのは表示のための読み取りだけで、
 * ロックの中（書き込みの前）は必ずシートを直接読む
 */
const STORE_VERSION_KEY = 'store:ver';
/** 写しを使う時間の上限。手でシートを直したときも、これより長く古い表示は出ない */
const SNAPSHOT_TTL = 300;
/** CacheService に1件で置ける大きさ（100KB）より少し小さく */
const SNAPSHOT_MAX_BYTES = 95_000;

function makeCtx(p = props()): Ctx {
  const cache = CacheService.getScriptCache();
  // シートを読む前に目印を控える。ほかの実行が書き換えれば目印が変わる
  let seen = cache.get(STORE_VERSION_KEY);
  if (!seen) {
    // 手で直した後などで目印が無ければ作る。このあとシートを読むので、写しは今のシートと合う
    seen = Utilities.getUuid();
    cache.put(STORE_VERSION_KEY, seen, 21600);
  }
  let lockDepth = 0;
  const store = new SheetStore(SpreadsheetApp.getActiveSpreadsheet(), {
    get(name) {
      if (lockDepth > 0 || !seen) return null;
      return cache.get(`snap:${name}:${seen}`);
    },
    put(name, json) {
      if (!seen) return;
      try {
        if (Utilities.newBlob(json).getBytes().length <= SNAPSHOT_MAX_BYTES) cache.put(`snap:${name}:${seen}`, json, SNAPSHOT_TTL);
      } catch {
        /* 置けなくてもシートから読めばよい */
      }
    },
  });
  const kv: Kv = {
    get: (k) => cache.get(k),
    put: (k, v, ttl) => cache.put(k, v, ttl),
    remove: (k) => cache.remove(k),
  };
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
        // ほかの実行の書き込みを取りこぼさないよう、ロックの中ではシートを読み直す（写しは使わない）
        seen = cache.get(STORE_VERSION_KEY);
        store.invalidate();
        return fn();
      } catch (e) {
        // 書きかけかもしれないので、手元の控えは捨てる
        store.invalidate();
        throw e;
      } finally {
        try {
          // 書き込みをシートに届けてから目印を変える（届く前に変えると、新しい目印で古い写しが作られる）
          SpreadsheetApp.flush();
          seen = Utilities.getUuid();
          cache.put(STORE_VERSION_KEY, seen, 21600);
        } catch {
          // 目印を変えられなければ消す。消せなくても、この実行では写しを使わない
          seen = null;
          try {
            cache.remove(STORE_VERSION_KEY);
          } catch {
            /* 写しは SNAPSHOT_TTL で消える */
          }
        } finally {
          lockDepth--;
          lock.releaseLock();
        }
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
  const out = route(makeCtx(p), e.postData?.contents ?? '', makeVerifiers({ relaySecret: p.RELAY_SECRET, loginChannelId: p.LINE_LOGIN_CHANNEL_ID }));
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

export function doGet(e: GoogleAppsScript.Events.DoGet) {
  if (e.parameter.action === 'ics' && e.parameter.id) {
    const ctx = makeCtx();
    const p = ctx.store.getPractice(e.parameter.id);
    // 練習IDは推測できるので、合言葉が合うときだけ返す
    if (p && p.joinKey && e.parameter.k === p.joinKey) {
      return ContentService.createTextOutput(buildIcs(p, appLink(ctx.config.appUrl, { p: p.id }), new Date()))
        .setMimeType(ContentService.MimeType.ICAL)
        .downloadAsFile('practice.ics');
    }
  }
  return ContentService.createTextOutput('ok');
}

/** スプレッドシートを手で直したとき（単純トリガー）：表の写しを使わないようにする */
export function onEdit() {
  try {
    CacheService.getScriptCache().remove(STORE_VERSION_KEY);
  } catch {
    /* 使えなくても、写しは SNAPSHOT_TTL で消える */
  }
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
      sh.getRange(2, 1, rows.length, def.headers.length).setValues(rows.map((r) => def.headers.map((h) => toCell(r[h] ?? ''))));
    }
  }
  const first = ss.getSheetByName('シート1') ?? ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 1 && first.getLastRow() === 0) ss.deleteSheet(first);
}

/** 練習が見える範囲を入れたときに実行（何度実行してもよい）：今いるメンバーの所属グループを、これまでの出欠から埋める */
export function backfillGroupMembers() {
  console.log(`所属グループが増えた人数: ${runBackfill(makeCtx())}`);
}

/**
 * 行の挿入・削除・並べ替えなど、onEdit では拾えない手での変更（インストール型の onChange トリガー）：
 * 表の写しを使わないようにする
 */
export function onSheetChange() {
  onEdit();
}

/** 初回とトリガーを足したときに実行：毎時のトリガー（キャンセル期限前警告・終了処理）と、シートの変更を拾うトリガーを作る */
export function installTriggers() {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'hourlyJob' || t.getHandlerFunction() === 'onSheetChange') ScriptApp.deleteTrigger(t);
  }
  ScriptApp.newTrigger('hourlyJob').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('onSheetChange').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onChange().create();
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
