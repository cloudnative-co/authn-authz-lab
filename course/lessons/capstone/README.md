# Capstone: 架空組織の認証認可を2つのtrackで立て直す

このcapstoneは4時間です。過去Lessonのruntimeや回答は読みません。これまで学んだ判断を、同じ架空組織のcaseへまとめて適用します。

学習上の前提はLesson 04、08、09、11、14、15です。これらのruntime stateや回答は不要ですが、application認可、ID基盤、SAML、OIDC、Passkey、OAuth API認可の境界を説明できる状態で始めます。

選ぶtrackは1つです。

| Track | 作るもの | 向いている役割 | 注意点 |
| --- | --- | --- | --- |
| `developer` | deny-by-defaultのpolicy設定、session/federation/API境界、negative test計画 | アプリ・API開発者 | tokenや署名だけで認可完了としない |
| `iam-operations` | JML、緊急失効、recovery、変更管理、検証simulationのrunbook | 情シス・IAM・セキュリティ運用 | 手順の存在だけでなくdeny確認まで含める |

どちらを選んでも、共通の7 checkをすべて満たします。trackで免除される領域はありません。

## 4時間の進め方

| 時間 | 何をするか | 完了条件 |
| --- | --- | --- |
| 0〜60分 | setup、case読解、track選択、責任分界 | 5 observationとownerを説明できる |
| 60〜120分 | credential lifecycle、JML、federation、API、MFA/Passkeyを設計 | 3 Criticalの解消方針が決まる |
| 120〜180分 | 選択trackのpolicyまたはrunbookをJSONへ実装 | 5重大testをすべて`run`にする |
| 180〜240分 | fresh check、修正、講師rubric、再提出 | 自動7 checkと講師rubricの両方を確認する |

## 架空組織Aster Labs

Aster Labsは次を利用しています。

- HR sourceを起点にdirectoryとIdPへidentityを連携する。
- 社内アプリはSAML SPとしてIdPの認証結果を受け取る。
- アプリはlocal sessionを発行し、Resource APIへAccess Tokenを渡す。
- Resource APIはprojectをtenantとobject ownerで認可する必要がある。
- 利用者はTOTPまたはPasskeyを登録できる。

観察された問題は5件です。

1. directoryで無効化済みのleaverが、既存sessionとauthenticatorを使える。
2. SAML SPは署名の存在を見るが、issuer、Audience、Destination、Recipient、InResponseTo、期限、replayを揃えていない。
3. APIはscopeを見るが、tenantとobject ownerを見ない。
4. lost authenticator recoveryの本人再確認が弱い。
5. shared administrator credentialにownerとlifecycleがない。

実在の会社、利用者、credentialは使いません。

## 開始する

