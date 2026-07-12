# 第02回 パスワード認証の保存と照合を追跡する

実習のみ（1240分）では、準備ラボ完了後にこのガイドを上から進めます。完全コース（1935分）では、対応記事の中でこの実習を一度だけ行い、記事を読み終えた後に[第02回の読解5問](../../reading/lessons/02/README.md)で4問以上を確認します。このガイドは詳細確認に使い、同じcommandを二重実行しません。読解のみ（695分）では実習不要です。

この演習では、passwordを登録して照合する処理を、保存、認証応答、試行制限の3つに分けて観察します。所要時間の目安は75分です。

## この回でできるようになること

- 平文、salt、scryptのwork factor、保存表現の役割を区別する
- 正しいpassword、誤ったpassword、存在しないidentifierの応答を比較する
- online試行を抑えるrate limitと、保存表現が漏えいした後のoffline推測対策を分けて説明する
- この回では認証だけを扱い、sessionをまだ発行しないことを確認する

## 実装の範囲

この回が実行するのは、教材内のpassword認証サービスです。実装の正は次の3ファイルです。

- [`password-auth-service.mjs`](../../../apps/project-app/lessons/02/password-auth-service.mjs): identifierの正規化、照合、generic failure、rate limit
- [`scrypt-password.mjs`](../../../packages/password/scrypt-password.mjs): NFC正規化、salt生成、scrypt、保存表現のparseと照合
- [`password-policy.mjs`](../../../packages/password/password-policy.mjs): password長の教材用policy

保存表現は`$course-scrypt$`で始まる**教材独自形式**です。PHC String Formatではなく、他製品との交換規格でもありません。保存metadataには教材既定の`scrypt N=32768 (2^15), r=8, p=3`とkey長が入り、saltは毎回16 byte生成されます。

passwordはKDFへ渡す前にUnicode NFCへ正規化します。同じ見た目の文字列でもcode point列が異なる場合があるためです。この規則は保存時と照合時で一致させ、保存済みcredentialがある状態で無計画に変更してはいけません。

## onlineとofflineを先に分ける

| 攻撃経路 | 攻撃者が試す場所 | この実装で観察する制御 |
| --- | --- | --- |
| online | `authenticate`を呼ぶサービス入口 | canonical identifierごとの失敗回数と一時block |
| offline | 漏えいした保存表現を攻撃者側で計算 | saltとscryptのwork factorによる1推測あたりの計算コスト |

rate limitは3回目の失敗で30秒blockし、`429`と`Retry-After`を返します。範囲は**per-identifier**です。globalなKDF同時実行数、送信元、account群をまたぐ攻撃、分散攻撃の防御は実装していません。rate limitはoffline推測には効かず、scryptも弱いpasswordを安全に変えるものではありません。

## 前提

リポジトリのルートで、次のcourse共通手順が成功している必要があります。

```bash
node --version
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
npm ci
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs doctor
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs setup
```

`[PASS]`または`safe-noop`を確認してから、このLessonの予測と個別`doctor`へ進みます。`[BLOCKED]`または`[FAIL]`なら、表示された`reasonCode`と`recovery`を解消し、同じ`setup`を再実行します。

Node.jsは24.xです。第02回は第01回の内容を前提にしますが、第01回のproject-appを起動したままにする必要はありません。

## 1. 予測する

実行前に、次の2点をメモします。

1. 同じpasswordを2回保存した場合、保存表現は同じになるか
2. 存在しないidentifierと、存在するidentifierへの誤passwordで、外部応答を変えるべきか

この時点では解答ファイルを開きません。

## 2. 課題を準備する

次の順に実行します。

```bash
node course.mjs lesson 02 doctor
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 02 setup
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 02 demo
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 02 observe
```

`[PASS]`を確認してから回答を編集します。失敗時は`check`へ進まず、`reasonCode`と`recovery`を解消して同じ`observe`を再実行します。

`setup`は、[`workspace-template.json`](workspace-template.json)を`.lab/submissions/02/submission.json`へ初回だけ複製します。既存回答を上書きしません。`demo`は教材が用意したcredentialだけで成功、失敗、salt差、rate limitを実行します。`observe`は平文password、保存表現全体、derived keyを表示しません。

`demo`が保存した観察結果は`.lab/submissions/02/runtime.json`で読みます。`check`はこのファイルを採点根拠として信用せず、隔離した新しいscenarioで同じ条件を再実行します。

## 3. 観察結果を読む

最低限、次を確認します。

- 保存表現の`format`、`version`、`workFactor`、`saltBytes`、短い`saltFingerprint`
- 同じ入力から作った2件で`saltFingerprint`が異なること
- 正しいcredentialが`200 AUTHENTICATED`でも`sessionIssued`は`false`であること
- 誤passwordと未知identifierが同じ`422 INVALID_CREDENTIALS`になること
- 同じidentifierの3回目の失敗が`429 RATE_LIMITED`になり、block中は正しいpasswordもKDF照合前に拒否されること
- observationに平文password、保存表現全体、derived keyが含まれないこと

