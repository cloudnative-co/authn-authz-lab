# 第05回 Basic認証のchallengeと毎リクエスト認証を追跡する

実習のみ（1240分）では、準備ラボ完了後にこのガイドを上から進めます。完全コース（1935分）では、対応記事の中でこの実習を一度だけ行い、記事を読み終えた後に[第05回の読解5問](../../reading/lessons/05/README.md)で4問以上を確認します。このガイドは詳細確認に使い、同じcommandを二重実行しません。読解のみ（695分）では実習不要です。

この演習では、RFC 7617のBasic認証を実HTTPで動かします。`401`のchallenge、`Authorization`ヘッダー、成功後にsessionを作らないこと、次のrequestでも資格情報が必要なことを順に確認します。所要時間の目安は60分です。

## この回でできるようになること

- `401`と`WWW-Authenticate`を、Basic認証を要求する1つの応答として読める
- `user-id:password`、UTF-8、NFC、Base64の役割を順番に説明できる
- Basic認証とsession認証を、毎requestの入力とserver-side stateの有無で区別できる
- TLS、log、共有ID、rotation、MFA、SSOの要件から採否を判断できる

## この回の中心モデル

```text
資格情報なし
  GET /api/lessons/05/basic/me
  <- 401 + WWW-Authenticate: Basic realm="lesson-05", charset="UTF-8"

資格情報あり
  GET /api/lessons/05/basic/me
  Authorization: Basic <Base64(UTF-8 NFC user-id:password)>
  <- 200 BASIC_AUTHENTICATED

次のrequestで資格情報なし
  GET /api/lessons/05/basic/me
  <- 401 + 同じchallenge
```

成功応答に`Set-Cookie`はありません。成功後のrequestから`Authorization`を外すと再び`401`になります。Basic認証は、最初の成功からsessionを作る方式ではありません。

## 実装の範囲

この回の実装と検証箇所は次のとおりです。

- [`basic-auth-service.mjs`](../../../apps/project-app/lessons/05/basic-auth-service.mjs): Basic資格情報のparse、challenge、毎requestの認証、証跡のredaction
- [`http-handler.mjs`](../../../apps/project-app/lessons/05/http-handler.mjs): `/api/lessons/05/basic/me`の実HTTP応答
- [`scenario.mjs`](scenario.mjs): 401、401、200、成功後の401をfresh scenarioで再現
- [`assessment.mjs`](assessment.mjs): `AA05-C1`と`AA05-C2`の採点契約

教材のHTTP serverは`127.0.0.1`だけで待ち受けます。演習では通信内容を観察しやすくするためloopback HTTPを使いますが、これは**教材上の差異**です。本番でBasic認証を使う場合はTLS、つまりHTTPSを必須にしてください。

## RFC 7617で押さえる4点

### `401`とchallengeは一組

