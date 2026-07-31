# Lesson 11: OpenID Connectでログインを成立させる

実習のみ（1240分）では、準備ラボ完了後にこのガイドを上から進めます。完全コース（1935分）では、対応記事の中でこの実習を一度だけ行い、記事を読み終えた後に[第11回の読解5問](../../reading/lessons/11/README.md)で4問以上を確認します。このガイドは詳細確認に使い、同じcommandを二重実行しません。読解のみ（695分）では実習不要です。

## このLessonでできるようになること

- OAuthのaccess tokenとOIDCのID Tokenの役割を混同せず説明できる
- discoveryとJWKSを取得し、署名、issuer、audience、時刻、nonceを検証する順序を説明できる
- RPが検証する`sub`の形式とissuerが保証する識別子契約を分け、複数issuerでは`(iss, sub)`をaccount keyにできる

ID TokenはJWTです。このLessonはRS256で署名したJWSを使い、暗号化JWEは扱いません。

## 前提を準備する

初めてこのrepositoryを使う場合は、rootの[開始手順](../../../README.md)に従い、次を先に完了します。

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

Node.jsは24.xまたは26.xです。学習上は第03回のsessionと第10回のOAuthを前提にしますが、過去回のruntimeや回答は引き継ぎません。必須の自動実習と`check`はNode.jsだけで完了し、ブラウザ操作は任意の追加観察です。

## 先に予測する

1. ID Tokenはbrowser callbackとback-channel token responseのどちらへ届くか
2. 署名が正しければissuerやaudienceが違っても受理できるか
3. access tokenをID Token欄へ入れたらログインできるか
4. email、`sub`単体、`(iss, sub)`のどれを複数issuer対応のaccount keyにするか

## 実行する

```bash
node course.mjs lesson 11 doctor
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 11 setup
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 11 demo
```

`[PASS]`を確認してから`observe`へ進みます。失敗時は`reasonCode`と`recovery`を解消し、同じ`demo`を再実行します。

### 任意: browserでfront-channelを追加観察する

この操作はrequired checkには含まれません。browserを使わない場合は、そのまま「拒否と証拠を読む」へ進めます。

ブラウザで `http://127.0.0.1:4101/start` を開き、Lesson 11を選びます。OPの`http://127.0.0.1:4100`からcallbackへ戻った後、RPがdiscoveryとJWKSをHTTP取得し、検証済みID Tokenからapp sessionを発行して`/me`へ移る流れを追います。Resource APIのoriginは`http://127.0.0.1:4102`です。

- 教材用ID: `learner@example.test`
- 教材用password: `course-password-for-oauth-lab`

このdummy credentialは教材専用です。`http://127.0.0.1:4100`のOPログイン画面にだけ入力し、RPや他サービスでは使わないでください。

## 拒否と証拠を読む

```bash
node course.mjs lesson 11 observe
```

`[PASS]`を確認してから回答を編集します。失敗時は`check`へ進まず、`reasonCode`と`recovery`を解消して同じ`observe`を再実行します。

`.lab/submissions/11/runtime.json`で、signature、issuer、audience、expiry、nonce、access-token confusionがすべて通常callbackで400になったことを確認します。証拠にID Token、access token、nonce、state、code、cookie、keyが現れてはいけません。

## 回答してfresh checkする

`.lab/submissions/11/submission.json`を埋めます。

全fieldの候補は[`submission-choices.json`](submission-choices.json)で確認できます。各`path`を`submission.json`の同じ階層へ対応させ、`kind: "scalar"`では`TODO`を`choices`の文字列1つへ置き換えます。候補の順序に意味はなく、このファイルは正誤を示しません。`check`前は`answer-key.md`を開かず、runtimeを根拠に選びます。

```bash
node course.mjs lesson 11 check
```

全required checkが`pass`になるまで、教材processまたはlesson stateを保持します。`fail`の場合は`stop`や`reset`へ進まず、`observe`→回答修正→`check`を繰り返します。

`check`はfresh scenarioを再実行します。やり直す場合は`reset`、全Lessonのstateを削除してよい場合だけcourse-wideの`purge`を使います。

| Check ID | 合格条件 |
| --- | --- |
| `AA11-C1` | Discovery、JWKS、back-channel ID Token、全条件検証後だけのapp sessionがruntime・回答で一致する |
| `AA11-C2` | `sub`の非空・255文字以下検査、issuer contract、`(iss, sub)` key、emailの属性境界、Access Tokenとの用途差、六つの一条件拒否がruntime・回答で一致する |

AA11-C1とAA11-C2の`pass`を確認した後だけ、次の`stop`を実行します。回答とevidenceは保持されます。

```bash
node course.mjs lesson 11 stop
```

環境またはcheckで止まったら、手作業でprocessや`.lab`を消さずに診断します。

```bash
node course.mjs lesson 11 diagnose
```

表示された`reasonCode`と`recovery`を確認して原因を直し、失敗したcommandを再実行します。回答とLesson 11のstateを破棄する場合だけ`node course.mjs lesson 11 reset`、通常終了は`node course.mjs lesson 11 stop`、course全体のstateとevidenceを削除する場合だけ`node course.mjs purge --yes --json`を使います。

## 実務へ移す

管理対象のRPについて、固定issuer、discovery issuer一致、JWKS取得元、algorithm allowlist、audience、時刻、nonce、`sub`の入力検査、issuerのsubject契約、`(iss, sub)`の保存キー、email更新、session cookie、HTTPSと`Secure`を確認してください。access tokenをログイン証明にしていないことも明記します。

## 任意の60分発展課題

AA11-C1とC2の合格後、`extension.yaml`のAA11-X1〜X3へ進めます。account linking、key rotation、OIDC sessionの運用を設計します。この時間は標準実習1240分に含めません。
