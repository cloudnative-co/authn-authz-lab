# Lesson 15: JWT Access Tokenを検証してAPI操作を認可する

実習のみ（1240分）では、準備ラボ完了後にこのガイドを上から進めます。完全コース（1935分）では、対応記事の中でこの実習を一度だけ行い、記事を読み終えた後に[第15回の読解5問](../../reading/lessons/15/README.md)で4問以上を確認します。このガイドは詳細確認に使い、同じcommandを二重実行しません。読解のみ（695分）では実習不要です。

## このLessonでできるようになること

- RFC 8707の`resource`とJWT Access Tokenの`aud`を結び付けて説明できる
- RFC 9068のJWT Access Tokenを、JWKS、RS256、`typ`、必須claimの順に検証できる
- Token検証、scope検証、project-coreのtenant・ownership認可を別の判断として観察できる
- 401 `invalid_token`、403 `insufficient_scope`、project認可の403/404を区別できる

## 前提を準備する

初回はrepository rootの[開始手順](../../../README.md)どおり、次を実行します。

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

Node.jsは24.xまたは26.xです。第04回、第10回、第11回を先に完了することが必須前提です。project認可、OAuth、ID TokenとAccess Tokenの違いを説明でき、各回のrequired checkに合格してから第15回へ進みます。過去Lessonのruntimeや回答を引き継ぐ必要はありません。

## 先に予測する

実行前に、次の4問へ401、403、404、204のどれになるか予測を書きます。

1. 署名が正しくても`typ=JWT`のTokenをAPIへ送る
2. 有効なTokenに`project:delete` scopeだけがない
3. 他テナントのsubjectが`p-100`を削除しようとする
4. `p-100`のownerが正しいTokenで削除する

さらに、どの拒否でproject-coreが呼ばれるかを予測してください。

## 実行する

```bash
node course.mjs lesson 15 doctor
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 15 setup
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 15 demo
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 15 observe
```

`[PASS]`を確認してから回答を編集します。失敗時は`check`へ進まず、`reasonCode`と`recovery`を解消して同じ`observe`を再実行します。

`demo`は所有する1つのprocessで、次の3 originを起動します。

| Origin | 役割 | このLessonで見る処理 |
| --- | --- | --- |
| `http://127.0.0.1:4100` | Authorization Server | Authorization Code + PKCE、`resource`、RS256署名JWT発行、JWKS公開 |
| `http://127.0.0.1:4101` | Client | Tokenの中身を読まずResource APIへ転送 |
| `http://127.0.0.1:4102` | Resource API | JWT検証、scope検証、project-core呼び出し |

手動でも確認する場合は`http://127.0.0.1:4101/start`からLesson 15を選び、ASの画面だけに次を入力します。

- owner用ID: `alice@example.test`
- viewer用ID: `bob@example.test`
- 他テナント用ID: `dave@example.test`
- 共通dummy password: `course-password-for-oauth-lab`

これらは教材専用です。ClientやResource APIには入力しません。

## runtimeの読み方

`.lab/submissions/15/runtime.json`で、次の順序を確認します。

1. Clientが`resource=http://127.0.0.1:4102/projects`を要求する
2. ASが`typ=at+jwt`、`alg=RS256`のJWT Access Tokenを返す
3. Resource APIがJWKSを使い、署名、`typ`、`iss`、`aud`、`exp`、`sub`、`client_id`、`iat`、`jti`、`scope`を検証する
4. `project:delete` scopeを検証する
5. 検証済み`sub`だけをprincipalとしてproject-coreへ渡す
6. project-coreがtenantとownershipを判断する

Tokenなし、不正形式、署名、issuer、audience、期限、type、ID Token混同、必須claim欠損は401です。これらのtraceは`policyEvaluated=false`で、project-coreへ到達しません。

有効Tokenでもscope不足なら403 `insufficient_scope`です。scopeを通過した後、同一テナントのviewerは403、他テナントと未知projectは404、ownerは204です。

## 故障注入の境界

署名不正やclaim欠損は、runnerが作るfresh scenarioだけでASの出力を1条件ずつ変える適合性テストです。通常のブラウザ利用から有効化できるHTTP endpointはありません。ID Token混同ケースも、Token置換を再現するための管理された負例であり、ASの正しい標準動作ではありません。

runtimeへ保存するのは固定origin、method、path、status、reason、検証booleanだけです。Access Token、Authorization Code、PKCE verifier、Cookie、password、秘密鍵、scenario IDは保存しません。

## 回答してfresh checkする

`.lab/submissions/15/submission.json`の`TODO`をruntimeと本文を根拠に置き換えます。

全fieldの候補は[`submission-choices.json`](submission-choices.json)で確認できます。各`path`を`submission.json`の同じ階層へ対応させ、`kind: "scalar"`では`TODO`を`choices`の文字列1つへ置き換えます。候補の順序に意味はなく、このファイルは正誤を示しません。`check`前は`answer-key.md`を開かず、runtimeを根拠に選びます。

```bash
node course.mjs lesson 15 check
```

全required checkが`pass`になるまで、教材processまたはlesson stateを保持します。`fail`の場合は`stop`や`reset`へ進まず、`observe`→回答修正→`check`を繰り返します。

`check`は保存済みruntimeを採点材料にせず、別のfresh scenarioで正常系と拒否系を再実行します。やり直す場合は`reset`、全Lessonのstateを削除してよい場合だけcourse-wideの`purge`を使います。

| Check ID | 合格条件 |
| --- | --- |
| `AA15-C1` | RFC 8707 resource/audience、RFC 9068 JWT Access Token、JWKS検証、Clientのopaque処理が一致する |
| `AA15-C2` | Token不正の401、scope不足の403、ID Token混同拒否、token→scopeの順序が一致する |
| `AA15-C3` | project-coreのtenant・ownership認可、viewer 403、cross-tenant/unknown 404、owner 204が一致する |

AA15-C1〜C3の`pass`を確認した後だけ、次の`stop`を実行します。回答とevidenceは保持されます。

```bash
node course.mjs lesson 15 stop
```

## 実務へ移す

自分のAPIについて、次を1行ずつ埋めてください。

- 信頼するissuerとJWKS URI
- API固有のresource indicator / audience
- 許可する署名algと`typ`
- 必須claimと時刻ずれ許容
- endpointごとの必要scope
- 検証済みsubjectを内部principalへ対応付ける規則
- tenant、ownership、membershipを判断するアプリ側の認可箇所
- Token不正、scope不足、リソース秘匿のHTTP応答

この教材のHTTPはloopback観察用の意図的な省略です。本番ではHTTPS、証明書検証、鍵rotation、JWKS cache更新、監査、可用性設計が必要です。

## 一次仕様

- [RFC 8707 Resource Indicators for OAuth 2.0](https://www.rfc-editor.org/rfc/rfc8707.html)
- [RFC 9068 JSON Web Token (JWT) Profile for OAuth 2.0 Access Tokens](https://www.rfc-editor.org/rfc/rfc9068.html)
- [RFC 6750 The OAuth 2.0 Authorization Framework: Bearer Token Usage](https://www.rfc-editor.org/rfc/rfc6750.html)
- [RFC 9700 Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700.html)

## 任意の60分発展課題

AA15-C1〜C3の合格後、`extension.yaml`のAA15-X1〜X3へ進めます。JWT鍵rotation、緊急失効、BOLA面の拡張を設計します。この時間は標準実習1240分に含めません。
