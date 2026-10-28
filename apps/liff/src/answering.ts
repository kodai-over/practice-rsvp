import type { Answer } from '@studio-attendance/shared';

/** 送りたい回答（練習ごとに最後に押したもの）。画面をまたいでも同じものを使う */
export const wanted = new Map<string, Answer>();
/** 練習ごとに、回答を送っている途中の処理 */
export const sending = new Map<string, Promise<void>>();

/** 回答を送っている途中か、送るのを待っているか。この間に届いた古い内容で、押した回答を戻さないために使う */
export const isAnswering = (id: string) => wanted.has(id) || sending.has(id);

/** 送っている途中の回答がすべて終わるのを待つ（グループに伝える前に、結果をそろえる） */
export async function answersSettled(): Promise<void> {
  while (sending.size > 0) await Promise.all([...sending.values()]);
}
