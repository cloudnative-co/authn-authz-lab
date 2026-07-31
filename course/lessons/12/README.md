# 第12回 TOTPの登録からMFAセッションまでを追跡する

実習のみ（1240分）では、準備ラボ完了後にこのガイドを上から進めます。完全コース（1935分）では、対応記事の中でこの実習を一度だけ行い、記事を読み終えた後に[第12回の読解5問](../../reading/lessons/12/README.md)で4問以上を確認します。このガイドは詳細確認に使い、同じcommandを二重実行しません。読解のみ（695分）では実習不要です。

この演習では、パスワードとTOTPを使う二段階ログインを実HTTPで動かします。秘密鍵を配るだけでは登録完了にせず、現在のTOTPで所持を確認します。その後、パスワードだけではapplication sessionを発行せず、TOTPまたは一回限りのrecovery codeが成功して初めてsessionを発行します。所要時間の目安は90分です。

## この回でできるようになること

- 知識・所持・生体というfactor分類と、二段階という画面数を区別できる
- [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238.html)のTOTPを、共有秘密、time step、HOTP、検証windowの関係で説明できる
- 登録前の再認証、登録確認、ログイン用pre-auth、application sessionを別のstateとして追跡できる
- 誤値、期限切れ、同じcounterの再利用、試行過多を異なる内部条件として扱いながら、安全な外部応答を選べる
- TOTPの共有秘密とphishing耐性の限界を踏まえ、WebAuthnを選ぶ条件を説明できる

## 最初に全体を確認する

```text
登録
  password確認
    -> enrollment transaction
    -> otpauth URIを表示
    -> 現在のTOTPで確認
    -> factor有効化 + recovery codeを一度だけ表示

ログイン
  password確認
    -> pre-auth transaction（application sessionではない）
    -> TOTPまたは未使用recovery codeを検証
    -> application sessionを発行
```

TOTPは、短時間だけ有効な6桁のpasswordをserverが毎回発行する仕組みではありません。authenticatorとserverが共有秘密を持ち、同じtime stepから同じ値を計算します。教材はRFC 6238 Appendix Bのtest vectorでSHA-1、SHA-256、SHA-512実装を照合し、演習では相互運用性を優先してSHA-1、6桁、30秒を使います。

## 実装の範囲と限界

この回の主要な実装は次のファイルです。

- [`totp.mjs`](../../../packages/totp/totp.mjs): HOTPのdynamic truncation、TOTP、Base32、検証window、replay拒否
- [`mfa-service.mjs`](../../../apps/project-app/lessons/12/mfa-service.mjs): 登録、pre-auth、rate limit、recovery code、session gate
- [`http-handler.mjs`](../../../apps/project-app/lessons/12/http-handler.mjs): 実HTTP endpointとhost-only cookie
- [`scenario.mjs`](scenario.mjs): 正常系と拒否系をfresh scenarioで実行し、秘密を除いた観察結果を作る
- [`assessment.mjs`](assessment.mjs): `AA12-C1`〜`AA12-C3`の採点契約

`otpauth://` URIは広く使われるecosystem conventionです。RFC 6238はTOTP計算を定めますが、このURI形式を標準化していません。教材はURIにsecret、issuer、algorithm、digits、periodを入れて実際にparseしますが、QR code readerや実端末authenticatorの画面は検証しません。

教材の共有秘密はfresh scenarioのmemoryにだけ置きます。本番の安全な保存、暗号鍵管理、HSM、backup、rotation、複数device登録は実装範囲外です。RFC 6238もvalidator側の鍵を保護し、必要なprocessだけがaccessできるよう求めています。

## 前提

repository rootで次が成功している必要があります。

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

Node.jsは24.xまたは26.xです。第02回のpassword認証を学習上の前提にしますが、第02回のruntime stateは不要です。演習は固定の教材accountだけを使います。実在する組織、個人、ほかのserviceのpassword、TOTP secret、recovery codeを入力しないでください。

## 1. 実行前に予測する

まだ[`answer-key.md`](answer-key.md)を開かず、次を自分のメモへ書きます。