未知identifierでもdummy credentialをscryptで照合します。これはidentifierの存在を応答差から推測しにくくするためです。ただし、処理時間差がどの環境でも完全に消えると保証するものではありません。

このAPIはHTTP認証方式のchallengeではなく、JSONでcredentialを検証するアプリケーション機能です。そのため失敗は`WWW-Authenticate`を伴う`401`ではなく、同じgenericな`422`に統一します。

教材scenarioで追跡するidentifierは、短時間で境界を再現できるよう最大8件です。期限切れの記録を除いても上限を超える場合は、9件目の未追跡identifierを`503 AUTHENTICATION_CAPACITY_EXCEEDED`と`Retry-After: 1`でKDF照合前に拒否し、メモリを無制限に増やしません。service単体の既定値は1024件です。どちらもrate-limit状態の容量保護であり、KDF全体の同時実行数を制限する仕組みではありません。

## 4. 回答ファイルを編集する

`.lab/submissions/02/submission.json`の`TODO`だけを、次の許可値から選んで置き換えます。field名、階層、lesson IDは変更しません。

| Field | 許可値 |
| --- | --- |
| `storedFormat` | `application-defined-not-phc` / `phc-string-format` |
| `passwordNormalization` | `NFC` / `none` |
| `scryptProfile` | `N=32768,r=8,p=3` / `N=16384,r=8,p=1` |
| `plaintextStorage` | `absent` / `present` |
| `samePasswordSalts` | `different` / `same` |
| `successfulResult` | `authenticated-without-session` / `authenticated-with-session` |
| `wrongAndUnknownFailure` | `same-generic-422` / `different-by-identifier-existence` |
| `sessionIssuance` | `not-implemented` / `implemented` |
| `thresholdResponse` | `third-failure-429-with-retry-after` / `unlimited-422` |
| `offlineGuessingControl` | `scrypt-work-factor-and-salt` / `per-identifier-rate-limit` |
| `onlineGuessingControl` | `per-identifier-rate-limit` / `stored-salt-only` |
| `rateLimitScope` | `per-identifier-not-global-kdf-defense` / `global-kdf-concurrency-defense` |

回答は観察結果から選びます。READMEの文章を写すだけでなく、どの出力が根拠かを自分のメモへ1行ずつ残してください。メモ自体は自動採点の対象外です。

## 5. 採点する

次を実行します。

```bash
node course.mjs lesson 02 check
```

全required checkが`pass`になるまで、教材processまたはlesson stateを保持します。`fail`の場合は`stop`や`reset`へ進まず、`observe`→回答修正→`check`を繰り返します。

| Check | 必須条件 |
| --- | --- |
| `AA02-C1` | 保存、NFC、scrypt parameter、平文非保存、salt差のruntime条件と回答が一致する |
| `AA02-C2` | 成功、generic 422、session未発行のruntime条件と回答が一致する |
| `AA02-C3` | 3回目の429、online・offlineの区別、per-identifierという限界の回答が一致する |

3件すべてがpassして初めて合格です。failならcheck IDを確認し、該当する観察を再実行して回答を直します。

## 6. 実務へ移す

自分が扱う認証基盤について、次を別々に確認します。分からない項目は「未確認」と書き、推測で埋めません。

1. password保存algorithmとparameter
2. Unicode正規化規則
3. online rate limitのkey、閾値、解除条件
4. KDF同時実行数やqueueなど、globalな容量保護
5. credential漏えい時の再hashまたは移行方針

## 終了とやり直し

回答を残して教材所有processを止めるコマンドです。

全required checkの`pass`を確認した後だけ、次の`stop`を実行します。

```bash
node course.mjs lesson 02 stop
```

現在の第02回答を破棄してやり直す場合だけ、次を使います。

```bash
node course.mjs lesson 02 reset
```

`reset`の前に、破棄してよい回答かを確認します。`.lab`の手作業削除や、所有者不明processの停止は行いません。

## 困ったとき

| 状況 | 確認 | 対応 |
| --- | --- | --- |
| `PREREQUISITE_SETUP` | course stateがない | `node course.mjs setup`を実行する |
| `TODO`または未知値でfail | submissionのfieldと許可値 | templateと比較して修正する |
| 3回目より前から429 | 同じidentifierで以前の失敗が残っているか | block終了を待つか、回答を破棄してよい場合だけresetする |
| passwordをログへ貼り付けた | 教材外のterminal履歴や共有物 | 共有を止め、実credentialなら直ちに変更する |

この演習に実在する組織のpassword、個人用password、再利用中のpasswordを入力しないでください。

## 任意の45分発展課題

AA02-C1〜C3の合格後、`extension.yaml`のAA02-X1〜X3へ進めます。password移行、入力規則、KDF容量保護を自環境へ対応づけます。この時間は標準実習1240分に含めません。
