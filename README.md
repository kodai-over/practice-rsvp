# スタジオ練出欠管理

Studio Practice Attendance Manager（ダンス練習 自動募集システム）

予約者がスタジオの予約画面のスクショをLINE Botに送り、「登録のみ」か「登録して募集」を押すだけで、
練習の登録・出欠・割り勘までをLINE上で進める仕組みです。グループへの募集は必要なときだけ流せます。Google（スプレッドシート・Apps Script・Gemini API）、
LINE、Cloudflare Workers、GitHub Pages の無料枠で動きます。

```
予約者 ──スクショ──▶ LINE ──Webhook──▶ Cloudflare Workers ──（署名を確かめて中継）──▶ Apps Script ──▶ スプレッドシート
                                                                                 │  ├─ Gemini API（スクショ読み取り）
メンバー ◀──募集・出欠ボタン── LINE ◀──────────────── Messaging API ◀──────────────┘  └─ 毎時トリガー（警告・終了）
メンバー ──LINE内アプリ（GitHub Pages）──IDトークン付きで読み書き──▶ Apps Script
ゲスト  ──参加リンク（GitHub Pages）──合言葉付きで出欠だけ──▶ Apps Script
```

## 構成

| ディレクトリ | 内容 |
| --- | --- |
| `packages/shared` | 型・業務ルール（練習ID、割り勘、キャンセル期限、延長判定）・Flex Message・カレンダー |
| `apps/gas` | Apps Script。`src/app/` が業務ロジック（GAS非依存でテスト可能）、`src/gas/` がシート・LINE・Geminiとの接続 |
| `apps/worker` | Cloudflare Workers。LINEの署名を確かめて Apps Script に中継 |
| `apps/liff` | LINE内アプリ（Preact）と参加リンクのページ `join.html` |
| `docs/` | 初期設定・デプロイ手順、予約者・メンバー向けの案内文、グループでの動作確認チェックリスト |

## はじめかた

```bash
npm install
npm test
npm run dev:mock -w @studio-attendance/liff   # LINE・Googleの準備なしで画面を確認
```

本番の準備とデプロイは [docs/setup.md](docs/setup.md) を参照してください。

## 主な仕様の実装場所

| 仕様 | 場所 |
| --- | --- |
| スクショ・文章の読み取り（Geminiへの指示文） | `apps/gas/src/app/prompt.ts` |
| 確認カード・募集・出欠ボタン・「練習」への応答・トークの文章からの登録 | `apps/gas/src/app/webhook.ts` |
| 登録（重複・延長の判定）、出欠の記録、満員の判定 | `apps/gas/src/app/practices.ts` |
| LINE内アプリ向けAPIと権限チェック、改善要望 | `apps/gas/src/app/api.ts` |
| 参加リンク | `apps/gas/src/app/join.ts`、`apps/liff/src/join.tsx` |
| キャンセル期限前警告・終了処理 | `apps/gas/src/app/triggers.ts` |
| シートの列 | `apps/gas/src/app/schema.ts` |
| スタジオ・部屋の初期値と表記ゆれの吸収 | `packages/shared/src/studios.ts` |
| リッチメニュー（定義・画像） | `apps/gas/src/app/richmenu.ts`、`scripts/richmenu.mjs` |

## 改善要望の扱い

メンバーの要望はスプレッドシートの「要望」シートに集まります（アプリでは画面下のナビの「要望」から送る。届いた要望はアプリには出さず、このシートで見る）。
Claude Code で「要望をまとめて」と頼むと、`.claude/skills/feedback-review` のスキルが、要望をまとめて改善案を提案し、承認されたものだけ実装して「改善済み」にします。