1. passwordが正しければ、TOTP入力前にapplication sessionを発行してよいか
2. 登録画面でsecretを表示した時点と、現在のTOTPを確認した時点のどちらでfactorを有効にするか
3. 30秒が終わる前なら、成功済みの同じTOTPをもう一度受け入れてよいか
4. 誤った6桁、期限切れ、再利用を利用者へ別々に説明してよいか
5. TOTPはphishing-resistant authenticationか
6. recovery codeを平文で保存し、何度も使えるようにしてよいか

## 2. 診断して準備する

```bash
node course.mjs lesson 12 doctor
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 12 setup
```

`[PASS]`または`safe-noop`を確認してから`demo`へ進みます。失敗時は`reasonCode`と`recovery`を解消し、同じ`setup`を再実行します。

`doctor`はcourse state、Node.js、port、教材契約を確認します。`setup`は教材所有のproject-appを起動し、`.lab/submissions/12/submission.json`を初回だけ作ります。既存回答は上書きしません。

`[BLOCKED]`または`[FAIL]`なら、表示された`reasonCode`と`recovery`を先に読みます。`.lab`を手作業で削除したり、所有者不明のprocessを停止したりしません。

## 3. 登録とログインを実行する

```bash
node course.mjs lesson 12 demo
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 12 observe
```

`[PASS]`を確認してから回答を編集します。失敗時は`check`へ進まず、`reasonCode`と`recovery`を解消して同じ`observe`を再実行します。

`demo`は隔離したfresh scenarioで次を実行します。

| 段階 | 入力 | 期待する外部結果 |
| ---: | --- | --- |
| 1 | 登録前のpassword | `201`、enrollment cookie、application sessionなし |
| 2 | enrollment開始 | `200`、`otpauth://totp/...`、Base32 secret |
| 3 | 現在のTOTP | `201 TOTP_ENROLLED`、recovery codeを一度だけ表示 |
| 4 | password | `200 PASSWORD_FACTOR_VERIFIED`、pre-auth cookieだけ |
| 5 | 登録確認で使った同じTOTP | generic `422`、sessionなし |
| 6 | 次のtime stepのTOTP | `200 MFA_AUTHENTICATED`、application session発行 |
| 7 | 期限切れと誤値 | 同じgeneric `422` body |
| 8 | recovery code | 初回`200`、再利用はgeneric `422` |
| 9 | 連続失敗 | threshold到達時`429`と`Retry-After: 30` |

scenarioは実際のsecret、TOTP、recovery codeを一時的に受け取って計算します。しかし`runtime.json`へ保存する前に、それらとcookie/tokenを捨てます。

## 4. runtime evidenceを読む

`.lab/submissions/12/runtime.json`を開き、少なくとも次を確認します。

### 登録

- `enrollment.passwordGateStatus`が`201`
- `passwordGateSessionIssued`が`false`
- `provisioningUri.scheme`が`otpauth:`、`type`が`totp`
- `algorithm`が`SHA1`、`digits`が`6`、`period`が`30`
- `rawUriOmitted`と`rawSecretOmitted`が`true`
- `confirmationStatus`が`201`

enrollment responseにsecretが存在したことは確認しますが、secret自体は保存しません。secretがなければauthenticatorへ共有できず、保存すれば教材証跡からfactorを複製できるためです。

### 二段階ログイン

- `authentication.passwordStepSessionIssued`が`false`
- `replayedConfirmationStatus`が`422`
- `secondFactorStatus`と`applicationSessionStatus`が`200`
- `methods`が`password`と`totp`
- session cookieが`HttpOnly`、`SameSite=Lax`、host-onlyである
- loopback HTTPのため`Secure`は`false`であり、本番承認ではない

### 拒否と復旧

- `expiredStatus`と`wrongStatus`がともに`422`
- `genericBodiesEqual`が`true`
- recovery codeの初回が`200`、再利用が`422`
- rate limitが`429`、`retryAfterSeconds`が`30`
- `replayStateStored`が`true`

### 秘匿境界

