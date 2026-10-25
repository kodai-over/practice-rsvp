import type { Image, ScreenshotReader } from '../app/ports';
import { READER_SCHEMA, parseReaderResponse, readerPrompt } from '../app/prompt';

export class GeminiReader implements ScreenshotReader {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  read(images: Image[], today: string) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': this.apiKey },
      payload: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: readerPrompt(today) }, ...images.map((i) => ({ inline_data: { mime_type: i.mimeType, data: i.data } }))],
          },
        ],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: READER_SCHEMA },
      }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      throw new Error(`Gemini ${res.getResponseCode()}: ${res.getContentText().slice(0, 500)}`);
    }
    return parseReaderResponse(JSON.parse(res.getContentText()));
  }
}
