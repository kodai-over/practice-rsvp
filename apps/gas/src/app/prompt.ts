/** Gemini に渡す指示文と出力の形。実際のスクショで試しながら調整する */

export function readerPrompt(today: string): string {
  return `あなたはダンススタジオの予約完了画面のスクリーンショットから、予約内容を抜き出す係です。
今日の日付は ${today}（日本時間）です。

画像に写っている予約をすべて reservations に1件ずつ入れてください。
- 1枚に複数の日の予約が写っていれば、日ごと・部屋ごとに分けて別の件にする
- 複数枚の画像に同じ予約が写っていれば1件にまとめる
- date: 利用日を YYYY-MM-DD で。年が書かれていなければ、今日以降で最も近い日付になる年を補う
- start, end: 利用開始・終了時刻を 24時間表記の HH:mm で（深夜は 24:00, 25:00 のように表してよい）
- studio: スタジオ名。BUZZ は「BUZZ」＋店舗名（例: BUZZ横浜東口）。studio worcle は「worcle」＋店舗名（例: worcle横浜）。それ以外は画面の表記のまま
- room: 部屋・スタジオ番号（例: A, Studio3）。なければ空文字
- fee: その予約の合計金額（税込、円、数字のみ）。分からなければ null
- 予約内容と関係のない文字（電話番号、氏名、メールアドレスなど）は出力しない
- 読み取れない項目は null にする。推測で埋めない
- 予約の画面でなければ reservations は空にする`;
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
