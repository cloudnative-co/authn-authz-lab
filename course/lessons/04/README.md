# 第04回 アプリケーション認可を実際のHTTPで確かめる

実習のみ（1240分）では、準備ラボ完了後にこのガイドを上から進めます。完全コース（1935分）では、対応記事の中でこの実習を一度だけ行い、記事を読み終えた後に[第04回の読解5問](../../reading/lessons/04/README.md)で4問以上を確認します。このガイドは詳細確認に使い、同じcommandを二重実行しません。読解のみ（695分）では実習不要です。

この演習では、project削除APIを使って「誰が」「どのresourceへ」「何をするか」をserver側で判定します。ownerの成功、viewerの拒否、outsiderと別tenantの秘匿、未認証sessionの拒否を、実際のCookieとHTTP responseで順番に確認します。所要時間の目安は90分です。

## この回でできるようになること

- 認証済みのprincipalと、認可に使うrole・tenant・resourceを分けて追跡する
- ownerの`204`、viewerの`403`、存在を秘匿する`404`を理由付きで説明する
- request headerでroleやtenantを偽装しても権限が上がらないことを確認する
- 許可・拒否とresource更新・audit記録が同じtransactionで確定する理由を説明する
- auditへ残すpolicy情報と、残してはいけないcredentialやsessionを区別する

## 先に登場人物を確認する

教材のsource of recordには、次の関係だけが登録されています。

| 利用者 | tenant | `p-100`との関係 | 予想する削除結果 |
| --- | --- | --- | --- |
| Alice (`user-100`) | `t-100` | owner | 許可 |
| Bob (`user-200`) | `t-100` | viewer | 権限不足 |
| Carol (`user-300`) | `t-100` | memberではない | 存在を秘匿 |
| Dave (`user-400`) | `t-200` | 別tenant | 存在を秘匿 |

この表はbrowserが申告する値ではありません。[`project-core`](../../../services/project-core/domain.mjs)が保持するsubject、project、membershipを認可判断の正とします。

## requestが通る境界

削除requestは次の順で処理されます。

1. `project-app`がCookieからsessionを解決する
2. sessionからprincipalの`id`を得る
3. `project-core`がprincipal、project、tenant、membershipを照合する
4. 許可なら削除、拒否なら無変更にする
5. 同じtransactionでpolicy decisionを1件auditへ追加する

未認証requestは1で止まるため、`project-core`へ到達せずauditも増えません。`x-principal-id`、`x-project-role`、`x-tenant-id`をrequestへ加えても、認証や認可の入力には使いません。

## このAPIのHTTP status

| 状態 | status | この教材の意味 |
| --- | ---: | --- |
| 利用可能なCookie sessionがない | `403` | challenge方式ではないAPIのgeneric拒否 |
| 認証済みだがviewer | `403` | resourceは見えるが削除権限がない |
| outsider、別tenant、存在しないproject、削除済みproject | `404` | resourceの存在を区別して開示しない |
| ownerが削除に成功 | `204` | 削除済みでresponse bodyなし |

このCookie session APIはHTTP認証schemeのchallengeを使わないため、未認証時にも`WWW-Authenticate`を返しません。`401`と`WWW-Authenticate`の組合せは第05回のHTTP Basic認証で扱います。`403`や`404`を常に使うという一般則ではなく、APIの認証方式とresource秘匿policyを先に決めます。

## 前提

リポジトリのルートで実行します。Node.jsは24.xです。

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

第03回までで、Cookie、Session ID、Session Storeを区別できることも前提です。実在するaccount、password、session、API tokenは入力しません。

## 1. 実行前に予測する

次の5件について、`204`、`403`、`404`のどれになるかをメモします。

1. Cookieなしで`p-100`を削除する
2. Bobが`x-project-role: owner`を付けて`p-100`を削除する
3. Carolが`p-100`を削除する
4. Daveが`p-100`を削除する
5. Aliceが`p-100`を削除した後、もう一度削除する

さらに「どのcaseでprojectが消えるか」「どのcaseでauditが増えるか」も予測します。

## 2. 課題を準備する

次の順に実行します。

```bash
node course.mjs lesson 04 doctor
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 04 setup
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 04 demo
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 04 observe
```

`[PASS]`を確認してから回答を編集します。失敗時は`check`へ進まず、`reasonCode`と`recovery`を解消して同じ`observe`を再実行します。

`setup`は[`workspace-template.json`](workspace-template.json)を`.lab/submissions/04/submission.json`へ初回だけ複製します。既存回答は上書きしません。

`demo`は毎回隔離したscenarioを作り、教材専用accountで次を実行します。

1. Cookieなしの削除を拒否し、`WWW-Authenticate`がないことを確認する
2. BobのCookieで偽装header付き削除を試し、`403`と無変更を確認する
3. Carol、Dave、存在しないprojectのresponseが同じ`404`になることを確認する
4. Aliceだけが`204`で削除できることを確認する
5. 同じprojectの再削除も同じ`404`になることを確認する
6. project stateと秘匿済みauditを観察する

観察結果は`.lab/submissions/04/runtime.json`へ保存されます。password、identifier、raw Cookie、Session ID、scenario ID、完全なdigestは保存されません。`check`はこの保存済みfileを合否根拠として信用せず、fresh scenarioを再実行します。

## 3. runtimeを読む

`.lab/submissions/04/runtime.json`で、次を順に探します。

