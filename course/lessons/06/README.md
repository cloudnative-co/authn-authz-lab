# Lesson 06: 実OpenLDAPでbind、search、DN、attribute、groupを区別する

実習のみ（1240分）では、準備ラボ完了後にこのガイドを上から進めます。完全コース（1935分）では、対応記事の中でこの実習を一度だけ行い、記事を読み終えた後に[第06回の読解5問](../../reading/lessons/06/README.md)で4問以上を確認します。このガイドは詳細確認に使い、同じcommandを二重実行しません。読解のみ（695分）では実習不要です。

このLessonでは、course runnerがLesson専用のOpenLDAP containerだけを起動します。Dockerコマンドを手入力する必要はありません。

学習上は第01回の責任境界を前提にします。第01回のruntime stateや回答は不要です。

## 到達目標

- service accountのbind、user search、検索結果DNでのuser bind、group searchを順に説明できる
- DNとattributeとgroupを同じものとして扱わない
- DNがtree内のentryを指しても、renameやmoveをまたぐ長期不変IDではないと説明できる
- 空passwordがどの境界で拒否されたかをoperation traceから特定し、filter injection対策と分けて説明できる
- `ldap://`を使う範囲がloopback trainingだけで、productionではStartTLSまたはLDAPSが必要だと判断できる

## 前提確認

repository rootで次を実行します。

```bash
node course.mjs doctor
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs setup
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 06 doctor
```

`[PASS]`を確認してから次へ進みます。`[BLOCKED]`または`[FAIL]`なら`reasonCode`と`recovery`を解消し、同じ`doctor`を再実行します。

最後が`pass`ならDocker CLI、daemon、Compose、port 1389を利用できます。`reasonCode`が出た場合は次を確認します。

| reasonCode | 何をするか | なぜ必要か |
| --- | --- | --- |
| `PREREQUISITE_DOCKER_CLI` | Docker Desktopを導入し`docker --version`を確認 | runnerがComposeを安全に起動するため |
| `PREREQUISITE_DOCKER_DAEMON` | Docker Desktopを起動 | CLIだけではcontainerを実行できないため |
| `PREREQUISITE_DOCKER_COMPOSE` | `docker compose version`が成功する環境へ更新 | Lesson専用serviceを宣言どおり作るため |
| `PREREQUISITE_LDAP_PORT_IN_USE` | port 1389を使う別process/containerを停止 | runnerは所有不明の占有者を停止しないため |

## 実習

### 1. 予測する

次の順序を、実行前に紙やメモへ書きます。

1. read-only service accountでbind
2. `mail` attributeをEqualityFilterでsearch
3. search結果のuser DNと入力passwordでbind
4. `member = user DN`のgroupをsearch

空passwordのcaseが最初に止まる位置を、実行前に次の4択から1つ予測します。ここでは正誤を確認せず、`observe`後にoperation traceと照合します。

1. service accountでbindする前
2. service accountのbind後、user searchの前
3. user search後、user DNでbindする前
4. user DNでbindを試みた時点

### 2. 実OpenLDAPを起動する

```bash
node course.mjs lesson 06 setup
```

`[PASS]`または`safe-noop`を確認してから`demo`へ進みます。失敗時は`reasonCode`と`recovery`を解消し、同じ`setup`を再実行します。

初回はimage buildを含むため数分かかる場合があります。runnerはsetup/resetだけ15分の安全な既定timeoutを使います。成功するとOpenLDAPとproject-appが起動し、`.lab/submissions/06/submission.json`が作られます。

### 3. fresh scenarioを実行する

```bash
node course.mjs lesson 06 demo
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 06 observe
```

`[PASS]`を確認してから回答を編集します。失敗時は`check`へ進まず、`reasonCode`と`recovery`を解消して同じ`observe`を再実行します。

demoは毎回新しいscenarioで次を実LDAPへ送ります。

- Aliceの正しいpassword: `200`、engineeringとsecurityを返す
- wrong、unknown、empty、filter injection: 同じ`422 DIRECTORY_AUTH_FAILED`
- 失敗responseに`WWW-Authenticate`はない
- emptyだけはLDAP connectionへ到達しない

`401`はHTTP authentication schemeのchallengeに使うstatusです。このJSON loginはBasic認証ではないため、Lesson 05の`401 + WWW-Authenticate: Basic`とは区別します。

外部status/bodyが同じでも、timingまで同じとは限りません。unknown userはpeople searchで止まり、wrong passwordはuser DN bindまで進みます。このLessonはtiming side-channelの解消を証明しません。

### 4. 回答する

