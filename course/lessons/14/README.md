# 第14回 discoverable credentialから失効と復旧まで追跡する

実習のみ（1240分）では、準備ラボ完了後にこのガイドを上から進めます。完全コース（1935分）では、対応記事の中でこの実習を一度だけ行い、記事を読み終えた後に[第14回の読解5問](../../reading/lessons/14/README.md)で4問以上を確認します。このガイドは詳細確認に使い、同じcommandを二重実行しません。読解のみ（695分）では実習不要です。

この演習では、2つのCDP virtual authenticatorへ同じaccountのcredentialを登録します。usernameを先に入力しない認証、RP側のcredential失効、第二credentialによる復旧、BE/BS flags、account disableとsession invalidationをactual `navigator.credentials.create()`と`navigator.credentials.get()`で追跡します。所要時間の目安は90分です。

## この回でできるようになること

- discoverable credentialでusername入力前にaccountを識別・認証する流れを説明する
- RPのcredential recordとauthenticatorのprivate credentialを別のstateとして扱う
- 1本を失効しても別のcredentialで復旧できる登録・回復設計を作る
- BE（backup eligibility）とBS（backup state）を区別する
- virtual flagsを実cloud同期や別端末移行の証拠として扱わない
- account disable時にcredentialだけでなく既存sessionも失効させる

## usernameなし認証の流れ

```text
RP: challengeとRP IDを返す
    allowCredentialsは空または省略
            |
            v
browser / authenticator:
    RP IDにscopedなdiscoverable credentialを選ぶ
    userHandleをassertionと一緒に返す
            |
            v
RP:
    credential IDとuserHandleからaccount mappingを照合
    challenge、origin、RP ID、UV、signatureを検証
    account/credentialがactiveならsessionを発行
```

usernameを消す代わりにaccount mappingを省略するわけではありません。RPは返されたcredential IDを保存済みrecordへ対応づけ、そのrecordのaccount handleと返されたuserHandleを比較します。

## 失効する場所を分ける

RP管理画面でcredentialを失効すると、RPのrecordは`active=false`になります。端末やsecurity keyにあるprivate credentialをRPが一般に遠隔削除できるわけではありません。

そのため、失効後もauthenticatorはassertionを作れる場合があります。RPはactive recordがないため、そのassertionをgenericに拒否します。この教材はCDPの`getCredentials`で、RP失効前後のauthenticator credential countが変わらないことを確認します。

## BEとBS

- BE（Backup Eligibility）: credentialがbackup可能として作られたかを表すcredential property
- BS（Backup State）: 現在backup済みとauthenticatorが報告しているstate

教材の第二virtual authenticatorはBEとBSを`true`にします。これはRPがflagsをparseし保存できることのtest fixtureです。実際のcloud provider、暗号化、end-to-end protection、同期成功、別端末での利用、account recoveryを証明しません。

## 前提を準備する

