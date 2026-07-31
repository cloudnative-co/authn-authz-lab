# 第13回 実ブラウザでWebAuthnの登録と認証を追跡する

実習のみ（1240分）では、準備ラボ完了後にこのガイドを上から進めます。完全コース（1935分）では、対応記事の中でこの実習を一度だけ行い、記事を読み終えた後に[第13回の読解5問](../../reading/lessons/13/README.md)で4問以上を確認します。このガイドは詳細確認に使い、同じcommandを二重実行しません。読解のみ（695分）では実習不要です。

この演習では、PlaywrightのChromiumとCDP virtual authenticatorを使い、ブラウザで実際に`navigator.credentials.create()`と`navigator.credentials.get()`を実行します。RP（Relying Party）は`@simplewebauthn/server` 13.3.2で応答を検証し、成功後だけcredential recordを保存します。所要時間の目安は120分です。

## この回でできるようになること

- RP server、browser、authenticatorの役割を分けて登録・認証ceremonyを追跡する
- challenge、origin、RP ID、UV、user handle、assertion signatureを誰が検証するか説明する
- 登録失敗時にauthenticatorへcredentialができても、RPへ保存してはいけない理由を説明する
- `attestation: none`と「検証しない」を区別する
- signCountをrisk signalとして扱い、cloneの証明と断定しない
- virtual authenticatorの自動試験が実hardware、OS、生体認証、real user gestureを証明しないと説明する

## 最初に3つの主体を分ける

```text
RP server
  challenge、RP ID、account固有user handle、optionsを作る
        |
        v
browser
  originとRP IDの関係を確認し、Web Authentication APIを仲介する
        |
        v
authenticator
  RP IDにscopedなcredentialを作り、認証時にassertionへ署名する
        |
        v
RP server
  challenge、origin、RP ID hash、UV、user handle、signatureを検証する
```

登録には`navigator.credentials.create()`、認証には`navigator.credentials.get()`を使います。教材はJSON化したoptionのchallenge、user ID、credential IDをbrowser側でbyte列へ戻してからAPIへ渡します。RPはbrowserの「成功した」という表示だけを信頼しません。

## 登録時の署名を正確に捉える

この教材は`attestation: none`を使います。RPはchallenge、origin、RP ID hash、user presence、UV、attestation objectを検証しますが、`none` formatにdevice attestation signatureはありません。これは登録検証を省略する意味ではありません。

credential private keyを持つことは、後続の認証assertionを登録済みpublic keyで検証して確認します。本文や回答で「登録時にdevice attestation signatureを必ず検証する」と一般化しないでください。

## user handleは表示用usernameではない

RPはaccountごとに暗号学的randomな64 bytesを一度生成し、`user.id`として登録optionへ入れます。email、username、それらのunsalted hashは使いません。user handleは表示せず、同じaccountへ登録するcredentialで同じ値を使います。

認証時、discoverable credentialは保存したuser handleを返せます。RPは返された値をcredentialのaccountへ対応づけ、clientが送った値だけでaccountを選びません。

## 実装の範囲と限界

主要ファイルは次のとおりです。

- [`webauthn-service.mjs`](../../../apps/project-app/lessons/13-14/webauthn-service.mjs): transaction、credential、user handle、検証、session、失効
- [`browser-page.mjs`](../../../apps/project-app/lessons/13-14/browser-page.mjs): actual `navigator.credentials.create/get`とJSON変換
- [`browser-lab.mjs`](../webauthn/browser-lab.mjs): Chromium、CDP virtual authenticator、別origin fixture
- [`scenario.mjs`](scenario.mjs): 正常系と単一条件の拒否をfresh scenarioで実行
- [`assessment.mjs`](assessment.mjs): `AA13-C1`から`AA13-C3`の採点契約

virtual authenticatorはCTAP2、internal transport、resident key、UVを模擬します。次は実証しません。