`.lab/submissions/06/submission.json`の`TODO`を、実行結果と次の各2択から1つ選んで置き換えます。正答はここでは示しません。予測と`runtime.json`のoperation traceを根拠に選びます。

#### `AA06-C1`

| Field | 選択肢 |
| --- | --- |
| `userLookup` | `service-search-then-user-dn-bind` / `admin-bind-validates-user-password` |
| `dnMeaning` | `distinguished-name-identifies-entry` / `display-name-shown-to-user` |
| `attributeMeaning` | `named-values-on-entry` / `authorization-role-only` |
| `groupLookup` | `member-equals-user-dn-search` / `group-is-returned-by-user-bind` |

#### `AA06-C2`

| Field | 選択肢 |
| --- | --- |
| `emptyPassword` | `reject-before-network` / `send-as-anonymous-bind` |
| `filterConstruction` | `structured-equality-filter` / `string-concatenation-with-raw-input` |
| `failureSurface` | `generic-422-without-http-challenge` / `different-status-for-each-failure` |
| `serviceAccount` | `least-privilege-read-only-not-admin` / `directory-admin-for-all-operations` |
| `productionTransport` | `StartTLS-or-LDAPS-with-certificate-validation` / `cleartext-ldap-on-any-network` |

`check`後も根拠を説明できない場合だけ[`answer-key.md`](answer-key.md)を開き、どの観察が正答を支えるか確認します。

### 5. fresh actual LDAPで採点する

```bash
node course.mjs lesson 06 check
```

全required checkが`pass`になるまで、教材processまたはlesson stateを保持します。`fail`の場合は`stop`や`reset`へ進まず、`observe`→回答修正→`check`を繰り返します。

保存済みruntime.jsonだけでは合格しません。checkは新しいscenarioを作り、実OpenLDAPのbind/searchを再実行してAA06-C1とAA06-C2を採点します。

## lifecycle

通常終了では、全required checkの`pass`を確認した後だけ次の`stop`を実行します。project-appと所有済LDAP containerを停止し、回答とevidenceは保持します。

```bash
node course.mjs lesson 06 stop
```

停止後に同じ回答で観察を再開する場合だけ、次を実行します。`[PASS]`または`safe-noop`を確認してから`demo`へ戻ります。

```bash
node course.mjs lesson 06 setup
```

`[PASS]`または`safe-noop`を確認してから`demo`へ進みます。失敗時は`reasonCode`と`recovery`を解消し、同じ`setup`を再実行します。

回答を破棄して最初からやり直す場合だけ、次を実行します。所有済container、runtime secret、directory、回答templateを作り直すため、通常のcheck失敗では使いません。

```bash
node course.mjs lesson 06 reset
```

環境、health、所有権のどこで止まったか分からない場合は、stateを変更しない次の診断を実行します。表示された`reasonCode`と`recovery`を直してから、失敗したcommandだけを再実行します。

```bash
node course.mjs lesson 06 diagnose
```

全Lessonの回答、evidence、process、container、network、volume、stateを削除してよい場合だけ次を実行します。lesson形式でも削除範囲はcourse全体です。取り消せず、通常終了やcheckの再試行には使いません。

```bash
node course.mjs lesson 06 purge --yes
```

どのcommandでも、label、container ID、config digestが一致しないresourceは停止・削除せず、fail closedします。

## 任意の60分発展課題

AA06-C1とAA06-C2の合格後、`extension.yaml`のAA06-X1〜X3へ進めます。自環境のsearch / ACL inventory、DN変更をまたぐidentity link、TLS移行と障害運用を設計します。この時間は標準実習1240分に含めません。実password、bind password、実DN、certificateやprivate keyは提出しません。

## productionへ持ち込まないもの

このLessonの`ldap://127.0.0.1`は通信経路だけを観察するtraining deviationです。productionではStartTLSまたはLDAPS、証明書検証、secret manager、接続poolと同時実行上限、監査設計を別途実装します。directory adminをapplicationの常用bind DNにしてはいけません。

DNはその時点のdirectory treeでentryを指しますが、renameや別OUへのmoveで変わり得ます。実務のidentity linkでは、directory製品が提供する不変identifierとnamespaceの契約を確認し、email、uid、DNを無条件に永続keyへしません。

このLessonは現在macOS arm64 / Node.js 24 / Docker Desktopだけをcandidateとして実機検証しています。固定release、human pilot、amd64、Linux、WSL2、offline bundleは未完了です。base image digestとapt version pinだけではDebian mirror上の旧packageが将来も取得できる保証にならないため、正式releaseにはsnapshot repositoryまたは事前build multi-architecture image digestが必要です。