`redaction`のpassword、TOTP secret、provisioning URI、TOTP code、recovery code、transaction token、session token、digest、counterがすべて`omitted`であることを確認します。画面共有や質問時にも`runtime.json`だけを使い、登録responseやterminalのsecretを貼り付けません。

## 5. 回答ファイルを編集する

`.lab/submissions/12/submission.json`の12個の`TODO`だけを、次の許可値から選んで置き換えます。field名、階層、`schemaVersion`、`lessonId`は変えません。

| Check | Field | 許可値 |
| --- | --- | --- |
| `AA12-C1` | `enrollmentGate` | `password-before-secret-provisioning` / `anonymous-secret-provisioning` |
| `AA12-C1` | `provisioning` | `otpauth-ecosystem-uri-with-rfc6238-parameters` / `rfc6238-standardized-qr-uri` |
| `AA12-C1` | `confirmation` | `current-code-required-and-counter-consumed` / `secret-is-active-without-confirmation` |
| `AA12-C1` | `applicationSession` | `issued-only-after-second-factor` / `issued-after-password-before-second-factor` |
| `AA12-C2` | `replay` | `accepted-counter-rejected-on-reuse` / `same-code-may-be-reused-until-period-ends` |
| `AA12-C2` | `invalidSurface` | `wrong-expired-and-replayed-are-generic` / `replay-and-expiry-are-revealed-to-the-client` |
| `AA12-C2` | `throttling` | `account-level-rate-limit-with-retry-after` / `unlimited-six-digit-guesses` |
| `AA12-C2` | `evidence` | `passwords-secrets-codes-and-tokens-omitted` / `save-provisioning-uri-and-codes-for-debugging` |
| `AA12-C3` | `factorClassification` | `totp-is-possession-of-a-shared-secret` / `totp-is-a-biometric-factor` |
| `AA12-C3` | `phishingResistance` | `totp-is-not-phishing-resistant` / `totp-is-phishing-resistant-because-it-expires` |
| `AA12-C3` | `recoveryCode` | `single-display-high-entropy-hash-and-single-use` / `store-short-recovery-codes-in-plaintext-for-reuse` |
| `AA12-C3` | `strongerChoice` | `prefer-webauthn-when-phishing-resistance-is-required` / `prefer-sms-or-totp-whenever-phishing-resistance-is-required` |

JSONの値は二重引用符で囲みます。最後のfieldの後ろへcommaを追加しません。各回答の横に、根拠にしたruntime fieldまたは本文の一次情報を自分のメモへ残してください。

## 6. fresh scenarioで採点する

```bash
node course.mjs lesson 12 check
```

全required checkが`pass`になるまで、教材processまたはlesson stateを保持します。`fail`の場合は`stop`や`reset`へ進まず、`observe`→回答修正→`check`を繰り返します。

`check`は保存済み`runtime.json`を信用せず、新しいscenarioで登録からrate limitまで再実行します。

| Check | 合格条件 |
| --- | --- |
| `AA12-C1` | password gate、otpauth URI、登録確認、pre-auth、第二要素後のsessionがruntimeと回答で一致する |
| `AA12-C2` | counter replay、generic failure、account-level rate limit、secret非保存が一致する |
| `AA12-C3` | factor分類、phishing耐性、single-use recovery、より強い方式の選択が一致する |

3件すべてがpassした場合だけ合格です。failした場合はcheck IDを見て、`AA12-C1`ならstate遷移、`AA12-C2`なら拒否と秘匿、`AA12-C3`なら方式比較へ戻ります。

## なぜ同じTOTPを再利用できないのか

30秒のtime step内では同じsecretから同じTOTPが出ます。しかしRFC 6238は、成功済みOTPの2回目を受け入れてはならないと定めています。短時間有効であることと、一回限りであることは別の条件です。

教材はfactorごとに最後に受け入れたcounterを保持します。検証window内でcodeが一致しても、そのcounterが最後の成功以下なら拒否します。外部bodyは誤値や期限切れと同じですが、内部eventは固定分類でreplayを診断できます。

