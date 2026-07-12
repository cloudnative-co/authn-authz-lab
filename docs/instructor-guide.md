# 認証認可入門 講師ガイド

このガイドは、連載の実習を学校・社内研修で扱う講師向けです。受講者の代わりにコマンドを実行して先へ進めるのではなく、予測、実行、拒否ケース、証拠、実務への転用を毎回同じ順序で学べるように進行します。

## 最初に確認すること

教材の対応状況は説明文ではなく、次の3ファイルを正とします。

- `curriculum/manifest.json`: Lessonの状態、必要port、resource、source
- `curriculum/support-matrix.json`: OS、CPU、Node.jsごとの検証状態
- `course-lock.json`: 配布sourceと生成教材の固定情報

`candidate`と`experimental`は正式対応を意味しません。授業で正式対応と案内するには、配布revisionの固定、対象profileでの実機確認、無支援pilotが必要です。`planned`のLessonは授業対象へ含めません。

## 学習経路と時間

| 経路 | 対象 | 標準時間 | 修了として扱える範囲 |
| --- | --- | ---: | --- |
| **完全コース（推奨）** | 必須の準備ラボ、記事を読みながら同記事内の実習を1回、読了後に5問、Capstone | **1935分** | 読解と実行の両方 |
| 読解 | [記事01〜15と各回5問](../course/reading/README.md) | 695分（11時間35分） | 概念理解とcase-based理解確認。実行技能は含まない |
| 実習 | 必須の60分準備ラボ、Lesson 01〜15、Capstone | 1240分 | lab submissionとrequired checkを実行したLessonだけ |
| 講師準備 | 実習経路に追加 | 4時間 | ガイド確認、復旧drill、採点calibration、進行rehearsal |

標準実習1240分とは別に、Lesson 02〜15には計765分の任意発展課題があります。各`extension.yaml`は標準required check合格後だけ使用し、標準時間や必須修了条件へ合算しません。

完全コースでは、準備ラボの`AA-SETUP-C1`〜`AA-SETUP-C3`と再`setup`を先に完了し、各記事を上から読みながら記事内の予測、lab lifecycle、required checkを一度だけ行います。記事を読み終えた後に読解5問で4問以上を確認し、最後にCapstoneを実施します。Lesson guideは同じ実習の詳細参照であり、二重実行しません。実習経路でも準備ラボは任意にしません。

経路別の時間は`curriculum/course-source.snapshot.json`の`learningPaths`、Lesson別の時間とcheckは`curriculum/course-contract.json`を配布revisionごとに再確認します。短縮開催では、正常系だけを残して拒否ケースを削りません。Lesson数を減らし、選んだLessonを完全な契約で実施します。

## 授業前ゲート

1. 未ログイン環境から配布revisionを取得できる
2. `npm ci`がlockfileどおり完了する
3. `node course.mjs doctor`が対象profileでpassする
4. 授業で使う各Lessonを、空の学習stateから講師が完走する
5. `purge`後のJSONで、`diagnostics[]`内の`id: "resources.remaining"`である要素の`actual`が文字列`"0"`になる
6. Dockerまたはbrowserが必要な回は、同じ教室networkで初回取得まで試す
7. proxy、EDR、port制御、filesystem制御によるblockを事前に記録する

実在する組織のaccount、password、token、directory dataは使いません。教材のdummy credentialだけを、ガイドで指定されたlocal endpointに入力します。

## 1回の進行

| 段階 | 受講者がすること | 講師が確認すること |
| --- | --- | --- |
| 記事 | 対応する連載記事を読む | 用語と境界を本文から説明できるか |
| 予測 | 結果を見る前にallow / denyと検証者を答える | 用語の暗記ではなく責任分界を説明できるか |
| 実行 | `doctor`、`setup`、`demo`を順に実行する | 手作業でserviceを起動していないか |
| 拒否 | 一条件だけ不正なcaseを観察する | 複数条件を同時に壊していないか |
| 証拠 | `observe`のstatus、field、reasonを読む | secretではなく判定根拠を使っているか |
| 回答 | `submission.json`の`TODO`だけを埋める | field名や階層を変更していないか |
| 採点 | fresh scenarioの`check`を実行する | demo結果の再利用ではないか |
| 転用 | 実務での確認箇所と限界を書く | training deviationを本番推奨へ読み替えていないか |
| 終了 | `stop`または`purge`を実行する | 所有resource以外へ触れていないか |
| 読解 | 記事を読み終えた後に5問へ回答し4問以上正解する | 不正解時に指定見出しへ戻ったか |

## 採点

- 合否は各Lessonの`assessment.yaml`と自動`check`を正とする
- 解答は採点後または講師の指定時刻まで公開しない
- required checkをskipした提出は合格にしない
- 自動採点が通っても、説明が課題のrubricを満たさない場合は再提出にする
- readingだけの受講者へ、runtimeのcourse outcomeを修了認定しない

`evidenceId`は実行証拠の識別子であり、学習内容の理解そのものを自動的に証明しません。講師は同じevidenceを根拠に、受講者が発行者、運搬者、検証者、寿命、拒否理由を説明できるか確認します。

## 介入ルール

受講者が止まったら、最初に出力の`reasonCode`と`recovery`を読んでもらいます。次に`lesson diagnose`、最後にcourse全体の`diagnose`を使います。

講師が入力を代行した、stateを変更した、教材外の設定を変えた場合は予定外介入として記録します。所有確認を回避する削除、port番号だけを根拠にしたprocess停止、lockやmarkerの手編集、version checkの無効化は禁止です。

共通の切り分けは[トラブルシュート](troubleshooting.md)、Lesson固有の復旧は各`course/lessons/<id>/instructor-guide.md`を使います。

## pilotの合格条件

公開教材または正式研修へ昇格する前に、少なくとも初学者3名、対応予定のOS 2種類で無支援pilotを実施します。参加者にはREADMEに書いた前提以外を口頭で補いません。

記録には[無支援pilot観察票](pilot-observation-template.md)を使い、次の項目を残します。

- `doctor`開始から`purge`までの所要時間
- `reasonCode`、自力復帰時間、予定外介入回数
- required checkの合否とevidence IDの有無
- purge後の残存resource数
- 読み違えた説明、図、手順

進行不能、安全でない回避、教材外dataの削除、15分を超える自力復帰はblockerです。修正後は同じ初期条件から再pilotします。氏名、hostname、home path、IP、secret、`.lab`の内容はpilot記録へ保存しません。

## 授業終了時

回答を次回へ残す場合はLessonごとに`stop`します。端末を返却する、受講を終了する、共有環境を初期化する場合は、受講者本人の確認後に次を実行します。

```bash
node course.mjs purge --yes --json
```

成功条件はJSONの`diagnostics[]`内で、`id: "resources.remaining"`である要素の`actual`が文字列`"0"`であることです。Dockerの共有image cacheやPlaywright browser cacheは教材所有resourceではないため、教材の`purge`は削除しません。
