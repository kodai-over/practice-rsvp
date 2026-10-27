# 初期設定とデプロイ手順

アカウント作成・ログイン・管理画面での設定・鍵の発行は手作業で行います（キーやトークンはチャットに貼らず、自分で各所に登録してください）。
ログイン後のコマンド操作は Claude Code に任せられます。

全体の流れ:

```
1. LINE（Messaging API / LINEログイン・LIFF）   ← 手作業
2. Google（スプレッドシート＋Apps Script）       ← clasp ログインは手作業、以降はコマンド
3. Gemini APIキー                                ← 手作業
4. Cloudflare Workers                            ← wrangler ログイン済みならコマンド
5. GitHub Pages                                  ← 手作業（設定）＋ push
6. つなぎ込み（URL・鍵を各所に登録）             ← 手作業
7. 動作確認・初期データ                          ← 手作業
```

---

## 0. 共有する秘密の値を1つ作る

Worker と Apps Script の間の中継用の合言葉（`RELAY_SECRET`）です。手元で作り、後で両方に同じ値を登録します。

```bash
openssl rand -hex 32
```

---

## 1. LINE

> **重要**: Messaging API チャネルと LINEログイン チャネルは **同じプロバイダー** の下に作ってください。
> 別のプロバイダーだとユーザーIDが一致せず、ボタンとアプリの出欠が別人扱いになります。

> アプリの正式名称は **スタジオ練出欠管理** です（英語名は Studio Practice Attendance Manager。サブタイトルとしてだけ使い、略称は使いません）。プロバイダー名・チャネル名・LIFFアプリ名・スプレッドシート名はこれにそろえます。

