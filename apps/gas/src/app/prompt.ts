/** Gemini に渡す指示文と出力の形。実際のスクショで試しながら調整する */

export function readerPrompt(today: string, studios: string[], text?: string): string {
  const known = studios.length ? studios.join('、') : '（まだありません）';
  const source = text
    ? `次の文章（予約完了メールや予約一覧をコピーしたもの）から、予約内容を抜き出してください。\n----\n${text}\n----`
    : '画像（予約完了画面や予約一覧のスクリーンショット）から、予約内容を抜き出してください。';
  return `あなたはダンススタジオの予約内容を抜き出す係です。
今日の日付は ${today}（日本時間）です。
${source}

写っている（書かれている）予約をすべて reservations に1件ずつ入れてください。
- 予約一覧の表のように複数の予約が並んでいれば、行ごとに別の件にする。日付が今日より前の予約も含めてよい（後で除外する）
- 1つの予約に複数の日や部屋が含まれていれば、日ごと・部屋ごとに分ける
- 複数の画像に同じ予約が写っていれば1件にまとめる
- キャンセル済み・取消と書かれた予約は入れない
- date: 利用日を YYYY-MM-DD で。年が書かれていなければ、今日以降で最も近い日付になる年を補う
- start, end: 利用開始・終了時刻を 24時間表記の HH:mm で（深夜は 24:00, 25:00 のように表してよい）
- studio: スタジオ名。BUZZ は「BUZZ」＋店舗名（例: BUZZ横浜東口）。studio worcle は「worcle」＋店舗名（例: worcle横浜）
  - これまでに登録されたスタジオ名: ${known}
  - 「横浜 301」のように店舗名と部屋番号しか書かれていないときは、上の一覧から店舗名が一致するものを studio にし、部屋番号を room にする。一致するものがなければ、書かれている店舗名をそのまま studio にする
- room: 部屋・スタジオ番号（例: A, 301）。なければ空文字
- fee: その予約の金額（税込、円、数字のみ）。分からなければ null
- 支払い状況、電話番号、氏名、メールアドレスなど、予約内容と関係のない情報は出力しない
- 読み取れない項目は null にする。推測で埋めない
- 予約の内容でなければ reservations は空にする`;
}

export const READER_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reservations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD' },
          start: { type: 'STRING', nullable: true, description: 'HH:mm' },
          end: { type: 'STRING', nullable: true, description: 'HH:mm' },
          studio: { type: 'STRING', nullable: true },
          room: { type: 'STRING', nullable: true },
          fee: { type: 'INTEGER', nullable: true },
        },
        required: ['date', 'start', 'end', 'studio', 'room', 'fee'],
      },
    },
  },
  required: ['reservations'],
};

/** Gemini の応答本文から予約の配列を取り出す */
export function parseReaderResponse(json: unknown): Record<string, unknown>[] {
  const text = (json as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? '')
    .join('');
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as { reservations?: unknown };
    return Array.isArray(parsed.reservations) ? (parsed.reservations.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}
