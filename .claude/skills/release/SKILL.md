---
name: release
description: スタジオ練出欠管理 の新しいバージョンを出す。前回のタグからの変更をまとめ、番号を決め、GAS のデプロイと push、CHANGELOG.md への追記、タグ、GitHub Release の作成までを行う。ユーザーが「リリースして」「バージョンを上げて」「リリースノートを作って」などと頼んだときに使う。
---

# リリース

前回のタグからの変更を、**まとめる → 番号を決める → ユーザーに確認 → 公開する** の順で扱う。
確認を取るまでは、デプロイ・push・タグ・Release の作成をしない。

## 1. 変更をまとめる

1. `git describe --tags --abbrev=0` で前回のタグを調べる。
2. `git log <前回のタグ>..main --oneline --no-merges` でコミットを見る。
3. `docs:` `test:` `chore:` `ci:` `style:` `refactor:` だけのコミットは、使う人から見えないのでリリースノートに書かない。

## 2. 番号を決める（セマンティックバージョニング）

| 前回からの変更 | 上げる位置 | 例 |
| --- | --- | --- |
| 不具合の修正・速さの改善だけ（`fix:` `perf:`） | 3つ目 | 1.0.0 → 1.0.1 |
| できることが増えた・見た目や文言が変わった（`feat:` がある） | 2つ目 | 1.0.0 → 1.1.0 |
| 使い方が大きく変わる・配ったリンクやカードが使えなくなる・シートの形が変わる | 1つ目 | 1.x → 2.0.0 |

使う人から見える変更が1つもなければ、リリースしなくてよいとユーザーに伝える。

## 3. リリースノートを書く

- [CHANGELOG.md](../../../CHANGELOG.md) の `---` のすぐ下に、`## vX.Y.Z（YYYY-MM-DD）` を足す。
- 見出しは、あるものだけ使う：「新しくできること」「変わったこと」「直したこと」。
- 使う人に向けて、「何ができるようになったか」「何が変わったか」を書く。コードやファイルの名前、コミットの題名は書かない。
- 言葉は [docs/glossary.md](../../../docs/glossary.md) に従う。
- 公開する文（CHANGELOG・タグ・Release）には、使っているグループの名前や、「仲間内」のような内輪の言い方を書かない。
- 書いた内容と番号をユーザーに見せて、確認を取る。

## 4. 公開する（確認が取れてから）

1. `npm run typecheck` と `npm test`、`npm run build -w @studio-attendance/liff` が通ることを確かめる。
2. CHANGELOG.md を `docs: vX.Y.Z のリリースノートを追加` でコミットする。
3. GAS をデプロイする：`npm run deploy -w @studio-attendance/gas`。出力の `@番号` を控える。
4. タグを付けて push する。
   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z（GAS @番号）"
   git push origin main vX.Y.Z
   ```
5. GitHub Pages の公開を確かめる：`gh run list --workflow pages.yml --limit 1`。
6. GitHub Release を作る。本文は CHANGELOG.md のその版の部分だけ。
   ```bash
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <その版の部分を書き出したファイル>
   ```
7. Release の URL と、グループにそのまま貼れる短いお知らせ（3〜5行）をユーザーに渡す。グループに送るのはユーザーが行う。