- hardware security、Secure Enclave、TPM、security keyの性質
- OSの実際のpasskey UI、PIN、生体認証
- 人が意図して行ったreal user gesture
- cloud同期、別端末移行、cross-device authentication
- attestation trust chainやenterprise attestation

## 前提を準備する

repository rootで実行します。Node.jsは24.xまたは26.xです。

```bash
node --version
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
npm ci
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
npx playwright install chromium
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

`npm ci`はJavaScript packageを固定lockから入れますが、教材が使うChromium binaryを用意する手順とは別です。`npx playwright install chromium`を省略しないでください。教材はbrowserを暗黙downloadしません。

組織proxyやTLS inspectionがある場合は、Playwrightの公式browser installation手順に従い、講師または管理者が事前配布してください。`sudo`、system packageの導入、proxy例外を受講者判断で行いません。

第12回は学習上の前提ですが、第12回のruntime stateは不要です。実在するpassword、credential、emailを入力しないでください。

## 1. 実行前に予測する

まだ[`answer-key.md`](answer-key.md)を開かず、次をメモします。

1. authenticatorがcredentialを作ったあとRPの検証が失敗した場合、RPはcredential recordを保存するか
2. emailのSHA-256をuser handleへ使ってよいか
3. challenge、origin、RP ID、signature、user handleをbrowserだけで確認すればよいか
4. `attestation: none`は、登録responseを無検証で保存する意味か
5. signCountが増えなければ、credential cloneを証明できるか
6. CDP試験が通れば、実端末の生体認証と人のgestureも確認済みと言えるか

## 2. browserを診断してworkspaceを作る

```bash
node course.mjs lesson 13 doctor
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 13 setup
```

`[PASS]`または`safe-noop`を確認してから`demo`へ進みます。失敗時は`reasonCode`と`recovery`を解消し、同じ`setup`を再実行します。

`doctor`はcourse state、Node.js、portに加え、PlaywrightがChromiumを実際に起動できるか確認します。成功時は`lesson13.playwright-chromium`がpassします。

`PREREQUISITE_PLAYWRIGHT_CHROMIUM`なら、まず次を実行します。

```bash
npx playwright install chromium
```

終了code 0を確認してから、同じLesson doctorを再実行します。installが失敗した場合はdoctorへ進まず、最初のerrorを解消します。

```bash
node course.mjs lesson 13 doctor
```

`[PASS]`を確認してから次へ進みます。`[BLOCKED]`または`[FAIL]`なら`reasonCode`と`recovery`を解消し、同じ`doctor`を再実行します。

それでも失敗する場合は、表示された最初のerrorとOS、architectureを講師へ共有します。home path、hostname、proxy credentialは共有しません。

`setup`は教材所有のproject-appをloopbackで起動し、`.lab/submissions/13/submission.json`を初回だけ作ります。既存回答は上書きしません。

## 3. actual WebAuthn ceremonyを実行する

```bash
node course.mjs lesson 13 demo
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 13 observe
```

`[PASS]`を確認してから回答を編集します。失敗時は`check`へ進まず、`reasonCode`と`recovery`を解消して同じ`observe`を再実行します。

`demo`はheadless ChromiumへCDP virtual authenticatorを追加し、次を実行してbrowserを必ず終了します。

| 段階 | actual operation | 期待結果 |
| ---: | --- | --- |
| 1 | passwordで既存account sessionを作る | `200`、登録管理用sessionとCSRF token |
| 2 | challengeだけ変えた`create()` | RPはgeneric `422`、RP credential countは`0` |
| 3 | fresh optionで`create()` | `201 CREDENTIAL_REGISTERED` |
| 4 | username-bound optionで`get()` | `allowCredentials`は登録済み1件、認証`200` |
| 5 | 同じtransactionとassertionを再送 | generic `422` |
| 6 | challengeだけ異なるsigned assertion | generic `422` |
| 7 | signatureの1 bitだけ変更 | generic `422` |
| 8 | userHandleの1 byteだけ変更 | generic `422` |
| 9 | foreign RP IDで`get()` | browserがassertion生成前に拒否 |
| 10 | 別localhost portから正しく署名 | RPがorigin不一致としてgeneric `422` |

別origin試験は、同じRP ID `localhost`を使える別portの一時HTTP pageでassertionを作ります。signature、challenge、RP IDは有効なまま、`clientDataJSON.origin`だけがRPの許可originと異なります。一時serverはscenario内で閉じます。

RP ID試験では、現在originのregistrable domain suffixではない`invalid.example`を指定し、browser側のscopingでassertion生成前に拒否されることを確認します。通常RP pathはさらに`expectedRPID: localhost`でauthenticator dataのRP ID hashを検証します。

## 4. runtime evidenceを読む

`.lab/submissions/13/runtime.json`を開きます。raw assertionやcredentialを探すのではなく、固定された結果を確認します。

### browser APIと登録

- `browserAPI.registration`が`navigator.credentials.create`
- `browserAPI.authentication`が`navigator.credentials.get`
- client data typeが`webauthn.create`と`webauthn.get`
- `registration.invalidChallengeStatus`が`422`
- `rpCredentialCountAfterRejectedCeremony`が`0`
- `registration.validStatus`が`201`
- `rpCredentialCountAfterValidCeremony`が`1`
- `attestationFormat`が`none`
- `deviceAttestationSignatureExpected`が`false`

拒否された登録後、virtual authenticator側にはorphan credentialが残る場合があります。RPは検証失敗したcredential IDを保存していないため、端末側を遠隔削除できるとは扱いません。freshな正しい登録をやり直します。

### username-bound認証

- `authentication.mode`が`username-bound`
- `allowCredentialsCount`が`1`
- `successStatus`と`sessionStatus`が`200`
- `signatureVerifiedByRP`と`userVerificationRequired`が`true`

username-boundでは先にaccountを選び、そのaccountのactive credentialだけを`allowCredentials`へ入れます。第14回ではこの制約を外し、discoverable credentialからaccountを解決します。

### 拒否境界

- challenge、origin、signature、replay、userHandleがすべて`422`
- `rpIdBoundary`が`browser-rejected-before-assertion`
- `genericExternalFailure`が`true`

外部bodyは同じ`WEBAUTHN_VERIFICATION_FAILED`です。内部観察では固定reasonを区別しますが、error message、challenge、signatureは保存しません。

### user handleと秘匿

- `userHandle.byteLength`が`64`
- `generation`が`cryptographically-random-per-account`
- `containsPII`が`false`
- `redaction`のpassword、token、challenge、userHandle、credential ID、public key、attestation object、assertion、signature、counterが`omitted`

## 5. 回答ファイルを編集する

`.lab/submissions/13/submission.json`の12個の`TODO`だけを、次の許可値から選んで置き換えます。field名と階層は変えません。

| Check | Field | 許可値 |
| --- | --- | --- |
| `AA13-C1` | `userHandle` | `random-64-byte-account-opaque-value` / `sha256-of-email-is-always-safe` |
| `AA13-C1` | `registrationPersistence` | `store-only-after-verification` / `store-before-verification-for-debugging` |
| `AA13-C1` | `ceremonyAPI` | `create-for-registration-get-for-authentication` / `get-for-registration-create-for-authentication` |
| `AA13-C1` | `attestation` | `none-has-no-device-attestation-signature` / `none-means-skip-all-registration-verification` |
| `AA13-C2` | `challengeOrigin` | `both-bound-and-server-verified` / `browser-only-no-server-check` |
| `AA13-C2` | `rpID` | `browser-scope-and-rp-hash-server-verification` / `rp-id-is-an-unverified-display-name` |
| `AA13-C2` | `assertionSignature` | `verify-with-stored-public-key` / `accept-if-credential-id-exists` |
| `AA13-C2` | `transactionReplay` | `single-use-and-expiring` / `reusable-until-browser-closes` |
| `AA13-C3` | `signCount` | `risk-signal-not-clone-proof` / `definitive-proof-of-cloning` |
| `AA13-C3` | `userHandleCheck` | `compare-to-credential-account` / `trust-returned-userhandle-without-mapping` |
| `AA13-C3` | `failureSurface` | `generic-client-fixed-internal-reason` / `return-cryptographic-reason-to-client` |
| `AA13-C3` | `virtualAuthenticator` | `protocol-test-not-hardware-or-user-gesture-proof` / `proof-of-real-hardware-biometric-and-cloud-sync` |

JSONの値は二重引用符で囲み、最後のfieldの後ろへcommaを付けません。根拠にしたruntime fieldまたは一次仕様を別メモへ1つずつ残します。

## 6. fresh browser scenarioで採点する

```bash
node course.mjs lesson 13 check
```

全required checkが`pass`になるまで、教材processまたはlesson stateを保持します。`fail`の場合は`stop`や`reset`へ進まず、`observe`→回答修正→`check`を繰り返します。

`check`は保存済みruntimeだけを信用せず、別のbrowser、virtual authenticator、scenarioでceremonyを再実行します。

| Check | 合格条件 |
| --- | --- |
| `AA13-C1` | actual API、64-byte random handle、失敗時非保存、成功後保存、attestation noneの説明が一致 |
| `AA13-C2` | username-bound成功とchallenge・origin・RP ID・signature・replay・userHandle境界が一致 |
| `AA13-C3` | signCount、userHandle mapping、generic failure、virtual試験の限界、redactionが一致 |

3件すべてがpassした場合だけ合格です。

## 7. 停止と削除を使い分ける

回答とruntimeを残して停止します。

全required checkの`pass`を確認した後だけ、次の`stop`を実行します。

```bash
node course.mjs lesson 13 stop
```

回答を破棄してやり直す場合だけ、内容を確認してから実行します。

```bash
node course.mjs lesson 13 reset
```

教材が作った全Lessonの回答、runtime、evidence、stateを削除してよい場合だけ次を実行します。`lesson 13 purge`という形式でも範囲はcourse全体で、取り消せません。

```bash
node course.mjs lesson 13 purge --yes --json
```

`purge`後はJSONの`diagnostics[]`内で、`id: "lesson.purge-scope"`の要素が`actual: "course-wide"`、`id: "resources.remaining"`の要素が`actual: "0"`であることを確認します。browser processは各demo/checkの`finally`で閉じるため、残存させません。

## troubleshooting

| 症状 | 確認 | 復旧 |
| --- | --- | --- |
| `PREREQUISITE_PLAYWRIGHT_CHROMIUM` | `npm ci`後にbrowser binaryを入れたか | `npx playwright install chromium`後にdoctor |
| browserが起動しない | 最初のerror、OS、architecture | 組織proxyやLinux libraryを講師・管理者と確認 |
| project-appが起動しない | `node course.mjs lesson 13 diagnose` | owner不明processを手動killしない |
| `demo`がfail | browser更新、source変更、port競合 | diagnoseし、必要ならstopからsetup |
| submission JSON error | 二重引用符、comma、field名 | syntaxだけ直す。回答を残すならresetしない |
| checkが1件だけfail | check IDとruntime section | answer keyを先に写さず根拠へ戻る |

## 参照する一次情報

- [W3C Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/)
- [Chrome DevTools Protocol WebAuthn domain](https://chromedevtools.github.io/devtools-protocol/tot/WebAuthn/)
- [Playwright CDPSession](https://playwright.dev/docs/api/class-cdpsession)
- [Playwright browser installation](https://playwright.dev/docs/browsers)
- [SimpleWebAuthn server documentation](https://simplewebauthn.dev/docs/packages/server)

## 任意の60分発展課題

AA13-C1〜C3の合格後、`extension.yaml`のAA13-X1〜X3へ進めます。WebAuthn RPのproduction境界と運用を設計します。この時間は標準実習1240分に含めません。
