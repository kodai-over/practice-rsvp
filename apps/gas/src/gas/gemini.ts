import type { ReaderHints, ReaderInput, ScreenshotReader } from '../app/ports';
import { READER_SCHEMA, parseReaderResponse, readerPrompt } from '../app/prompt';

/** 常に最新の Flash モデルを指す別名。個別のモデルは提供終了で使えなくなるため、既定はこれにする */
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

export class GeminiReader implements ScreenshotReader {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  read(input: ReaderInput, hints: ReaderHints) {
    if (!this.apiKey) throw new Error('GEMINI_API_KEY が設定されていません');
    let res = this.call(this.model, input, hints);
    // 指定したモデルが提供終了などで見つからなければ、最新の Flash でやり直す
    if (res.getResponseCode() === 404 && this.model !== DEFAULT_GEMINI_MODEL) {
      console.log(`Gemini model ${this.model} not found, retrying with ${DEFAULT_GEMINI_MODEL}`);
      res = this.call(DEFAULT_GEMINI_MODEL, input, hints);
    }
    if (res.getResponseCode() !== 200) {
      throw new Error(`Gemini ${res.getResponseCode()}: ${geminiErrorMessage(res.getContentText())}`);
    }
    return parseReaderResponse(JSON.parse(res.getContentText()));
  }

  private call(model: string, input: ReaderInput, hints: ReaderHints) {
    return UrlFetchApp.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
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
  }
}

function geminiErrorMessage(body: string): string {
  try {
    return (JSON.parse(body) as { error?: { message?: string } }).error?.message?.slice(0, 200) ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}
