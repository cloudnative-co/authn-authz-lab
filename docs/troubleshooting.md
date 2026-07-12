# 共通トラブルシュート

エラーが出たときは、stateやprocessを手作業で消さず、出力の`status`、`reasonCode`、`recovery`を順に確認します。教材は、所有権を確認できないresourceへ触れないために意図的に停止します。

## 最初の3手

```bash
node course.mjs lesson <id> diagnose
node course.mjs diagnose
node course.mjs lesson <id> doctor
```

`<id>`は受講中のLesson番号へ置き換えます。`diagnose`が示すrecoveryを実行した後、同じコマンドを再実行します。

## statusと終了code

| 状態 | 意味 | 対応 |
| --- | --- | --- |
| `pass` | 期待した処理を完了した | 次へ進む |
| `safe-noop` | 目的の状態にすでになっている | 次へ進む |
| `blocked` | 前提不足または安全条件を満たさない | `reasonCode`の原因を直す |
| `fail` | 実行または学習checkに失敗した | `recovery`とfailed checkを確認する |

主な終了codeは、`0`がpass / safe-noop、`2`が入力不正、`10`が学習check不合格、`20`が前提不足、`21`がlock競合、`30`が所有resourceの起動・停止失敗、`31`がtimeoutです。

## よくある原因

| 症状・reasonCodeの系統 | 確認すること | 復旧の考え方 |
| --- | --- | --- |
| `PREREQUISITE_SETUP` | course setupを実行したか | `node course.mjs setup`後にLessonを再実行する |
| `UNSUPPORTED_PLATFORM` | support matrixにprofileがあるか | 対応profileへ移る。判定を無効化しない |
| `*_PORT_IN_USE` | 表示されたportを別processが使っていないか | 自分が起動したprocessを通常手順で終了する。PIDを推測してkillしない |
| `PREREQUISITE_DOCKER_*` | CLI、Compose、daemonが利用できるか | Docker Desktop / daemonを起動し、`doctor`を再実行する |
| `CONTAINER_*` | build logの最初のerror、network、空き容量 | 原因を直し、Lessonの`setup`を再実行する |
| `LOCK_HELD` | 別terminalで教材commandが動いていないか | 先のcommandを完了させる。lock fileを削除しない |
| `LOCK_*UNVERIFIABLE` | process所有権を確認できる環境か | `diagnose`の指示に従う。強制解除しない |
| `STATE_*DRIFT` | source、schema、repository、installが変わっていないか | 回答を退避する必要を判断し、所有確認済み`stop` / `purge`後に同じrevisionで再開する |
| `PROCESS_*` | processが途中終了したか、fingerprintが一致するか | `diagnose`から安全なrecoveryを選ぶ。portだけでprocessを特定しない |
| `CHECK_*SUBMISSION_INVALID` | JSON、`TODO`、許可値、field階層 | 受講者ガイドと`workspace-template.json`を照合する |
| `TIMEOUT_COMMAND` | Docker build、初回起動、端末負荷 | 原因を確認し、ガイドにある場合だけ`--timeout`を延ばす |

## Docker Lesson

Lesson 06〜09の一部はDockerを使います。手動の`docker compose up`で教材を迂回せず、runnerに所有resourceを作らせます。

```bash
docker version
docker compose version
node course.mjs lesson <id> doctor
```

初回buildはimage取得とcontainer初期化に時間がかかります。proxy、VPN、registry制限、Docker disk残量を確認します。別教材のcontainerを一括削除する`docker system prune`は復旧手順として使いません。

## Browser Lesson

Lesson 13・14はPlaywright用Chromiumが必要です。`npm ci`はNode.js packageを導入しますが、browser binaryまでは用意しません。

```bash
npx playwright install chromium
node course.mjs lesson 13 doctor
```

実行後もblockedの場合は、browser executable、sandbox制約、localhostへの接続、EDRのbrowser automation制限を確認します。仮想認証器の成功を、実端末のTouch ID、security key、cloud同期の検証結果として扱いません。

## 回答を最初からやり直す

対象Lessonの回答を破棄してよい場合だけ実行します。

```bash
node course.mjs lesson <id> reset
```

`reset`は対象Lessonをseed状態へ戻します。course全体を消す操作ではありません。すべての教材stateと内部evidenceを削除する場合だけ、内容を確認して`purge`します。

## やってはいけない復旧

- `.lab/`、lock、markerを手作業で作成・編集・削除する
- port番号だけを根拠にprocessをkillする
- 教材以外のcontainer、network、volumeを一括削除する
- `npm install`でlockfileと異なる依存関係へ変える
- Node.js、OS、source revisionの検査を無効化する
- 実在accountのpassword、Cookie、tokenを診断情報へ貼り付ける

復旧できない場合は、`reasonCode`、実行command、OS / CPU / Node.js / Dockerのversion、secretを除いた最初のerrorだけを講師へ共有します。
