# 第08回 ID基盤とJMLを実Samba AD互換DCで確かめる

実習のみ（1240分）では、準備ラボ完了後にこのガイドを上から進めます。完全コース（1935分）では、対応記事の中でこの実習を一度だけ行い、記事を読み終えた後に[第08回の読解5問](../../reading/lessons/08/README.md)で4問以上を確認します。このガイドは詳細確認に使い、同じcommandを二重実行しません。読解のみ（695分）では実習不要です。

この実習では、Samba 4のAD互換Domain Controllerを起動し、Joiner・Mover・Leaverの変更がdirectory認証、application session、application roleへ反映される時差を確かめます。applicationはCAとhostnameを検証するLDAPSで接続し、Kerberosは同じDCへ`kinit`して別経路として観察します。

このruntimeはMicrosoft Active Directory Domain ServicesでもFreeIPAでもありません。SambaのLDAP/Kerberos互換機能だけを使い、GPO、Windows domain join、FreeIPA固有機能の動作は実証しません。

## 学習後に説明できること

- directoryのaccount状態とapplication session状態が別のlifecycleを持つ理由
- DNやmailではなく`objectGUID`由来のopaque IDをapplication keyにする理由
- directory groupをapplication roleへ直接コピーせず、明示mappingで変換する理由
- account disableが新規認証を止めても、既存sessionは再検証まで残り得る理由
- 同じID基盤がLDAPとKerberosを提供しても、applicationの認証経路は区別して記録する理由

## 前提

repository rootで実行します。

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

Node.js 24.x、Docker DesktopまたはDocker Engine、Compose v2が必要です。image build用の空き容量も必要ですが、必要量はplatformと既存cacheで変わるため、この教材では固定値を保証しません。runnerが所有label、container、network、volumeを管理するため、`docker compose`を手動実行しません。

学習上は第06回のLDAPと第07回のKerberosを前提にします。ただし、過去回のruntime stateや回答は不要です。

## 1. 実行前に予測する

次の結果を紙または別fileへ予測します。

1. Aliceを`CourseAppViewer`へ追加した直後の新規loginはどのroleになるか
2. Aliceを別OUへmoveし、ViewerからEditorへ変えた直後、既存sessionのroleは自動で変わるか
3. session再検証後、旧sessionは維持、更新、失効のどれになるか
4. account disable直後、新規loginと既存sessionはそれぞれどうなるか
5. `Engineering` groupはapplication roleとして扱われるか
6. OU move後もapplication内の同一人物判定を維持するkeyは何か

## 2. 第08回の環境を準備する

```bash
node course.mjs lesson 08 doctor
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 08 setup
```

`[PASS]`または`safe-noop`を確認してから`demo`へ進みます。失敗時は`reasonCode`と`recovery`を解消し、同じ`setup`を再実行します。

`setup`は次の3 serviceをhost portなしの隔離networkへ起動します。初回はimage buildとSamba domain provisionに時間がかかります。完了するまで別terminalから同じlessonを操作しません。

| Service | 実際の役割 | hostへ公開するport |
| --- | --- | --- |
| `dc` | Samba AD互換DC、LDAP/LDAPS、Kerberos KDC | なし |
| `app` | Node.jsと`ldapts`によるLDAPS認証・session・role mapping | なし |
| `client` | 同じDCへの`kinit`と`klist` | なし |

admin、service account、Alice、stable ID key、control tokenは実行時に生成した0600 fileからCompose secretへ渡します。実在credentialや固定admin passwordは使いません。

## 3. 実行する

```bash
node course.mjs lesson 08 demo
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 08 observe
```

`[PASS]`を確認してから回答を編集します。失敗時は`check`へ進まず、`reasonCode`と`recovery`を解消して同じ`observe`を再実行します。

## 4. 正常系と拒否系を順に読む

`.lab/submissions/08/runtime.json`を開きます。raw password、session token、objectGUID、DNは保存されません。

| JSON path | 実行したこと | 読み取ること |
| --- | --- | --- |
| `implementation` | Samba DCを隔離起動 | Microsoft AD DS/FreeIPA/GPOを一般化していない |
| `directory` | service bind→structured search→user bind→group search | LDAPSのCA/hostname検証とread-only service account |
| `identity` | `objectGUID`をHMACでopaque ID化 | OU move後もstable IDが同じで、raw GUID/DNは非保存 |
| `mapping` | Viewer/Editorだけを明示変換 | `Engineering`は組織groupでroleではない |
| `joiner` | user作成、group追加、新規login | 新規sessionは`viewer` |
| `mover` | OU move、Viewer削除、Editor追加 | 既存sessionは`viewer`のまま、再検証で失効、新規loginは`editor` |
| `leaver` | account disable | 新規loginはgeneric 422、既存sessionは再検証まで`editor`、再検証で失効 |
| `kerberos` | `kinit`と`klist` | 同じSamba DCのTGTを確認したが、app認証経路はLDAPS |

正常なloginの`directory.operations`は、`service-bind`、`structured-user-search`、`resolved-user-bind`、`structured-group-search`、`explicit-group-to-role-mapping`の順です。wrong passwordはuser Bindで止まり、unknown principalはuser Search後、空入力はdirectory operation前に止まります。いずれもgroup Searchへ進みません。

