# Lesson 10: OAuth 2.0でAPIアクセスを委譲する

実習のみ（1240分）では、準備ラボ完了後にこのガイドを上から進めます。完全コース（1935分）では、対応記事の中でこの実習を一度だけ行い、記事を読み終えた後に[第10回の読解5問](../../reading/lessons/10/README.md)で4問以上を確認します。このガイドは詳細確認に使い、同じcommandを二重実行しません。読解のみ（695分）では実習不要です。

## このLessonでできるようになること

- Authorization Code + PKCE S256で、Clientがパスワードを受け取らずAPI権限を得る流れを説明できる
- state、code、PKCE verifierがそれぞれ何を守り、どこで一度だけ使われるか確認できる
- Bearerの401とscope不足の403を区別し、opaque tokenをintrospectionで検証できる

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

Node.jsは24.xです。学習上は第01回の責任境界を前提にします。`course.mjs setup`まで成功していれば、過去Lessonのruntimeや回答は不要です。必須の自動実習と`check`はNode.jsだけで完了し、ブラウザ操作は任意の追加観察です。

## 先に予測する

実行前に次を紙へ書いてください。

1. パスワードを入力するoriginは三つのうちどれか
2. callbackのstateを変えたとき、Token Endpointへ進むか
3. 正しいcodeと誤ったverifierを送った後、同じcodeを再利用できるか
4. activeなtokenに`project:read`がないとき、401と403のどちらか

## 実行する

```bash
node course.mjs lesson 10 doctor
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 10 setup
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 10 demo
```

`[PASS]`を確認してから`observe`へ進みます。失敗時は`reasonCode`と`recovery`を解消し、同じ`demo`を再実行します。

### 任意: browserでfront-channelを追加観察する

この操作はrequired checkには含まれません。browserを使わない場合は、そのまま「拒否と証拠を読む」へ進めます。

ブラウザで `http://127.0.0.1:4101/start` を開き、Lesson 10を選びます。ログイン画面のアドレスが `:4100`、最初のClientが`:4101`、APIが`:4102`であることを確認してください。

- 教材用ID: `learner@example.test`
- 教材用password: `course-password-for-oauth-lab`

このdummy credentialは教材専用です。`http://127.0.0.1:4100`のASログイン画面にだけ入力し、Client、Resource API、他サービスでは使わないでください。

## 拒否と証拠を読む

```bash
node course.mjs lesson 10 observe
```

`[PASS]`を確認してから回答を編集します。失敗時は`check`へ進まず、`reasonCode`と`recovery`を解消して同じ`observe`を再実行します。

`.lab/submissions/10/runtime.json` では次だけを確認します。

- 三originとmethod/path/status
- state mismatch、PKCE mismatch、code replay、未登録redirect URIの固定reason
- missing/invalid Bearerの401 challengeとscope不足の403
- token値を含まないintrospection結果の検証boolean

code、state、verifier、token、cookie、passwordが見えた場合は正常な教材証拠ではありません。

## 回答してfresh checkする

`.lab/submissions/10/submission.json` の`TODO`を、runtimeとこのREADMEを根拠に許可値へ置き換えます。

全fieldの候補は[`submission-choices.json`](submission-choices.json)で確認できます。各`path`を`submission.json`の同じ階層へ対応させ、`kind: "scalar"`では`TODO`を`choices`の文字列1つへ置き換えます。候補の順序に意味はなく、このファイルは正誤を示しません。`check`前は`answer-key.md`を開かず、runtimeを根拠に選びます。

```bash
node course.mjs lesson 10 check
```

全required checkが`pass`になるまで、教材processまたはlesson stateを保持します。`fail`の場合は`stop`や`reset`へ進まず、`observe`→回答修正→`check`を繰り返します。

`check`は保存済みruntimeを信用せず、freshな実HTTP scenarioを再実行します。やり直す場合は`reset`、全Lessonのstateを削除してよい場合だけcourse-wideの`purge`を使います。

| Check ID | 合格条件 |
| --- | --- |
| `AA10-C1` | Authorization Code + PKCE、public Client、state/codeの一回性、opaque Access Tokenとintrospectionがruntime・回答で一致する |
| `AA10-C2` | Bearer不正の401、scope不足の403、passwordのAS限定、loopback HTTPのtraining境界がruntime・回答で一致する |

AA10-C1とAA10-C2の`pass`を確認した後だけ、次の`stop`を実行します。回答とevidenceは保持されます。

```bash
node course.mjs lesson 10 stop
```

環境またはcheckで止まったら、手作業でprocessや`.lab`を消さずに診断します。

```bash
node course.mjs lesson 10 diagnose
```

表示された`reasonCode`と`recovery`を確認して原因を直し、失敗したcommandを再実行します。回答とLesson 10のstateを破棄する場合だけ`node course.mjs lesson 10 reset`、通常終了は`node course.mjs lesson 10 stop`、course全体のstateとevidenceを削除する場合だけ`node course.mjs purge --yes --json`を使います。

## 実務へ移す

管理対象のClientについて、登録redirect URI、public/confidential区分、PKCE S256、state保存・期限・消費、scope設計、Bearer challenge、introspection認証、token/log秘匿、HTTPSを一行ずつ確認してください。

## 任意の60分発展課題

AA10-C1とC2の合格後、`extension.yaml`のAA10-X1〜X3へ進めます。scope、token失効、sender constraintの運用を設計します。この時間は標準実習1240分に含めません。