### 1-1. LINE公式アカウントと Messaging API
1. [LINE Official Account Manager](https://manager.line.biz/) で公式アカウントを作る（プランはコミュニケーションプラン＝無料）
2. 設定 → Messaging API → 「Messaging APIを利用する」→ プロバイダーを作成（名前は `スタジオ練出欠管理`）→「同意する」
   - プロバイダー名は、LINE内アプリを初めて開いた人の許可画面に提供元として出ます
   - **チャネルを作った後でプロバイダーは変えられません**
3. [LINE Developers](https://developers.line.biz/console/) で、そのチャネルの
   - 「チャネル基本設定」→ **チャネルシークレット** を控える（Worker に登録）
   - 「Messaging API設定」→ **チャネルアクセストークン（長期）** を発行して控える（Apps Script に登録）
   - 「グループトーク・複数人トークへの参加を許可する」を **オン**
4. Official Account Manager → 応答設定
   - 応答メッセージ: **オフ**
   - Webhook: **オン**（URLは 4. の後で登録）

### 1-2. LINEログインと LIFF
LINEログインチャネルは、LINE内アプリを開いた人が誰かを判別するための窓口です。中にLIFFアプリ（LINE内で開く画面）を登録します。

1. [LINE Developers](https://developers.line.biz/console/) で、1-1 で作ったプロバイダー `スタジオ練出欠管理` を開く（Messaging API チャネルが入っているはず）
2. 「新規チャネル作成」→「**LINEログイン**」
   - 会社・事業者の所在国・地域: 日本
   - チャネル名: `スタジオ練出欠管理`（許可画面に出ます。「LINE」という文字は使えません）
   - チャネル説明: 例「ダンス練習の出欠管理」
   - アプリタイプ: **ウェブアプリ**
   - メールアドレス: 自分のもの
3. 「チャネル基本設定」の **チャネルID** を控える（Apps Script の `LINE_LOGIN_CHANNEL_ID`）
4. 「LIFF」タブ → 追加
   - LIFFアプリ名: `スタジオ練出欠管理`
   - サイズ: **Full**
   - エンドポイントURL: GitHub Pages のURL（例 `https://<ユーザー名>.github.io/studio-attendance/`。5. の後で決まるので仮でよい）
   - Scope: **openid** と **profile** と **chat_message.write**（回答画面の「グループに伝える」で、本人の発言としてグループに送るため）
   - 友だち追加オプション: Off のままでよい
   - **LIFF ID** を控える（Apps Script と GitHub の両方に登録）
5. チャネルのステータスを「開発中」から「**公開**」にする（開発中のままだと、管理者以外がログインできない）

---

## 2. Google（スプレッドシート＋Apps Script）

1. https://script.google.com/home/usersettings で「Google Apps Script API」を **オン**
2. clasp にログイン（ブラウザが開きます）

   ```bash
   npx clasp login
   ```
3. スプレッドシートと、それに紐づく Apps Script を作る

   ```bash
   cd apps/gas
   npx clasp create --type sheets --title "スタジオ練出欠管理" --rootDir dist
   ```
   `apps/gas/.clasp.json` ができます（git には入りません）。
   スプレッドシートの名前を変えたり、ドライブ内で別のフォルダに移したりしても、Apps Script との紐づけは切れません。
4. コードを送る

   ```bash
   npm run push -w @studio-attendance/gas
   ```
5. Apps Script エディタを開き（`npx clasp open-script`）、関数 **`setupSheets`** を選んで実行 → 権限を承認。
   スプレッドシートに「練習」「出欠」「メンバー」「設定」の4シートができます（改善要望の「要望」シートは、最初の投稿時に自動でできます）。
6. 同じく **`installTriggers`** を実行（毎時のキャンセル期限前警告・終了処理と、シートを手で直したときにアプリの表示を新しくするトリガー）
7. ウェブアプリとしてデプロイ

   ```bash
   cd apps/gas && npx clasp deploy -d "初回"
   ```
   表示された Deployment ID を控え、ウェブアプリURL `https://script.google.com/macros/s/<Deployment ID>/exec` を作る。
   以後の更新は、同じURLのまま次のコマンドでできます（Deployment ID は `apps/gas/package.json` の deploy スクリプトに既定値として入れてあります。別のデプロイを更新するときは `GAS_DEPLOYMENT_ID=<ID>` を付ける）。

   ```bash
   npm run deploy -w @studio-attendance/gas
   ```

---

## 3. Gemini APIキー

[Google AI Studio](https://aistudio.google.com/apikey) でAPIキーを発行（無料枠）。
キーを作るときは「新しいプロジェクトを作成」を選び、**請求先アカウントにはつながない**でください（キー一覧の「請求階層」が「無料」になっていればOK）。

> 請求先アカウントにつなぐと、Gemini API は前払い（プリペイド）方式になります。前払い残高が0円のままだと、Google AI Pro 特典の月10ドル分のクレジットがあってもAPIが止まり、`402 prepayment credits are depleted` エラーになります。
> 無料枠では、混雑時に `503` が出ることがあります。システム側で再試行と軽量モデルへの切り替えをするので、通常はそのまま読み取れます。
無料枠では送った画像がGoogleのサービス改善に使われる場合があるため、予約者には電話番号などを切り取ってから送るよう案内します。

---

## 4. Cloudflare Workers

```bash
cd apps/worker
npx wrangler secret put LINE_CHANNEL_SECRET   # 1-1 のチャネルシークレット
npx wrangler secret put RELAY_SECRET          # 0. で作った値
npx wrangler secret put GAS_URL               # 2-7 のウェブアプリURL
npm run deploy -w @studio-attendance/worker
```

表示された `https://practice-board-webhook.<サブドメイン>.workers.dev` が Webhook URL です。

LINE Developers → Messaging API設定 → Webhook URL に登録し、「検証」が成功することを確認、「Webhookの利用」をオンにします。

---

## 5. GitHub Pages

1. GitHub にリポジトリを作り、このリポジトリを push
2. Settings → Pages → Source: **GitHub Actions**
3. Settings → Secrets and variables → Actions → **Variables** に登録
   - `VITE_LIFF_ID`: 1-2 の LIFF ID
   - `VITE_GAS_URL`: 2-7 のウェブアプリURL
4. Actions の「Deploy LIFF app to Pages」を実行（main への push でも動きます）
5. 公開URL（例 `https://<ユーザー名>.github.io/studio-attendance/`）を、LIFF のエンドポイントURLに登録

---

## 6. Apps Script のスクリプトプロパティ

Apps Script エディタ → プロジェクトの設定 → スクリプトプロパティ に登録します。

| キー | 値 |
| --- | --- |
| `LINE_CHANNEL_ACCESS_TOKEN` | 1-1 のチャネルアクセストークン |
| `LINE_LOGIN_CHANNEL_ID` | 1-2 の LINEログインのチャネルID |
| `LIFF_ID` | 1-2 の LIFF ID |
| `PAGES_URL` | 5. の公開URL（参加リンクのページに使う） |
| `GEMINI_API_KEY` | 3. のAPIキー |
| `RELAY_SECRET` | 0. で作った値（Worker と同じ） |
| `GEMINI_MODEL` | 任意。既定は常に最新のFlashを指す `gemini-flash-latest`。指定したモデルが提供終了で見つからないときも、自動でこれに切り替えて読み取る |
| `GAS_URL` | 任意。.ics の配信URL。空ならウェブアプリURLを自動で使う |

登録後、エディタで **`checkConfig`** を実行すると、足りない項目がログに出ます。

---

## 7. 動作確認と初期データ

1. 自分のLINEでBotを友だち追加 → スプレッドシートの「メンバー」に自分が載る
2. シートで自分の「権限」を **管理者** に書き換える（最初の1人だけ手で行う）
3. テスト用のグループにBotを招待 → 「設定」シートにグループが載る
4. グループで「練習」と送る → 一覧が返ればつながっています
5. Botとの個別トークに予約完了画面のスクショを送る → 確認カードの「登録のみ」で登録（グループに流すときは「登録して募集」か、アプリの「募集」で練習を開いて「グループに募集」）
6. 募集カードの「RSVP」を押す → その募集の練習だけの画面が開く。○ を選んで「グループに伝える」を押すと、「○ 10/21(水) 行きます」が自分の発言としてグループに出る
7. アプリの「自分」→「管理」で
   - グループに分かりやすい名前を付ける
   - メンバーごとに、ふだんの送り先グループを選ぶ（練習の登録はメンバーなら誰でもできる。グループが1つだけなら、未設定でもそのグループが送り先になる）
   - 見え方を確かめたいときは、アプリの「自分」→「見え方の確認」で「自分（一般メンバー）」や確認用の予約者「admin」に切り替えられる（管理者だけ。アプリを閉じると「自分（管理者）」に戻る）。「admin」は予約者の権限で、登録した練習の予約者は「admin（確認用）」になる。キャンセル期限前の警告は送らない。「admin」で募集すると本当にグループに届き、出欠も人数に数えられるので、テスト用のグループと練習で使う
   - メンバーごとに、入っているグループを確かめる。アプリで練習が見えるかはこれで決まる（予約した人・出欠を答えた人・管理者には常に見える）。グループでの発言・出欠ボタン・募集カードから開いたこと・グループへの参加で自動で付き、グループを抜けると外れる。一度も発言していない人は付かないので、ここでチェックする。この機能より前からいるメンバーは、Apps Script のエディタで `backfillGroupMembers` を一度実行すると、ふだんの送り先と、1つのグループにだけ募集した練習へのこれまでの回答から埋まる（何度実行してもよい）
   - BUZZ のキャンセル期限（利用規約で確認）、最低人数の標準値を入れる
   - スタジオの標準料金は、BUZZ横浜・BUZZ横浜東口・studio worcle 横浜の部屋ごとの料金表（2026年10月の公式サイト）が最初から入っている。料金が変わったら管理画面で直す

### メニュー（リッチメニュー）
Botとの個別トークの下に、アプリのトップを開く「アプリを開く」ボタンを1つだけ出します（黒地に白。アイコンはアプリ下のナビと同じ形）。
アプリを GitHub Pages に公開し、スクリプトプロパティを設定したあと、Apps Script エディタで **`setupRichMenu`** を1回実行してください（メニューを変えたときも同じ。古いメニューは自動で消えます）。
- メニュー画像は `node scripts/richmenu.mjs` で作り直せます（`apps/liff/public/richmenu.png`。macOSではヒラギノ角ゴシック、なければIPA/Notoのゴシックを使用）。画像を変えたら公開後に `setupRichMenu` をもう一度実行すると反映されます
- リッチメニューはBotとの個別トークにだけ出ます（グループには出ません）

### スタジオと部屋
登録画面のスタジオ・部屋の選択肢と、部屋の広さの表示は「設定」シートの「スタジオ」「部屋」の行が正本です。
シートにまだ1行もなければ、コードの初期値（2026年10月時点の公式サイトの情報: BUZZ横浜・BUZZ横浜東口・studio worcle 横浜）を使います。
- スタジオ側で部屋や広さが変わったら、アプリの「自分」→「管理」→「スタジオと部屋」で直して保存する（コードの変更・デプロイは不要）
- 一覧にないスタジオ・部屋は、登録画面で「その他」を選んで手入力できる
- 別名（例: わーくる横浜）は、スクショの読み取りで表記ゆれを正式名称にそろえるのに使う。「横浜 301」のように店舗名と部屋しかない画面は、部屋名からスタジオを判断する
- 標準料金・キャンセル期限は、設定のスタジオ名を**含む**スタジオに当たる（`BUZZ` は BUZZ横浜・BUZZ横浜東口の両方、`worcle` は studio worcle 横浜）。より詳しく書いた行が優先
- 標準料金は30分あたりの金額で、曜日（平日／土日祝。祝日は自動で判定）と時間帯を付けられる。設定シートの値は `平日 17:00-23:30 1300` のように書く。料金表にない時間帯（BUZZ の深夜パック、worcle の6時間セット）を含む練習は自動で入らないので手で入れる。シートの標準料金が0円の行だけなら、公式の料金表を使う

---

## うまく動かないとき

| 症状 | 確認すること |
| --- | --- |
| Webhook の検証が失敗する | Worker の `LINE_CHANNEL_SECRET`。`npx wrangler tail` でログを見る |
| ボタンを押しても何も起きない | Worker の `GAS_URL`・`RELAY_SECRET` と、スクリプトプロパティの `RELAY_SECRET` が同じか。Apps Script の「実行数」でエラーを見る |
| アプリが「ログインの有効期限が切れました」 | `LINE_LOGIN_CHANNEL_ID`。LINEログインチャネルが公開済みか |
| ボタンとアプリで別人扱いになる | Messaging API と LINEログインのプロバイダーが同じか |
| スクショを読めない | `GEMINI_API_KEY`。実行ログの `read error`。指示文は `apps/gas/src/app/prompt.ts` で調整 |
| 確認カードが届かない | 読み取りに時間がかかり応答トークンが切れた場合はプッシュで届く。Worker の待ち時間（最大30秒）を超えても Apps Script 側の処理は続く |

---

## 開発用コマンド

```bash
npm test                     # すべてのテスト
npm run typecheck            # 型チェック
npm run dev:mock -w @studio-attendance/liff # LINE・Googleなしで画面を確認（?as=U3 で一般メンバー表示）
npm run build -w @studio-attendance/gas     # apps/gas/dist/Code.js を作る
```
