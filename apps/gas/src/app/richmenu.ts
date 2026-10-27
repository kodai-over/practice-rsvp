/** Botとの個別トークの下に出すメニュー（リッチメニュー）。画像は scripts/richmenu.mjs で作る 2500×843・4分割 */
import { appLink } from '@studio-attendance/shared';

export const RICH_MENU_SIZE = { width: 2500, height: 843 };

/** 各ボタンで開くアプリの画面（LIFF の ?view=） */
export const RICH_MENU_VIEWS = [
  { view: 'register', label: '登録' },
  { view: 'recruit', label: '募集' },
  { view: 'mine', label: '予定' },
  { view: 'feedback', label: '要望' },
] as const;

export function richMenuDefinition(appUrl: string) {
  const w = RICH_MENU_SIZE.width / RICH_MENU_VIEWS.length;
  return {
    size: RICH_MENU_SIZE,
    selected: true,
    name: 'スタジオ練出欠管理 メニュー',
    chatBarText: 'メニュー',
    areas: RICH_MENU_VIEWS.map((v, i) => ({
      bounds: { x: Math.round(i * w), y: 0, width: Math.round(w), height: RICH_MENU_SIZE.height },
      action: { type: 'uri', label: v.label, uri: appLink(appUrl, { view: v.view }) },
    })),
  };
}