| JSON path | 確認すること |
| --- | --- |
| `enforcement` | 未認証403、challengeなし、audit 0件、偽装header無効 |
| `owner` | `204`、project削除、allow audit |
| `viewer` | `403`、project維持、deny audit |
| `concealment` | 4種類がすべて`404`でresponseも同じ |
| `audit` | 6件、field限定、secretなし、最大64件 |

`owner.projectPresentAfter`が`false`なのは削除されたためです。`viewer.projectPresentAfter`が`true`なのは、拒否とstate変更が別々に成功する余地を作らず、拒否時は無変更で確定したためです。

## 4. submissionを完成する

`.lab/submissions/04/submission.json`の`TODO`を、次の許可値から選びます。JSONのkey、引用符、カンマは変えません。

| field | 選択肢 |
| --- | --- |
| `sessionFailure` | `generic-403-without-challenge` / `401-without-www-authenticate` |
| `principalSource` | `cookie-session-only` / `x-principal-id-header` |
| `authorizationAttributes` | `project-core-source-of-record` / `caller-role-and-tenant-headers` |
| `callerClaims` | `ignored` / `trusted-for-authorization` |
| `unauthenticatedAudit` | `absent` / `project-core-denial-recorded` |
| `ownerDelete` | `allowed-204-and-resource-removed` / `allowed-200-with-resource-body` |
| `viewerDelete` | `denied-403-and-resource-preserved` / `allowed-by-viewer-role` |
| `decisionMutationAudit` | `atomic-single-transaction` / `independent-best-effort-steps` |
| `concealmentPolicy` | `outsider-cross-tenant-missing-repeat-same-404` / `different-response-by-resource-existence` |
| `bolaDefense` | `project-core-rechecks-subject-resource-relation` / `browser-supplied-project-role-is-sufficient` |
| `auditFields` | `subject-resource-action-decision-status-reason-only` / `full-request-cookie-and-headers` |
| `auditSecrets` | `absent` / `session-and-password-retained` |
| `retention` | `bounded-64` / `unbounded` |
| `decisionCoverage` | `six-policy-decisions` / `successful-delete-only` |

保存後、JSONとして読めることを確認します。

```bash
node -e "JSON.parse(require('node:fs').readFileSync('.lab/submissions/04/submission.json', 'utf8')); console.log('JSON OK')"
```

## 5. 採点する

```bash
node course.mjs lesson 04 check
```

全required checkが`pass`になるまで、教材processまたはlesson stateを保持します。`fail`の場合は`stop`や`reset`へ進まず、`observe`→回答修正→`check`を繰り返します。

合格には4件すべてのpassが必要です。

| Check | runtimeと回答で確かめること |
| --- | --- |
| `AA04-C1` | Cookie sessionのPEP、challengeなし403、server側属性、偽装header無効 |
| `AA04-C2` | owner許可、viewer拒否、state変更とauditのatomicity |
| `AA04-C3` | outsider、別tenant、missing、repeatの同一404とBOLA拒否 |
| `AA04-C4` | 6件のdecision、限定field、secret非保存、bounded retention |

不合格時は、表示されたcheck IDと`runtime.json`の同名sectionを照合します。answer keyの転記だけでは、fresh scenarioのruntime条件を満たせません。

## 6. 実務へ移す

自分が扱うAPIについて、分からない項目は「未確認」と書きます。

1. principalはどの認証済み情報から作られるか
2. tenant、role、ownershipのsource of recordはどこか
3. request bodyやheaderの申告値を認可に使っていないか
4. resourceごとにactionを判定しているか
5. outsiderとmissingを区別してよい要件か、秘匿すべきか
6. 許可・拒否、resource変更、auditがどのtransaction境界にあるか
7. auditの最大保持数と、禁止するsecret・personal dataは何か

## 終了とやり直し

回答を残して教材所有processを止めます。

全required checkの`pass`を確認した後だけ、次の`stop`を実行します。

```bash
node course.mjs lesson 04 stop
```

現在の第04回答を破棄してやり直す場合だけ実行します。

```bash
node course.mjs lesson 04 reset
```

`.lab`を手作業で削除せず、所有者不明processを教材から停止しません。

## 困ったとき

| 状況 | 確認 | 対応 |
| --- | --- | --- |
| `PREREQUISITE_SETUP` | course setupの有無 | `node course.mjs setup`を実行する |
| `PREREQUISITE_LESSON_DEMO` | `runtime.json`の有無 | `node course.mjs lesson 04 demo`を実行する |
| `CHECK_LESSON04_SUBMISSION_INVALID` | TODO、未知field、JSON | templateと比較して修正する |
| port 3000が使用中 | 教材所有processか | 所有者不明processを停止せず、`diagnose`する |
| 期待と違うaccountが成功する | principalとmembership | request headerではなくCookie sessionとsource of recordを追う |
| sessionやpasswordを共有した | terminal、提出物、画面共有 | 共有を止め、実credentialなら直ちに失効・変更する |

このlessonのsupport statusはexperimentalです。自動検証はありますが、human pilotと全support profileの実機検証は未完了です。

## 任意の45分発展課題

AA04-C1〜C4の合格後、`extension.yaml`のAA04-X1〜X3へ進めます。resource認可表、BOLA test、操作と監査の整合性を設計します。この時間は標準実習1240分に含めません。
