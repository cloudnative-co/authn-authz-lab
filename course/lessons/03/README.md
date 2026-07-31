# 第03回 Cookieとサーバー側sessionの寿命を追跡する

実習のみ（1240分）では、準備ラボ完了後にこのガイドを上から進めます。完全コース（1935分）では、対応記事の中でこの実習を一度だけ行い、記事を読み終えた後に[第03回の読解5問](../../reading/lessons/03/README.md)で4問以上を確認します。このガイドは詳細確認に使い、同じcommandを二重実行しません。読解のみ（695分）では実習不要です。

この演習では、browserが送るCookie、Cookie値であるSession ID、serverが保持するSession Storeを別物として追跡します。login時のrotationから、期限切れ、logout、管理側失効までを実行し、どこでtokenが拒否されるかを確認します。所要時間の目安は90分です。

## この回でできるようになること

- Cookie、Session ID、Session Storeの役割と保存場所を区別する
- login前のtokenをlogin成功時に置換し、古いtokenを拒否する理由を説明する
- absolute expiry、logout、server-side revocationを別の失効契機として確認する
- loopback HTTPで`Secure`を外す教材上の逸脱を、productionの設定と混同しない

## 実装の範囲

実装の正は次の4ファイルです。

- [`session-service.mjs`](../../../apps/project-app/lessons/03/session-service.mjs): pre-auth、login rotation、expiry、logout、subject単位失効
- [`session-token.mjs`](../../../packages/session/session-token.mjs): 32 byte random token、canonical base64url、SHA-256 digest
- [`session-cookie.mjs`](../../../packages/session/session-cookie.mjs): Cookie parse、発行、削除、属性
- [`bounded-session-store.mjs`](../../../packages/session/bounded-session-store.mjs): boundedなserver-side recordとevent

この回のSession IDは、32 byte、つまり256 bitのrandom値をunpadded base64urlにした43文字のopaque tokenです。clientはtokenの中身を解釈しません。serverはraw tokenではなく、ASCII tokenのSHA-256 digestをlookup keyとして保存します。

## 3つを混ぜない

| 要素 | この実装での値 | 主な場所 | 役割 |
| --- | --- | --- | --- |
| Cookie | `course_session=<Session ID>`と属性 | browserとHTTP header | requestごとにSession IDを送る |
| Session ID | 256-bit opaque random token | browser側はCookie値として保持 | server-side recordを参照するcredential |
| Session Store | digest、subject、status、timestamps | server memory | sessionの状態、主体、期限、失効を判断する |

`HttpOnly`はJavaScriptからCookie値を読み取りにくくする属性で、browserがrequestにCookieを送らなくなる意味ではありません。`SameSite=Lax`も単独であらゆるCSRFを防ぐ保証ではありません。

## Cookie属性と教材上の逸脱

通常の発行形式は次の属性を持ちます。

```text
course_session=<opaque-token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=<seconds>; Secure
```

`Domain`を付けないためhost-onlyです。productionではHTTPSを前提に`Secure`を有効にします。一方、この教材のproject-appは`127.0.0.1`のHTTPで動かすため、demoでは`Secure`を無効にします。これは**loopback HTTPだけのtraining deviation**であり、productionで承認できる設定ではありません。

## 前提

リポジトリのルートで次が成功し、第02回で「認証成功」と「session発行」を分けて説明できることを確認します。

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

Node.jsは24.xまたは26.xです。実在するcredentialや利用中のCookieを教材へ入力しません。

## 1. 予測する

実行前に、次の3点をメモします。

1. login前に発行したSession IDを、login成功後もそのまま使ってよいか
2. logout時にbrowserのCookieだけを消した場合、盗まれていたSession IDはどうなるか
3. 有効期限内でもserver管理者がsessionを失効できるべきか

## 2. 課題を準備する

次の順に実行します。

```bash
node course.mjs lesson 03 doctor
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 03 setup
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 03 demo
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 03 observe
```

`[PASS]`を確認してから回答を編集します。失敗時は`check`へ進まず、`reasonCode`と`recovery`を解消して同じ`observe`を再実行します。

`setup`は、[`workspace-template.json`](workspace-template.json)を`.lab/submissions/03/submission.json`へ初回だけ複製します。既存回答を上書きしません。

`demo`は教材専用credentialで次のtraceを実行します。

1. pre-auth sessionを作る
2. 正しいcredentialでloginし、新しいauthenticated sessionへrotateする
3. 古いpre-auth tokenが拒否され、新しいtokenだけがcurrent userを取得できることを確認する
4. absolute expiry到達後に拒否されることを確認する
5. logout後に拒否されることを確認する
6. 同じsubjectのsessionをserver側から失効し、拒否されることを確認する

結果は`.lab/submissions/03/runtime.json`で読みます。raw Cookie、Session ID、完全なdigest、scenario IDは保存されません。`check`は毎回新しいscenarioを作り、実際の`Set-Cookie`と`Cookie`を通してtraceを再実行します。Node.js clientがheaderを観察する実習であり、browserによる`HttpOnly`や`SameSite`の強制動作までは検証しません。

## 3. lifecycleを観察する

### pre-authからauthenticatedへ

login前に作るrecordは`pre-authenticated`で、subjectを持ちません。credentialが正しい場合、次の順に処理します。

1. pre-auth tokenを解決する
2. credentialを検証してsubjectを得る
3. 新しいrandom tokenを生成する
4. 古いrecordを`revoked`にする
5. 新しいdigestで`authenticated` recordを作る

新旧tokenは同じではありません。古いpre-auth tokenはrotation後に`SESSION_UNAVAILABLE`です。同じpre-auth tokenを使った同時loginでも、成功するのは1件だけです。