repository rootで実行します。第13回と同じbrowser prerequisiteがあります。

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

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 14 doctor
```

`[PASS]`を確認してから次へ進みます。`[BLOCKED]`または`[FAIL]`なら`reasonCode`と`recovery`を解消し、同じ`doctor`を再実行します。

Node.jsは24.xです。`npm ci`とChromium installationは別の手順です。教材はbrowserを暗黙downloadしません。

学習上は第03回のsessionと第13回のWebAuthnが前提ですが、それらのruntime stateは不要です。固定の教材accountだけを使い、実credentialや実利用者情報を入力しません。

## 1. 実行前に予測する

まだ[`answer-key.md`](answer-key.md)を開かず、次をメモします。

1. `allowCredentials`を空にすると、RPはどのfieldでaccountを解決するか
2. RPでcredentialを失効すると、authenticatorのprivate credentialも消えるか
3. 一つしかcredentialがない状態で端末を失った場合、どう復旧するか
4. BE/BSがtrueなら、実cloud同期と別端末利用を証明できるか
5. signCountが0のままなら、credential cloneを証明できるか
6. accountをdisableしたあと、既存sessionと新しいassertionをどう扱うか

## 2. 診断してworkspaceを作る

```bash
node course.mjs lesson 14 doctor
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 14 setup
```

`[PASS]`または`safe-noop`を確認してから`demo`へ進みます。失敗時は`reasonCode`と`recovery`を解消し、同じ`setup`を再実行します。

`doctor`はChromiumを起動して閉じ、CDP実習を開始できるか確認します。失敗した場合は第13回と同じく`PREREQUISITE_PLAYWRIGHT_CHROMIUM`のrecoveryを先に実行します。

`setup`はproject-appを起動し、`.lab/submissions/14/submission.json`を初回だけ作ります。

## 3. 2つのauthenticatorでlifecycleを実行する

```bash
node course.mjs lesson 14 demo
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 14 observe
```

`[PASS]`を確認してから回答を編集します。失敗時は`check`へ進まず、`reasonCode`と`recovery`を解消して同じ`observe`を再実行します。

`demo`は同じbrowser process内に2つの独立contextを作り、それぞれへ1つのvirtual authenticatorを割り当てます。

| 段階 | 操作 | 期待結果 |
| ---: | --- | --- |
| 1 | authenticator 1へcredential登録 | RPとauthenticatorに1件 |
| 2 | usernameなし`get()` | `allowCredentials`空、userHandleを検証し`200` |
| 3 | authenticator 2へ第二credential登録 | 同じaccountへ独立credentialを追加 |
| 4 | credential 1をRPで失効 | RP recordはinactive、authenticator 1は1件保持 |
| 5 | authenticator 1で再認証 | assertionは作られるがRPがgeneric `422` |
| 6 | authenticator 2で再認証 | `200`、accessを復旧 |
| 7 | BE/BSを観察 | 第二credentialで両方true、cloud同期証明はfalse |
| 8 | account disable | 既存sessionは`401`、新しいassertionは`422` |

第二credentialは、最初のcredentialを失う前に登録してあります。すべてを失った後のhelpdesk recoveryを自動的に安全にするものではありません。

## 4. runtime evidenceを読む

`.lab/submissions/14/runtime.json`を開きます。

### discoverable login

- `allowCredentialsOmitted`が`true`
- `usernameSupplied`が`false`
- `authenticationStatus`と`sessionStatus`が`200`
- `returnedUserHandleVerified`が`true`

authenticator UIでaccountを選ぶ実体験はvirtual fixtureでは再現しません。protocolとしてempty `allowCredentials`とreturned userHandleを検証します。

### RP revocation

- `rpStatus`が`200`
- `privateCredentialRemovedByRP`が`false`
- authenticator credential countのbeforeとafterが同じ
- `revokedAssertionStatus`が`422`

「RPから消した」と「端末から消えた」を同じ意味にしないでください。RPは失効recordまたはtombstoneを保持し、再提示を拒否できる必要があります。

### 第二credentialとbackup flags

- `secondCredentialRegistered`が`true`
- recovery authenticationとsessionが`200`
- `deviceType`が`multiDevice`
- `backupEligibleFlagObserved`と`backupStateFlagObserved`が`true`
- `cloudSyncProven`が`false`

CDP flagsはtest inputです。vendorの実同期を評価するには、対象platform、provider account、encryption、別端末、recovery、退職・紛失時の操作を別に試験します。

### account lifecycle

- `disableStatus`が`200`
- `existingSessionAfterDisableStatus`が`401`
- `newAssertionAfterDisableStatus`が`422`
- `sessionsRemaining`が`0`

credentialが暗号学的に有効でも、account policyがdisabledならapplication accessを許可しません。既存sessionも同時に失効させます。

### evidence boundary

`redaction`でpassword、session/CSRF token、challenge、user handle、credential ID、public key、attestation object、assertion、signature、counterがすべて`omitted`であることを確認します。

## 5. 回答ファイルを編集する

`.lab/submissions/14/submission.json`の8個の`TODO`だけを置き換えます。

| Check | Field | 許可値 |
| --- | --- | --- |
| `AA14-C1` | `discoverableCredential` | `empty-allowcredentials-and-returned-userhandle` / `username-is-embedded-in-rp-id` |
| `AA14-C1` | `usernameTiming` | `not-required-before-credential-selection` / `always-required-before-navigator-credentials-get` |
| `AA14-C1` | `rpRevocation` | `disable-rp-record-private-credential-remains` / `rp-deletes-private-key-from-every-authenticator` |
| `AA14-C1` | `recovery` | `second-independent-credential-restores-access` / `one-credential-is-enough-without-recovery` |
| `AA14-C2` | `backupFlags` | `be-is-eligibility-bs-is-current-backup-state` / `be-and-bs-prove-which-cloud-provider-synced-it` |
| `AA14-C2` | `cloudSyncEvidence` | `virtual-flags-do-not-prove-real-sync` / `cdp-backup-flags-prove-end-to-end-cloud-sync` |
| `AA14-C2` | `accountDisable` | `invalidate-sessions-and-reject-new-assertions` / `existing-sessions-remain-valid-after-account-disable` |
| `AA14-C2` | `signCount` | `risk-signal-not-clone-proof` / `zero-counter-means-cloned-passkey` |

field名、階層、`schemaVersion`、`lessonId`は変えません。JSONの最後のfieldへcommaを付けません。

## 6. fresh scenarioで採点する

```bash
node course.mjs lesson 14 check
```

全required checkが`pass`になるまで、教材processまたはlesson stateを保持します。`fail`の場合は`stop`や`reset`へ進まず、`observe`→回答修正→`check`を繰り返します。

| Check | 合格条件 |
| --- | --- |
| `AA14-C1` | usernameなし認証、userHandle mapping、RP失効、private credential残存、第二credential復旧が一致 |
| `AA14-C2` | BE/BS、cloud同期非証明、account/session失効、signCount、redactionが一致 |

2件ともpassした場合だけ合格です。`check`は2つの新しいbrowser contextとvirtual authenticatorで再実行します。

## 7. 停止、やり直し、削除

全required checkの`pass`を確認した後だけ、次の`stop`を実行します。

```bash
node course.mjs lesson 14 stop
```

回答を破棄してやり直す場合だけ実行します。

```bash
node course.mjs lesson 14 reset
```

教材が作った全Lessonの回答、runtime、evidence、stateを削除してよい場合だけ実行します。`lesson 14 purge`という形式でも範囲はcourse全体で、取り消せません。

```bash
node course.mjs lesson 14 purge --yes --json
```

JSONの`diagnostics[]`内で、`id: "lesson.purge-scope"`の要素が`actual: "course-wide"`、`id: "resources.remaining"`の要素が`actual: "0"`であることを確認します。

## 実務の復旧設計で追加するもの

このlabの「第二credential」は最小の復旧手段です。productionでは次を設計します。

- 最初のcredentialを失う前に複数credentialを登録できる導線
- 端末・security keyの名前、最終利用、失効、通知
- account recoveryの本人確認、複数承認、待機時間、監査
- recovery後の全credential reviewと既存session失効
- 退職・異動・端末返却とIdP/account lifecycleの連動
- platformを利用できない利用者へのaccessibilityと代替手段
- synced credential providerの組織policyとprivate/managed account境界

## troubleshooting

| 症状 | 確認 | 復旧 |
| --- | --- | --- |
| Chromium prerequisite fail | browser binaryと起動error | `npx playwright install chromium`、管理者確認 |
| 第二登録がfail | 第13回sourceとlockの整合 | `npm ci`、doctor、必要ならreset |
| revoked assertionが通る | RP active stateとfresh scenario | 実装変更を中止し、testをfailのまま調査 |
| sessionがdisable後も通る | session generationとaccount state | thresholdを緩めず実装を修正 |
| JSON error | quote、comma、field名 | syntaxを直す。回答保持ならresetしない |

## 参照する一次情報

- [W3C Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/)
- [Chrome DevTools Protocol WebAuthn domain](https://chromedevtools.github.io/devtools-protocol/tot/WebAuthn/)
- [Playwright CDPSession](https://playwright.dev/docs/api/class-cdpsession)
- [Playwright browser installation](https://playwright.dev/docs/browsers)
- [SimpleWebAuthn server documentation](https://simplewebauthn.dev/docs/packages/server)

## 任意の45分発展課題

AA14-C1とC2の合格後、`extension.yaml`のAA14-X1〜X3へ進めます。Passkey導入、全喪失recovery、退職時失効を設計します。この時間は標準実習1240分に含めません。