service accountのwrite probeは、Aliceの属性変更を試し`INSUFFICIENT_ACCESS`で拒否された場合だけ成功です。loginにdirectory admin権限は不要です。

## 5. 回答する

`.lab/submissions/08/submission.json`の`TODO`を各2択から1つ選んで置き換えます。key、引用符、カンマは変更しません。

### AA08-C1

| Field | 選択肢 |
| --- | --- |
| `platform` | `samba-ad-compatible-not-microsoft-ad-ds-or-freeipa` / `microsoft-ad-ds-and-freeipa-both-proven` |
| `directory` | `verified-ldaps-service-search-user-bind-group-search` / `cleartext-ldap-admin-bind-and-string-filter` |
| `identity` | `objectguid-derived-opaque-stable-id` / `email-or-dn-as-immutable-primary-key` |
| `kerberos` | `same-samba-platform-separate-from-ldaps-app-auth` / `kinit-proves-the-app-authenticated-with-kerberos` |
| `scope` | `no-gpo-windows-join-or-product-generalization` / `gpo-windows-join-and-freeipa-features-proven` |

### AA08-C2

| Field | 選択肢 |
| --- | --- |
| `mapping` | `explicit-group-to-role-policy` / `directory-group-name-is-the-app-role` |
| `organization` | `engineering-group-is-not-an-app-role` / `all-organization-groups-grant-app-permissions` |
| `mover` | `existing-session-stale-until-revalidation-then-new-login` / `directory-group-change-rewrites-existing-session-immediately` |
| `leaver` | `disable-blocks-new-auth-existing-session-needs-revalidation` / `directory-disable-destroys-all-app-sessions-automatically` |
| `serviceAccount` | `read-only-write-rejected` / `admin-write-access-required-for-login` |

### 診断

| Field | 選択肢 |
| --- | --- |
| `D1` | `directory-state-and-app-session-state-have-different-lifecycles` / `directory-and-app-session-are-the-same-state-store` |
| `D2` | `dn-and-email-can-change-objectguid-derived-key-remains-stable` / `email-is-always-more-stable-than-objectguid` |
| `D3` | `group-membership-is-input-to-explicit-app-policy-not-the-role-itself` / `group-name-must-be-copied-directly-into-app-permission` |
| `D4` | `generic-login-rejection-does-not-revoke-existing-app-sessions` / `generic-422-proves-every-existing-session-was-revoked` |

診断は4件中3件以上必要です。

## 6. fresh scenarioで採点する

```bash
node course.mjs lesson 08 check
```

全required checkが`pass`になるまで、教材processまたはlesson stateを保持します。`fail`の場合は`stop`や`reset`へ進まず、`observe`→回答修正→`check`を繰り返します。

`check`は保存済みruntimeだけを信用せず、user削除からJML sequenceを再実行します。AA08-C1とAA08-C2のruntime条件、回答、診断をすべて満たした場合だけpassです。

## 7. 実務へ移す

自分の環境について、未確認項目は推測せず「未確認」と書きます。

1. immutable IDとして何を使い、rename、merge、rehireでどう扱うか
2. group-to-role mappingのowner、reviewer、change historyは誰が持つか
3. session再検証の契機、間隔、directory障害時のfail-open/fail-closedは何か
4. disableから既存session失効までのSLOと緊急失効手段は何か
5. service accountのread範囲、credential rotation、TLS trust storeを誰が管理するか

## 終了と復旧

回答を残してcontainerを停止します。

全required checkの`pass`を確認した後だけ、次の`stop`を実行します。

```bash
node course.mjs lesson 08 stop
```

第08回の回答、runtime secret、DC、CA、sessionを作り直す場合だけ実行します。

```bash
node course.mjs lesson 08 reset
```

原因を確認します。

```bash
node course.mjs lesson 08 diagnose
```

教材全体を削除する場合だけ、他lessonへの影響を確認して実行します。

```bash
node course.mjs purge --yes
```

| Reason code | 確認と対応 |
| --- | --- |
| `PREREQUISITE_DOCKER_CLI` | Docker CLIを公式手順で導入する |
| `PREREQUISITE_DOCKER_DAEMON` | Docker Desktopまたはdaemonを起動する |
| `PREREQUISITE_DOCKER_COMPOSE` | Compose v2を含むDocker環境へ更新する |
| `CONTAINER_BUILD_FAILED` | network、disk容量、package repositoryの到達性を確認する |
| `CONTAINER_UNHEALTHY` | `diagnose`でDC、LDAPS app、clientのどこが未readyか確認する |
| `CONTAINER_CONFIG_DRIFT` | 同じ教材revisionへ戻す。foreign containerを削除しない |
| `CHECK_LESSON08_SUBMISSION_INVALID` | templateと許可値を比較し、未知fieldやTODOを直す |

自動E2EはmacOS arm64 / Node.js 24 / Docker Desktopで検証しています。Linux x64 / Node.js 24 / Docker EngineはCI対象ですが、Samba DNSを含む全E2Eの安定化は未完了です。CI外実機と複数人のhuman pilotも未完了です。

## 任意の90分発展課題

AA08-C1とC2の合格後、`extension.yaml`のAA08-X1〜X3へ進めます。JML同期、緊急session失効、identity linkの運用を設計します。この時間は標準実習1240分に含めません。