資格情報がない、または受け入れられない場合、教材は次を返します。

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Basic realm="lesson-05", charset="UTF-8"
```

`realm`は表示用ラベルだけではありません。originとrealmの組はprotection spaceを定め、clientが同じ資格情報を自動適用できる範囲に関わります。RFC 7617は、pathから得るauthentication scope内で資格情報を再利用できることも定めています。どのくらい保持するかはclientと利用者設定にも依存するため、「tabを閉じれば必ずlogoutできる」とは扱いません。

### Base64は暗号化ではない

Base64はbyte列をUS-ASCII文字で表すencodingです。鍵を使わず元へ戻せます。盗聴からpasswordを守るのはBase64ではなくTLSです。

### `charset="UTF-8"`はUTF-8とNFCを期待する合図

RFC 7617の`charset` parameterで許される値は`UTF-8`だけです。このparameterはclientへのadvisoryであり、教材はUTF-8へencodeする前にuser-idとpasswordをUnicode NFCへ正規化します。

### 最初のcolonが境界

資格情報は`user-id`、1文字の`:`、passwordを連結して作ります。user-idにcolonは使えません。最初のcolonより後ろはpasswordなので、password内のcolonは扱えます。user-idとpasswordのcontrol characterは拒否します。

教材parserはさらに、paddingを含むcanonical Base64、fatalなUTF-8 decode、header長、user-id長、password長を検査します。これらの上限とcanonical表現の強制は教材実装の防御であり、Basic認証を使う全製品の共通値ではありません。

## 前提

リポジトリのルートで次が成功している必要があります。

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

Node.jsは24.xまたは26.xです。第01回の責任境界を理解していることを学習上の前提にしますが、第01〜04回のruntime stateは不要です。

この演習へ実在する組織、個人、ほかのserviceで使うpasswordを入力しないでください。demoは教材内の固定accountだけを使います。

## 1. 実行前に予測する

次の答えを自分のメモへ書きます。まだ[`answer-key.md`](answer-key.md)は開きません。

1. 1回成功した後、次のrequestから`Authorization`を外すと`200`と`401`のどちらになるか
2. 成功応答に`Set-Cookie`があるか
3. 資格情報なしと誤passwordで、challengeと外部messageを変えるべきか
4. loopback HTTPで成功したことは、本番HTTPを許可する根拠になるか

## 2. 診断して準備する

```bash
node course.mjs lesson 05 doctor
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 05 setup
```

`[PASS]`または`safe-noop`を確認してから`demo`へ進みます。失敗時は`reasonCode`と`recovery`を解消し、同じ`setup`を再実行します。

`doctor`はcourse state、対応環境、教材契約を確認します。`setup`は回答用の`.lab/submissions/05/submission.json`を初回だけ作り、教材所有のproject-appを準備します。既存の回答は上書きしません。

`[BLOCKED]`または`[FAIL]`になった場合は、表示された`reasonCode`と`recovery`を先に読みます。`.lab`を手作業で消したり、portを使う所有者不明processを停止したりしません。

## 3. challenge-responseを実行する

```bash
node course.mjs lesson 05 demo
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 05 observe
```

`[PASS]`を確認してから回答を編集します。失敗時は`check`へ進まず、`reasonCode`と`recovery`を解消して同じ`observe`を再実行します。

`demo`はfresh scenario内で次の4 requestを有限実行して終了します。

| 順番 | 入力 | 期待する外部結果 |
| ---: | --- | --- |
| 1 | `Authorization`なし | `401`、Basic challengeあり |
| 2 | 正しいuser-idと誤password | 1と同じ`401`、challenge、body |
| 3 | 正しい資格情報 | `200 BASIC_AUTHENTICATED`、challengeなし、`Set-Cookie`なし |
| 4 | 成功後に`Authorization`なし | 再び1と同じ`401` |

`observe`では次を確認します。

- `challenge.header`が`Basic realm="lesson-05", charset="UTF-8"`
- failureのheaderとbodyがすべて同じ
- `success.status`が`200`、`setCookieAbsent`が`true`
- `nextRequestWithoutHeaderStatus`が`401`
- `credentialEncoding`がUTF-8、NFC、`user-id:password`、canonical Base64を示す
- `authenticatesEveryRequest`が`true`、`sessionIssuance`が`false`
- `transportContext`がloopback HTTPの教材上の差異、`productionRequirement`がTLS必須
- `Authorization` header、user-id、password、decode後の値がobservationへ残っていない

`demo`が保存したruntimeは学習用です。`check`はこの保存済みfileを信用せず、隔離した新しいscenarioで同じ交換を再実行します。

## 4. 回答ファイルを手で編集する

`.lab/submissions/05/submission.json`をtext editorで開き、8個の`TODO`だけを次の許可値から選んで置き換えます。field名、階層、`schemaVersion`、`lessonId`は変更しません。

| Check | Field | 許可値 |
| --- | --- | --- |
| `AA05-C1` | `challenge` | `401-with-basic-realm-and-utf8` / `401-without-www-authenticate` |
| `AA05-C1` | `credentialConstruction` | `base64-of-utf8-nfc-user-colon-password` / `password-hash-in-authorization-header` |
| `AA05-C1` | `success` | `200-without-session` / `200-and-session-cookie` |
| `AA05-C1` | `requestReuse` | `authorization-required-on-every-request` / `first-request-creates-login-session` |
| `AA05-C2` | `transport` | `tls-required-loopback-http-training-only` / `plain-http-approved-for-production` |
| `AA05-C2` | `base64Security` | `encoding-not-encryption` / `encryption-protects-the-password` |
| `AA05-C2` | `logging` | `omit-header-and-decoded-credentials` / `log-decoded-user-pass-for-debugging` |
| `AA05-C2` | `adoption` | `narrow-controlled-use-only` / `default-choice-for-browser-sso-and-mfa` |

JSONの文字列は二重引用符で囲みます。最後のfieldの後ろへcommaを追加しません。各回答について、根拠にした`observe`のfieldを自分のメモへ1行残してください。

## 5. fresh scenarioで採点する

```bash
node course.mjs lesson 05 check
```

全required checkが`pass`になるまで、教材processまたはlesson stateを保持します。`fail`の場合は`stop`や`reset`へ進まず、`observe`→回答修正→`check`を繰り返します。

| Check | 合格条件 |
| --- | --- |
| `AA05-C1` | 401 challenge、UTF-8/NFCの資格情報構築、200、sessionなし、毎request認証がruntimeと回答の両方で一致する |
| `AA05-C2` | TLS必須、Base64はencoding、secret非記録、限定採用がruntimeと回答の両方で一致する |

2件ともpassした場合だけ合格です。failした場合はcheck IDを見て、`AA05-C1`ならHTTP交換、`AA05-C2`なら安全境界と採否の説明へ戻ります。

## 6. 実装が拒否する範囲を理解する

通常のdemoは、資格情報なし、誤password、成功を観察します。実装testではさらに次も確認しています。

- malformed Base64、non-canonical Base64、invalid UTF-8、control character、colonのない値を拒否する
- missing、malformed、未知user、誤passwordを同じ`401` challengeへまとめる
- backendのrate limitは`429`、一時的な容量不足は`503`のまま`Retry-After`を返し、誤って認証失敗の`401`へ変えない

`429`と`503`は「別の資格情報を出せばよい」というchallengeではありません。一時的な状態として、clientへ待ち時間を伝えます。

## 7. 実務へ移す

Basic認証を見つけたendpointごとに、次を別々に確認します。不明な項目は推測せず「未確認」と書きます。

| 確認項目 | 確認する内容 |
| --- | --- |
| transport | HTTPをHTTPSへredirectするだけでなく、資格情報を送る全経路がTLSか |
| log | proxy、APM、debug、error reportへ`Authorization`やdecode値が残らないか |
| identity | 個人を識別できるIDか、複数人の共有IDか |
| lifecycle | 発行者、保存場所、rotation、異動・退職時の失効責任が決まっているか |
| user experience | 明示的logout、共有端末、password変更時の挙動を検証したか |
| stronger authentication | MFA、SSO、phishing-resistant authenticationが要件なら別方式を選んでいるか |

Basic認証は、TLSとsecret管理があり、利用者と用途が狭く、MFA・SSO・細かなsession制御が要件でない場合に限って検討します。「内部だから」「一時的だから」だけでは採用理由になりません。

## 終了、やり直し、完全削除

回答とevidenceを残し、教材所有processだけ止めます。

全required checkの`pass`を確認した後だけ、次の`stop`を実行します。

```bash
node course.mjs lesson 05 stop
```

第05回の回答を破棄して最初からやり直す場合だけresetします。

```bash
node course.mjs lesson 05 reset
```

教材が作った全lessonの回答、evidence、stateを削除してよい場合だけpurgeします。lesson形式で実行しても範囲はcourse全体です。

```bash
node course.mjs lesson 05 purge --yes --json
```

purgeは取り消せません。成功時はJSONの`diagnostics[]`内で、`id: "lesson.purge-scope"`の要素が`actual: "course-wide"`、`id: "resources.remaining"`の要素が`actual: "0"`であることを確認します。

## 困ったとき

| 状況 | 確認 | 対応 |
| --- | --- | --- |
| `PREREQUISITE_SETUP` | course共通setupが未完了 | `node course.mjs setup`を実行する |
| `TODO`または未知値でfail | 8 fieldと許可値 | templateと比較して`TODO`だけ直す |
| JSON parse error | quote、comma、brace | editorで構文を直す。破棄合意がある場合だけresetする |
| project-appを起動できない | reason code、port所有者 | `node course.mjs lesson 05 diagnose`を実行する |
| credentialらしき値を共有した | terminal、chat、screenshot、log | 共有を止める。実credentialなら直ちにrotationする |
| HTTPで成功したので本番もよいと思った | `transportContext` | 教材だけのloopback deviationとTLS要件を読み直す |

原因が分からない場合も`.lab`を直接編集・削除せず、次を実行します。

```bash
node course.mjs lesson 05 diagnose
```

まずlesson診断の`reasonCode`と`recovery`を確認します。lesson外のcourse stateも原因として調べる場合だけ、次のcourse全体診断を追加で実行します。どちらもstateやprocessを変更しません。

```bash
node course.mjs diagnose
```

## 任意の30分発展課題

AA05-C1とC2の合格後、`extension.yaml`のAA05-X1〜X3へ進めます。Basic認証の棚卸し、廃止、header秘匿とrunbookを設計します。この時間は標準実習1240分に含めません。
