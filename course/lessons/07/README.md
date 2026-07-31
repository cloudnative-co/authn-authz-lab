# 第07回 Kerberos V5とHTTP Negotiateを実protocolで追う

実習のみ（1240分）では、準備ラボ完了後にこのガイドを上から進めます。完全コース（1935分）では、対応記事の中でこの実習を一度だけ行い、記事を読み終えた後に[第07回の読解5問](../../reading/lessons/07/README.md)で4問以上を確認します。このガイドは詳細確認に使い、同じcommandを二重実行しません。読解のみ（695分）では実習不要です。

この実習では、[RFC 4120のKerberos V5](https://www.rfc-editor.org/rfc/rfc4120.html)に沿うMIT KDC、`kinit`、`klist`、`kvno`、GSSAPI acceptorと、[RFC 4559のHTTP Negotiate](https://www.rfc-editor.org/rfc/rfc4559.html)を`curl --negotiate`で実際に動かします。ticketをJSONやHMACで模倣しません。

学習上は第01回の責任境界を前提にします。第05回のHTTP challengeと第06回のdirectory境界は補助知識であり、未受講なら本README内で必要部分を確認できます。過去回のruntime stateや回答は不要です。

学習後は次を説明できるようになります。

- `kinit`で得るTGTと、HTTP serviceへ提示するservice ticketの違い
- `401`と`WWW-Authenticate: Negotiate`から始まるKerberos認証の流れ
- 誤SPN、時刻ずれ、古いkeytabが、それぞれTGSまたはAP/GSSAPIのどこで拒否されるか
- protocol token、password、keytabを証跡へ保存してはいけない理由

## 最初に登場人物を区別する

| 名前 | この実習での役割 | 受け渡すもの |
| --- | --- | --- |
| client | Aliceとして操作する端末 | TGT、service ticket、Negotiate token |
| KDCのAS | 最初の本人確認 | TGT |
| KDCのTGS | serviceごとのticket発行 | HTTP service ticket |
| app | `HTTP/app.example.test` service | 401 challenge、認証後のprincipal |
| keytab | appがservice ticketを検証するための鍵 | clientや提出物へ渡さない |

SPNはserviceを識別するprincipal名です。この実習では`HTTP/app.example.test@EXAMPLE.TEST`です。TGTのservice principalは`krbtgt/EXAMPLE.TEST@EXAMPLE.TEST`で、同じticketではありません。[MIT Kerberosの`kvno`文書](https://web.mit.edu/kerberos/krb5-latest/doc/user/user_commands/kvno.html)にあるとおり、`kvno`は指定serviceのticketを取得してkey version numberを表示します。

## 前提

リポジトリのルートで実行します。

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

Node.jsは24.x、Docker DesktopまたはDocker EngineとCompose v2が必要です。教材runnerが所有確認、build、起動、停止を行うため、`docker compose`を手動実行しません。

## 1. 実行前に予測する

次の5件について、拒否される場所と観察できる結果をメモします。

1. `kinit`直後の`klist`にはTGTとHTTP service ticketのどちらがあるか
2. Authorizationなしでappへアクセスすると、statusとchallengeは何か
3. 存在しないSPNを要求すると、HTTP handlerへ到達するか
4. 有効なservice ticketを持つclient processの時刻だけを10分進めると、password確認とticket時刻検証のどちらで失敗するか
5. appが古いkvnoのkeytabだけを読むと、TGT取得とappのacceptのどちらが失敗するか

host clockを変更する操作は行いません。

## 2. 環境を準備して実行する

```bash
node course.mjs lesson 07 doctor
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 07 setup
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 07 demo
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 07 observe
```

`[PASS]`を確認してから回答を編集します。失敗時は`check`へ進まず、`reasonCode`と`recovery`を解消して同じ`observe`を再実行します。

`setup`はLesson 07専用のKDC、app、clientを隔離network内に準備します。host portは公開しません。教材用passwordは0600のstate fileからKDC secretと`kinit`のstdinへ渡され、command lineには入りません。[MIT Kerberosのkeytab定義](https://web.mit.edu/kerberos/krb5-latest/doc/basic/keytab_def.html)にあるprincipal、kvno、encryption type、keyのうち、教材証跡へ残すのはroleと比較結果だけです。

`demo`は次を順に実行します。

1. cacheを破棄して`kinit`し、TGTだけがあることを確認する
2. Authorizationなしのrequestで401 challengeを確認する
3. `curl --negotiate`でHTTP service ticketを取得し、appで200になることを確認する
4. 誤SPNをTGSで拒否する
5. client processだけを10分進め、AP/GSSAPIで拒否する
6. appだけを旧kvno keytabへ切り替えて拒否し、現行keytabへ戻して200を再確認する

## 3. 証跡を上から読む

`.lab/submissions/07/runtime.json`を開き、次の順で読みます。

| JSON path | 確認すること |
| --- | --- |
| `normal.afterKinit` | canonical principalとTGTがあり、HTTP service ticketはまだない |
| `normal.challenge` | `401`と`Negotiate` |
| `normal.authenticated` | `200`と`alice@EXAMPLE.TEST` |
| `normal.afterServiceRequest` | TGTに加えてHTTP service ticketがある |
| `rejection.wrongSpn` | `TGS`で`SERVICE_PRINCIPAL_UNKNOWN` |
| `rejection.clockSkew` | `AP-GSSAPI`で`CLOCK_SKEW_REJECTED` |
| `rejection.staleKeytab` | `ACCEPTOR_KEY_MISMATCH`かつ現行keytabへ復旧済み |
| `protocol` | Kerberos mechanismに限定し、一般的multi-leg SPNEGOを実装したと主張していない |
| `safety` | password、token、keytab、native errorが省略されている |

runtimeにはticket本体もNegotiate tokenも保存されません。`klist`の生出力ではなく「どの種類のticketが存在したか」だけを残します。

## 4. 回答を入力する

`.lab/submissions/07/submission.json`の`TODO`を、各行の2択から1つ選んで置き換えます。key、引用符、カンマは変更しません。

### AA07-C1

| Field | 選択肢 |
| --- | --- |
| `tgt` | `present-after-kinit-before-http-service-ticket` / `same-ticket-as-http-service-ticket` |
| `serviceTicket` | `obtained-from-tgs-for-http-service` / `embedded-in-the-user-password` |
| `challenge` | `401-with-www-authenticate-negotiate` / `403-without-challenge` |
| `acceptor` | `gssapi-validates-service-ticket-with-read-only-keytab` / `application-decodes-a-json-ticket-with-a-shared-hmac` |
| `scope` | `kerberos-mechanism-not-general-spnego-or-browser` / `all-spnego-mechanisms-and-browsers-proven` |

### AA07-C2

| Field | 選択肢 |
| --- | --- |
| `wrongSpn` | `tgs-rejects-unknown-service-before-http` / `application-rejects-a-password-after-http` |
| `clockSkew` | `ap-rejects-offset-client-process-with-host-clock-unchanged` / `host-clock-is-changed-and-password-is-rejected` |
| `staleKeytab` | `acceptor-rejects-kvno-mismatch-with-generic-401` / `client-reuses-the-tgt-as-the-acceptor-key` |
| `transport` | `tls-required-private-http-training-only` / `plain-http-approved-for-production` |
| `evidence` | `omit-password-tokens-keytab-native-error` / `retain-authorization-token-for-debugging` |

## 5. 5件を診断する

`diagnosis.D1`から`D5`も、runtimeのどこを根拠にしたかを確認して選びます。

| Field | 選択肢 |
| --- | --- |
| `D1` | `tgt-does-not-authorize-the-http-service` / `tgt-is-the-http-service-ticket` |
| `D2` | `wrong-spn-fails-at-tgs-before-http` / `wrong-spn-reaches-the-http-handler` |
| `D3` | `clock-skew-is-ap-time-validation-not-password-failure` / `clock-skew-means-the-password-hash-did-not-match` |
| `D4` | `keytab-kvno-mismatch-fails-at-the-acceptor` / `keytab-kvno-is-ignored-by-the-acceptor` |
| `D5` | `negotiate-challenge-does-not-prove-browser-sent-kerberos` / `negotiate-challenge-proves-every-browser-sent-kerberos` |

診断は5件中4件以上が必要です。ただし、runtimeの実protocol条件とAA07-C1/C2の回答も両方満たす必要があります。

## 6. 採点する

```bash
node course.mjs lesson 07 check
```

全required checkが`pass`になるまで、教材processまたはlesson stateを保持します。`fail`の場合は`stop`や`reset`へ進まず、`observe`→回答修正→`check`を繰り返します。

`check`は保存済みruntimeを信用せず、fresh scenarioを再実行します。

| Check | 合格条件 |
| --- | --- |
| `AA07-C1` | TGTとservice ticketの順序、401 challenge、200 principal、GSSAPI keytab検証、実装範囲が一致する |
| `AA07-C2` | 3拒否位置、旧keytabからの復旧、generic HTTP面、TLSと秘匿境界、診断4/5以上が一致する |

## 7. 実務へ移す

自分の環境について、分からない項目は「未確認」と書きます。

1. realm、KDC、DNSと時刻同期の責任者は誰か
2. HTTP serviceのSPNを誰が登録し、重複をどう検出するか
3. [application serverのkeytab保護とclock skew](https://web.mit.edu/kerberos/krb5-latest/doc/admin/appl_servers.html)を踏まえ、keytabの発行、配布、file権限、rotation、旧kvno廃止を誰が行うか
4. reverse proxyとapplicationのどちらがGSSAPI acceptorになるか
5. TLS終端とKerberos principal確定後のsessionまたは認可境界はどこか
6. GSSAPI reasonを利用者responseへ出さず、運用者へ安全に届ける方法は何か
7. browser allowlist、intranet zone、fallback認証を検証したか

## 終了、再実行、完全削除

回答と教材secretを残してcontainerを止めます。

全required checkの`pass`を確認した後だけ、次の`stop`を実行します。

```bash
node course.mjs lesson 07 stop
```

第07回の回答、KDC、keytabを作り直す場合だけ実行します。

```bash
node course.mjs lesson 07 reset
```

教材全体を削除する場合は、他lessonへの影響を確認してから実行します。

```bash
node course.mjs purge --yes
```

## 困ったとき

```bash
node course.mjs lesson 07 diagnose
```

| Reason code | 意味 | 対応 |
| --- | --- | --- |
| `PREREQUISITE_DOCKER_CLI` | Docker CLIがない | Dockerの公式導入手順でCLIを準備する |
| `PREREQUISITE_DOCKER_DAEMON` | daemonへ接続できない | Docker Desktopまたはdaemonを起動する |
| `PREREQUISITE_DOCKER_COMPOSE` | Compose v2がない | Docker環境を更新する |
| `CONTAINER_BUILD_FAILED` | KDC/app/client imageをbuildできない | network、disk、Docker build logの固定reasonを確認する |
| `CONTAINER_UNHEALTHY` | 3 serviceのどれかがreadyにならない | `diagnose`でservice単位の状態を確認する |
| `KINIT_REJECTED` | AS exchangeを完了できない | KDC healthと教材secret stateを確認し、passwordを画面共有しない |
| `CHECK_LESSON07_SUBMISSION_INVALID` | TODO、未知field、未知値がある | templateと選択肢を比較する |

このlessonはmacOS arm64 / Node.js 24 / Docker Desktopで実測し、Linux x64 / Node.js 24 / Docker EngineをCI対象にしています。CI外実機と複数人のhuman pilotは別途必要です。

## 任意の60分発展課題

AA07-C1とC2の合格後、`extension.yaml`のAA07-X1〜X3へ進めます。SPN、keytab rotation、TLS終端の運用を設計します。この時間は標準実習1240分に含めません。
