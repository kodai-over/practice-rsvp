/** Botとの個別トークの下に出すメニュー（リッチメニュー）。画像は scripts/richmenu.mjs で作る 2500×843・ボタン1つ */
export const RICH_MENU_SIZE = { width: 2500, height: 843 };

/** 全面が1つのボタンで、アプリのトップ（練習の一覧）を開く */
export function richMenuDefinition(appUrl: string) {
  return {
    size: RICH_MENU_SIZE,
    selected: true,
    name: 'スタジオ練出欠管理 メニュー',
    chatBarText: 'アプリを開く',
    areas: [{ bounds: { x: 0, y: 0, ...RICH_MENU_SIZE }, action: { type: 'uri', label: 'アプリを開く', uri: appUrl } }],
  };
}