## なぜ試行制限が必要なのか

6桁なら候補は100万通りです。有効時間が短くても、serverが無制限に試行を受ければonline guessingを許します。教材はsubject単位で失敗を数え、3回目で`429`と`Retry-After`を返します。新しいpre-auth cookieを取り直してもsubject単位のcountは回避できません。

実務ではthresholdの数字だけをコピーしません。攻撃検知、利用者への通知、分散試行、support導線、誤lockout、risk signalと合わせて決めます。

## TOTPを「phishing-resistant MFA」と呼ばない

TOTPはpasswordとは別の所持factorになり得ますが、利用者が見ているsiteへ手入力する値です。偽siteが入力値を即時転送する攻撃をprotocol自身では防ぎません。短い有効時間やMFAという名称だけでphishing-resistantにはなりません。

phishing耐性が要件なら、第13回以降のWebAuthnでoriginとRP IDにcredentialが結び付く仕組みを確認します。TOTPを直ちに廃止できない場合も、対象者、保護対象、移行順、fallbackを分けて設計します。

## recoveryを弱い抜け道にしない

教材のrecovery codeは160-bit random、初回だけ表示、salt付きdigest保存、一回限りです。ただし、codeの保管場所、紛失時の本人確認、factor resetの承認、support担当者の権限、既存sessionの失効までは自動化していません。

実務へ移すときは次を決めます。

| 項目 | 確認すること |
| --- | --- |
| enrollment | 直前の再認証、既存factor確認、通知、監査 |
| secret storage | encryption、key separation、access制御、backup、rotation |
| verification | time source、window、replay state、rate limit、risk signal |
| recovery | recovery code、複数factor、本人確認、承認、通知、失効 |
| device change | 追加、削除、紛失、機種変更、退職時のowner |
| session | MFA後のrotation、認証時刻、強度、再認証条件、全session失効 |
| migration | WebAuthn/passkey対象、例外、期限、support、測定指標 |

不明な項目は推測せず「未確認」と記録します。

## 終了、やり直し、完全削除

回答とevidenceを残し、教材所有processだけを止めます。

全required checkの`pass`を確認した後だけ、次の`stop`を実行します。

```bash
node course.mjs lesson 12 stop
```

第12回の回答を破棄してやり直す場合だけresetします。

```bash
node course.mjs lesson 12 reset
```

教材が作った全lessonの回答、evidence、stateを削除してよい場合だけpurgeします。lesson形式でも範囲はcourse全体です。

```bash
node course.mjs lesson 12 purge --yes --json
```

purgeは取り消せません。成功時はJSONの`diagnostics[]`内で、`id: "lesson.purge-scope"`の要素が`actual: "course-wide"`、`id: "resources.remaining"`の要素が`actual: "0"`であることを確認します。

## 困ったとき

| 状況 | 確認 | 対応 |
| --- | --- | --- |
| `PREREQUISITE_SETUP` | course共通setup | `node course.mjs setup`を実行する |
| TODOまたは未知値 | 12 fieldと許可値 | templateと比較しTODOだけ直す |
| JSON parse error | quote、comma、brace | editorで構文を直す |
| project-appを起動できない | reason code、port owner | `node course.mjs lesson 12 diagnose`を実行する |
| secretやcodeを共有した | terminal、chat、screenshot | 共有を止め、実credentialならfactorを失効・再登録する |
| TOTPが同じ30秒内で拒否された | 直前の成功counter | 次のtime stepを待つ。replay防止を無効化しない |
| clock driftが疑われる | serverとauthenticatorの時刻同期 | 許容windowを無制限に広げず、時刻同期と再登録を確認する |
| HTTPで動いたので本番もよいと思った | cookieの`secure`とlimitations | loopback training deviationであり、productionはHTTPSとSecure cookieが必要 |

## 任意の45分発展課題

AA12-C1〜C3の合格後、`extension.yaml`のAA12-X1〜X3へ進めます。TOTP例外、factor recovery、fallbackの運用を設計します。この時間は標準実習1240分に含めません。