必要なのはNode.js 24または26です。Dockerや過去Lessonの起動状態は不要です。

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

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson capstone doctor
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson capstone setup
```

`[PASS]`または`safe-noop`を確認してから`demo`へ進みます。失敗時は`reasonCode`と`recovery`を解消し、同じ`setup`を再実行します。

期待結果は次です。

- `doctor`はNode、lock、state、workspace前提を確認して`pass`になる。
- `setup`は`.lab/submissions/capstone/submission.json`を作る。

## 実行前に予測する

編集前に次をメモします。

1. HR、IAM operations、IdP、SP、application、Resource Serverのどこが何を所有するか。
2. leaver無効化時に、directory account以外の何を失効させるか。
3. signed SAMLResponseでも拒否すべき条件は何か。
4. valid Access Tokenとscopeがあっても拒否すべきrequestは何か。
5. lost Passkey recoveryで、旧credentialとactive sessionをどうするか。
6. 5 riskのうち、最初に解消する3件はどれか。

## demoとobserveを実行する

```bash
node course.mjs lesson capstone demo
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson capstone observe
```

`[PASS]`を確認してから回答を編集します。失敗時は`check`へ進まず、`reasonCode`と`recovery`を解消して同じ`observe`を再実行します。

- `demo`は脆弱な初期caseをdeterministic simulatorへ通し、`runtime.json`へredactedな観察結果だけを保存する。
- `observe`は`runtime.json`の存在と`submission.json`のTODO数を表示する。

このsimulatorは、SAMLやOAuthのlive protocolをもう一度実行するものではありません。各Lessonで確認した境界を、1つのcaseへ統合して判断する教材です。

## submission.jsonを編集する

編集対象は次だけです。

```text
.lab/submissions/capstone/submission.json
```

まず`track`を`developer`または`iam-operations`へ変えます。

全fieldの候補とtrack別の置換規則は[`submission-choices.json`](submission-choices.json)で確認できます。`path`を同じJSON階層へ対応させ、`scalar`は文字列1つ、`exact-array`は配列全体、`array-elements`は`exactLength`個の要素で置き換えます。`unique: true`なら重複させません。`trackRules`に従い、選択側objectだけを編集し、未選択側object全体を`not-selected`へ置き換えます。`choices`の掲載順は正答を示しませんが、回答として作るrunbookや優先順位の配列順は採点対象です。

共通部分では次を設定します。

| Field | 何を決めるか | なぜ必要か |
| --- | --- | --- |
| `responsibilities` | identity source、credential、federation、API、sessionのowner | 失敗時の責任と修正場所を曖昧にしないため |
| `credentialLifecycle` | joiner、mover、leaver、emergency | account無効化だけで残るaccessをなくすため |
| `federation` | 署名とmessage semantics、期限、replay | 別SP・別request・期限外の認証結果を拒否するため |
| `apiAuthorization` | token→scope→tenant→objectの順序とstatus | 認証済みprincipalのobject accessを別に判断するため |
| `mfaPasskey` | enrollment、recovery、lost device、同期境界 | factor追加と復旧をcredential lifecycleに含めるため |
| `risks` / `priorityOrder` | severity、owner、disposition、順番 | Criticalを未解決のまま合格させないため |

`risks`配列は5件を各1回含めれば並び順を問いません。`priorityOrder`は3件のCriticalを2件のHighより前に置きます。同じseverity内は、依存関係がないためどの順でも構いません。Criticalの`disposition`は`resolved`だけが合格です。Highは、対策が完了してriskを閉じたなら`resolved`、riskが残る前提で低減策とownerを維持するなら`mitigated`のどちらも合格です。`accepted`と`unresolved`は、このcaseのHighに必要な対策を示さないため不合格です。

Developer trackでは`artifacts.developer`を残し、`artifacts.iamOperations`を`not-selected`へ置き換えます。policyはdeny-by-defaultにし、5つのnegative testをすべて`run`にします。

IAM operations trackでは`artifacts.developer`を`not-selected`へ置き換えます。JML、緊急失効、recoveryの各runbookは、入力確認だけで終わらず、revoke、deny確認、redacted evidenceまで含めます。5つのsimulationをすべて`run`にします。各runbookは必要stepを1回ずつ含み、次の依存順を守ります。

- JML: authoritative eventを確認してからdirectoryを変更し、変更後にaccessを再計算する。stale session/tokenの失効と再計算を終えてからaccessを検証し、最後にredacted evidenceを記録する。確認後なら、失効をdirectory変更や再計算より先に行うdeny-first順も合格になる。
- 緊急失効: account無効化、session/token失効、authenticator失効、federation blockの4操作はどの順でもよい。4操作をすべて終えてからdenyを検証し、その後にredacted auditを保存する。
- Recovery: strong channelで本人確認してから旧authenticatorとactive sessionを失効する。旧authenticatorを失効してからreplacementを登録し、失効と登録を終えてから通知・監視へ進む。旧authenticator失効とactive session失効の相互順は問わない。

同じstepの重複、必要stepの欠落、`provision-without-source-event`、`retain-old-access`、`wait-for-root-cause-before-revocation`、`knowledge-question-only`を含むrunbookは不合格です。

候補は上記ファイルで確認し、完成例は`check`後に`answer-key.md`で確認します。field名や階層は変えません。

## checkを実行する

```bash
node course.mjs lesson capstone check
```

全required checkが`pass`になるまで、教材processまたはlesson stateを保持します。`fail`の場合は`stop`や`reset`へ進まず、`observe`→回答修正→`check`を繰り返します。

`check`は保存済み`runtime.json`を採点根拠にせず、現在の`submission.json`をfresh simulatorへ渡します。

合格には次のすべてが必要です。

- `AA-CAP-C1`: 責任分界。
- `AA-CAP-C2`: credential lifecycle、JML、session/token/authenticator失効。
- `AA-CAP-C3`: SAML federation受信検証。
- `AA-CAP-C4`: token→scope→tenant→objectのAPI認可。
- `AA-CAP-C5`: MFA/Passkey enrollment、recovery、lost device lifecycle。
- `AA-CAP-C6`: risk owner、優先順位、Critical解消。
- `AA-CAP-C7`: 選択track成果物と全体gate。
- score 80%以上。
- 5重大拒否testのskip 0、failure 0。
- 未解決Critical 0。

全7 checkがrequiredなので、1領域を捨てて80点だけ取ることはできません。

## 自動採点と講師採点を混ぜない

自動採点が判定するのは、JSON構造、選択値、policy順序、simulatorのallow/deny/lifecycle、重大test、score、Critical件数です。

自動採点は、自由記述が妥当かを判定しません。次は講師が`instructor-guide.md`のrubricで採点します。

- なぜそのownerなのか。
- 代替案とtradeoffは何か。
- 運用で残るriskは何か。
- 自組織なら90日で何を変えるか。

runnerが`pass`でも、講師rubricが未実施なら学校・社内研修の修了判定は未完了です。

## 失敗時の確認

```bash
node course.mjs lesson capstone diagnose
```

| 症状 | 原因 | 復旧 |
| --- | --- | --- |
| `SUBMISSION_VALUE_INVALID` | TODOまたは未知値 | fieldを増減せず許可値へ直す |
| `SUBMISSION_TRACK_INVALID` | 2trackが同時選択状態 | 未選択側を`not-selected`にする |
| `AA-CAP-C3` fail | SAML semantic validation不足 | issuerからreplayまでを一組で見直す |
| `AA-CAP-C4` fail | API順序またはtenant/object不足 | token→scope→tenant→objectへ直す |
| `AA-CAP-C6` fail | riskのowner、disposition、severity間の優先順が不整合 | 3 Criticalが2 Highより前か、各riskの完了状態を確認する |
| `AA-CAP-C7` fail | test skip、track設定、runbookの欠落・重複・依存順、または全体gate | runtimeのmetricsとcriticalRejectionsを確認し、選択trackの規則を上から追う |
| JSONを壊した | parse不能 | backupと比較し、必要ならresetする |

回答とruntimeを破棄して最初からやり直す場合だけ実行します。

```bash
node course.mjs lesson capstone reset
```

## 終了と削除

全required checkの`pass`を確認した後だけ、次の`stop`を実行します。

```bash
node course.mjs lesson capstone stop
```

capstoneは外部processを持たないため、`stop`はlesson stateを停止扱いにして`safe-noop`になります。回答は残ります。

教材が作った全Lessonの回答、runtime、evidence、stateを削除してよい場合だけ実行します。`lesson capstone purge`という形式でも削除範囲はcourse全体で、取り消せません。

```bash
node course.mjs lesson capstone purge --yes --json
```

成功時はJSONの`diagnostics[]`内で、`id: "lesson.purge-scope"`の要素が`actual: "course-wide"`、`id: "resources.remaining"`の要素が`actual: "0"`であることを確認します。

## 証跡へ入れないもの

`submission.json`と講師提出物には、実credential、実在個人の識別子、raw token、Cookie、private key、端末の絶対pathを書きません。自組織へ転用するときも、公開可能な抽象化とredacted evidenceを使います。
