import type { ReaderHints, ReaderInput, ScreenshotReader } from '../app/ports';
import { READER_SCHEMA, parseReaderResponse, readerPrompt } from '../app/prompt';

/** 常に最新の Flash モデルを指す別名。個別のモデルは提供終了で使えなくなるため、既定はこれにする */
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';
/** 混雑などで使えないときの代わり（軽量版の最新） */
export const FALLBACK_GEMINI_MODEL = 'gemini-flash-lite-latest';

export interface GeminiResponse {
  code: number;
  body: string;
}

/** 混雑・回数制限・一時的なサーバーエラー。少し待てば通る見込みがある */
const isTransient = (code: number) => code === 429 || code === 500 || code === 503 || code === 504;

/**
 * モデルを順に試す。一時的なエラーは同じモデルで少し待って再試行し、
 * それでもだめなとき・モデルが見つからない（404）ときは次のモデルへ。
 */
export function callWithFallback(
  models: string[],
  call: (model: string) => GeminiResponse,
  sleep: (ms: number) => void,
  log: (msg: string) => void = () => {},
): GeminiResponse {
  const RETRY_WAITS = [2000, 5000];
  let last: GeminiResponse = { code: 0, body: '' };
  for (const model of [...new Set(models.filter(Boolean))]) {
    for (let attempt = 0; ; attempt++) {
      last = call(model);
      if (last.code === 200) return last;
      if (!isTransient(last.code) || attempt >= RETRY_WAITS.length) break;
      log(`Gemini ${model} ${last.code}, retrying in ${RETRY_WAITS[attempt]}ms`);
      sleep(RETRY_WAITS[attempt]);
    }
    if (last.code !== 404 && !isTransient(last.code)) return last; // キー不正などはモデルを変えても同じ
    log(`Gemini ${model} ${last.code}, trying next model`);
  }
  return last;
}

export class GeminiReader implements ScreenshotReader {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  read(input: ReaderInput, hints: ReaderHints) {
    if (!this.apiKey) throw new Error('GEMINI_API_KEY が設定されていません');
    const res = callWithFallback(
      [this.model, DEFAULT_GEMINI_MODEL, FALLBACK_GEMINI_MODEL],
      (model) => this.call(model, input, hints),
      (ms) => Utilities.sleep(ms),
      (msg) => console.log(msg),
    );
    if (res.code !== 200) {
      throw new Error(
        isTransient(res.code)
          ? `Geminiが混み合っています（${res.code}）。少し時間をおいてもう一度お試しください`
          : `Gemini ${res.code}: ${geminiErrorMessage(res.body)}`,
      );
    }
    return parseReaderResponse(JSON.parse(res.body));
  }

  private call(model: string, input: ReaderInput, hints: ReaderHints): GeminiResponse {
    const res = UrlFetchApp.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': this.apiKey },
      payload: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: readerPrompt(hints.today, hints.studios, input.text) },
              ...input.images.map((i) => ({ inline_data: { mime_type: i.mimeType, data: i.data } })),
            ],
          },
        ],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: READER_SCHEMA },
      }),
      muteHttpExceptions: true,
    });
    return { code: res.getResponseCode(), body: res.getContentText() };
  }
}

function geminiErrorMessage(body: string): string {
  try {
    return (JSON.parse(body) as { error?: { message?: string } }).error?.message?.slice(0, 200) ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}
