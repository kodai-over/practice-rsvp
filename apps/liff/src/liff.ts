import liff from '@line/liff';
import { MOCK, configureAuth } from './api';

const LIFF_ID = import.meta.env.VITE_LIFF_ID as string;

/** LIFFを初期化し、未ログインならLINEログインへ。戻り値は起動時のURLパラメータ */
export async function initLiff(): Promise<URLSearchParams> {
  if (!MOCK) {
    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: location.href });
      await new Promise(() => {}); // リダイレクトを待つ
    }
    configureAuth(
      () => liff.getIDToken(),
      () => {
        // 設定ミスで無限にログインし直さないよう、1回だけ試す
        if (sessionStorage.getItem('pb:relogin')) return;
        sessionStorage.setItem('pb:relogin', '1');
        liff.logout();
        liff.login({ redirectUri: location.href });
      },
    );
  }
  return new URLSearchParams(location.search);
}

/** カレンダーなどはLINEの外のブラウザで開く */
export function openExternal(url: string) {
  if (!MOCK && liff.isInClient()) liff.openWindow({ url, external: true });
  else window.open(url, '_blank', 'noopener');
}

export function closeApp() {
  if (!MOCK && liff.isInClient()) liff.closeWindow();
}