このJSON APIはHTTP認証方式のchallengeを使いません。credential不一致は第02回と同じgenericな`422 INVALID_CREDENTIALS`、Cookieがない、壊れている、期限切れ、logout済み、失効済みの場合は同じ`403 SESSION_UNAVAILABLE`です。どちらも`WWW-Authenticate`を返しません。`401`とchallengeの組合せは、第05回のHTTP Basic認証で扱います。rate limitの`429`と容量保護の`503`は`Retry-After`とともにlogin APIまで保持します。

### absolute expiry

教材既定ではpre-auth lifetimeが5分、login成功後のabsolute lifetimeが30分です。`currentUser`を呼んでも期限は延びません。これは`absolute-not-sliding`であり、idle timeoutの実装ではありません。

### logoutとserver revocation

logoutはserver recordを`revoked`にし、その後のtokenを拒否します。HTTP統合では同時に`Max-Age=0`のSet-Cookieを返してbrowser側Cookieも削除する必要があります。serverだけ、browserだけの片側処理で「完全なlogout」とは扱いません。

管理操作の`revokeSubject`は、同じsubjectのauthenticated sessionをserver側からまとめて失効します。これは利用者のbrowserがCookieを送信し続けてもserverが拒否できることを示します。

## 4. observationの秘匿範囲を確認する

`observe`に次が含まれないことを確認します。

- raw Session ID
- 完全なSHA-256 digest
- password
- subjectのidentifier

sessionの対応確認にはdigestの先頭16 hexだけをfingerprintとして使い、subjectは内部IDだけを表示します。fingerprintをSession IDとして送信しても認証には使えません。

## 5. 回答ファイルを編集する

`.lab/submissions/03/submission.json`の`TODO`だけを、次の許可値から選んで置き換えます。field名、階層、lesson IDは変更しません。

| Field | 許可値 |
| --- | --- |
| `browserValue` | `raw-opaque-session-token-in-cookie` / `server-record-json` |
| `tokenSize` | `256-bit-32-byte` / `64-bit-8-byte` |
| `serverStoredValue` | `sha-256-token-digest-only` / `raw-session-token` |
| `cookieHttpOnly` | `enabled` / `disabled` |
| `cookieSameSite` | `Lax` / `None` |
| `cookiePath` | `/` / `/login-only` |
| `cookieDomain` | `omitted-host-only` / `example.com` |
| `loopbackTransport` | `secure-disabled-training-deviation-not-production` / `production-approved-http` |
| `loginRotation` | `mandatory-new-token` / `reuse-pre-auth-token` |
| `oldPreAuthToken` | `rejected` / `accepted` |
| `expiration` | `absolute-not-sliding` / `slides-on-every-request` |
| `logoutServerEffect` | `record-revoked` / `record-remains-active` |
| `logoutCookieEffect` | `max-age-zero` / `cookie-unchanged` |
| `loggedOutToken` | `rejected` / `accepted` |
| `serverRevocation` | `all-authenticated-sessions-for-subject` / `browser-cookie-only` |
| `revokedToken` | `rejected` / `accepted-until-expiry` |

## 6. 採点する

次を実行します。

```bash
node course.mjs lesson 03 check
```

全required checkが`pass`になるまで、教材processまたはlesson stateを保持します。`fail`の場合は`stop`や`reset`へ進まず、`observe`→回答修正→`check`を繰り返します。

| Check | 必須条件 |
| --- | --- |
| `AA03-C1` | token、store、Cookie属性、loopback逸脱のruntime条件と8回答が一致する |
| `AA03-C2` | login時にtokenが変わり、古いpre-auth tokenが拒否され、2回答が一致する |
| `AA03-C3` | absolute expiry、logout、Cookie削除、logout済みtoken拒否と4回答が一致する |
| `AA03-C4` | subject単位のserver失効と失効済みtoken拒否が成立し、2回答が一致する |

4件すべてがpassして初めて合格です。

## 7. 実務へ移す

自分が扱うWebアプリについて、次を確認します。分からない項目は「未確認」と書きます。

1. Cookie名と`Secure`、`HttpOnly`、`SameSite`、`Path`、`Domain`
2. Session IDのentropyと、serverでraw値またはdigestのどちらを保存するか
3. login、権限昇格、重要操作のどこでrotationするか
4. absolute timeoutとidle timeoutの有無
5. logout時のserver失効とbrowser Cookie削除
6. 管理者、利用者停止、incident対応からの一括失効方法

## 終了とやり直し

回答を残して教材所有processを止めるコマンドです。

全required checkの`pass`を確認した後だけ、次の`stop`を実行します。

```bash
node course.mjs lesson 03 stop
```

現在の第03回答を破棄してやり直す場合だけ、次を使います。

```bash
node course.mjs lesson 03 reset
```

`.lab`を手作業で削除せず、所有者不明processを教材から停止しません。

## 困ったとき

| 状況 | 確認 | 対応 |
| --- | --- | --- |
| `PREREQUISITE_SETUP` | course stateがない | `node course.mjs setup`を実行する |
| 古いtokenが使えると見える | 新旧tokenを取り違えていないか | fingerprintとevent順を確認する |
| `Secure`がない | originがloopback HTTPか | 教材逸脱としてのみ観察し、production設定へ転用しない |
| JSONがfail | TODO、field、許可値 | templateと比較して修正する |
| tokenを共有物へ貼った | terminal、スクリーンショット、課題提出 | 共有を止め、実sessionならserver側から失効する |

Session IDはcredentialです。教材用であってもraw tokenをレポート、チャット、スクリーンショットへ残しません。

## 任意の45分発展課題

AA03-C1〜C4の合格後、`extension.yaml`のAA03-X1〜X3へ進めます。分散session、失効、監査とincident対応を設計します。この時間は標準実習1240分に含めません。
