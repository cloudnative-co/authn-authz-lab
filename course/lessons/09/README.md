# Lesson 09: 実SAML 2.0 SSOをACSとapp sessionまで追う

実習のみ（1240分）では、準備ラボ完了後にこのガイドを上から進めます。完全コース（1935分）では、対応記事の中でこの実習を一度だけ行い、記事を読み終えた後に[第09回の読解5問](../../reading/lessons/09/README.md)で4問以上を確認します。このガイドは詳細確認に使い、同じcommandを二重実行しません。読解のみ（695分）では実習不要です。

このLessonでは、SPがAuthnRequestを生成し、Keycloak 26.7.0が利用者を認証し、署名済みSAMLResponseをHTTP-POSTでACSへ返し、SPが検証完了後にapp sessionを作るところまで実行します。メタデータ取得やAuthnRequest生成だけを「SSO成功」とは扱いません。

## 前提

- Node.js 24
- Docker Desktopまたは互換Docker daemonと`docker compose`
- Lesson 01と03を読み、認証結果とapp sessionを区別できること
- 初回setupはKeycloak imageとSP imageを取得・buildするため数分かかること

この実習のHTTPはhost portを公開しないCompose private network内だけです。Keycloak自体はpre-built imageから`start --optimized`で起動しますが、平文HTTP、`dev-file` database、realm import、自己完結した教材用realmはtraining deviationです。`start-dev`も本番では使いません。本番ではTLS、外部database、鍵rotation、監視、backupを別途設計します。

## 1. 実行前に予測する

実行前に次を紙かメモへ書きます。

1. AuthnRequestは誰が作り、どのbindingでIdPへ届くか。
2. SAMLResponseは誰が署名し、どのbindingでACSへ届くか。
3. 署名が正しくても、AudienceやRecipientが別SPなら受理できるか。
4. app session CookieはIdPとSPのどちらが発行するか。
5. 同一の署名済みResponseを2回送るとどうなるか。

## 2. 環境を確認して起動する

repository rootで実行します。

```bash
node course.mjs doctor
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs setup
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 09 doctor
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 09 setup --timeout 900
```

`[PASS]`または`safe-noop`を確認してから`demo`へ進みます。失敗時は`reasonCode`と`recovery`を解消し、同じ`setup`を再実行します。

`setup`はKeycloak、SP、scripted HTTP User Agentの3 serviceを教材所有label付きで起動します。host portは使いません。dummy credentialは`learner@example.test` / `course-password-for-saml-lab`ですが、runnerがCompose secretとして渡すため入力は不要です。

## 3. fresh scenarioを実行する

```bash
node course.mjs lesson 09 demo --timeout 120
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 09 observe
```

`[PASS]`を確認してから回答を編集します。失敗時は`check`へ進まず、`reasonCode`と`recovery`を解消して同じ`observe`を再実行します。

`.lab/submissions/09/runtime.json`で次を確認します。

- `actual`: Keycloakを使ったSP-initiated SSO。HTTP-RedirectのAuthnRequest、Keycloak login、HTTP-POSTのSAMLResponse、ACS、session Cookie、`/me`の順です。
- `conformance`: runtime生成test keyで署名した1条件違反fixture。Keycloakが返したResponseではありません。
- `strictValidation`: signatureだけでなくissuer、Audience、Conditions、Destination、InResponseTo、bearer SubjectConfirmation、Recipient、期限、replayを検証します。
- `evidenceRedaction`: raw XML、NameID、Cookie、private keyを保存していないことを示します。

scripted User Agentは実redirect、HTML form、Cookieを処理しますが、GUI browserのJavaScript、CSP、SameSite互換性、拡張機能、アクセシビリティを実証しません。

## 4. 1条件違反を読む

`conformance.cases`は次の11件です。

| Case | 変える条件 | 期待する拒否 |
| --- | --- | --- |
| signature | XML署名値 | `SIGNATURE_INVALID` |
| response-issuer | Response Issuer | `RESPONSE_ISSUER_INVALID` |
| assertion-issuer | Assertion Issuer | `ASSERTION_ISSUER_INVALID` |
| audience | Audience | `AUDIENCE_INVALID` |
| destination | Response Destination | `DESTINATION_INVALID` |
| response-in-response-to | Response InResponseTo | `IN_RESPONSE_TO_INVALID` |
| subject-method | SubjectConfirmation Method | `SUBJECT_CONFIRMATION_METHOD_INVALID` |
| subject-recipient | Recipient | `SUBJECT_CONFIRMATION_RECIPIENT_INVALID` |
| subject-in-response-to | SubjectConfirmationData InResponseTo | `SUBJECT_CONFIRMATION_IN_RESPONSE_TO_INVALID` |
| expiry | SubjectConfirmationData NotOnOrAfter | `SUBJECT_CONFIRMATION_EXPIRED` |
| replay | 同一Responseを2回POST | `REPLAY_DETECTED` |

各failureのHTTP responseは同じgeneric 400です。固定reasonは教材内部のredacted evidenceだけに現れます。失敗caseではsession数が増えていないことも確認します。

## 5. 回答して採点する

`.lab/submissions/09/submission.json`の`TODO`を、`runtime.json`とこのREADMEを根拠に許可値へ置き換えます。fieldを増減しません。

全fieldの候補は[`submission-choices.json`](submission-choices.json)で確認できます。各`path`を`submission.json`の同じ階層へ対応させ、`kind: "scalar"`では`TODO`を`choices`の文字列1つへ置き換えます。候補の順序に意味はなく、このファイルは正誤を示しません。`check`前は`answer-key.md`を開かず、観察したtraceを根拠に選びます。

```bash
node course.mjs lesson 09 check
```

全required checkが`pass`になるまで、教材processまたはlesson stateを保持します。`fail`の場合は`stop`や`reset`へ進まず、`observe`→回答修正→`check`を繰り返します。

合格にはAA09-C1とAA09-C2の両方、診断5問中4問以上、fresh runtime evidenceが必要です。

## 6. 復旧と終了

環境、health、所有権のどこで止まったか分からない場合は、stateを変更しない次の診断を実行します。表示された`reasonCode`と`recovery`を直してから、失敗したcommandだけを再実行します。

```bash
node course.mjs lesson 09 diagnose
```

回答を破棄し、所有する3 service、network、secret、回答templateを作り直す場合だけ次を実行します。通常のcheck失敗ではprocessを保持し、このresetは使いません。

```bash
node course.mjs lesson 09 reset --timeout 900
```

通常終了では、全required checkの`pass`を確認した後だけ次の`stop`を実行します。所有resourceを停止し、回答とruntimeは保持します。

```bash
node course.mjs lesson 09 stop
```

全Lessonの回答、runtime、evidence、stateを削除してよい場合だけ次を実行します。lesson形式でも範囲はcourse全体で、取り消せません。

```bash
node course.mjs lesson 09 purge --yes --json
```

他projectやforeign containerは、どのcommandでも操作しません。

`purge`は取り消せません。成功時はJSONの`diagnostics[]`内で、`id: "lesson.purge-scope"`の要素が`actual: "course-wide"`、`id: "resources.remaining"`の要素が`actual: "0"`であることを確認します。

`CONTAINER_CONFIG_DRIFT`や`CONTAINER_SPEC_DRIFT`が出た場合は、同じ教材revisionへ戻して`diagnose`します。手動の`docker rm`で所有記録と実resourceを食い違わせないでください。

## 任意の60分発展課題

AA09-C1とC2の合格後、`extension.yaml`のAA09-X1〜X3へ進めます。SAML trust、鍵更新、app sessionの運用を設計します。この時間は標準実習1240分に含めません。
