# Lesson 09 instructor guide

対象は、第01回の責任境界と第03回のapp sessionを説明できる初学者です。両Lessonのruntime stateは不要です。完全コースの標準時間は120分です。

## 到達条件

受講者が次を実証できた場合だけ合格にします。

1. Keycloakの実loginを含むSP-initiated flowがAuthnRequestからapp sessionまで完了した。
2. HTTP-Redirect requestとHTTP-POST responseを区別した。
3. Keycloak正常系とruntime署名fixtureを別の証拠として説明した。
4. 10種類の1条件違反とexact replayがgeneric ACS failureになった。
5. 各拒否で新しいapp sessionが作られなかった。
6. raw XML、NameID、Cookie、password、private keyがruntime/evidenceにない。
7. scripted User AgentをGUI browser実証へ一般化していない。
8. 教材の`dev-file`/realm import/private HTTPと`start-dev`を本番構成として承認していない。

## 105分の進行

| 時間 | 内容 | 確認点 |
| ---: | --- | --- |
| 0〜15分 | 登場者と予測 | SP、IdP、User Agent、ACS、app sessionを区別した |
| 15〜30分 | doctor/setup | runnerだけで所有resourceを起動した |
| 30〜50分 | actual Keycloak trace | Redirect、login、POST、ACS、sessionを順に読んだ |
| 50〜70分 | strict validation | signatureと宛先・相関・期限を分離した |
| 70〜88分 | one-fault fixture | 1件ずつ変え、session未発行を確認した |
| 88〜98分 | replay | exact same signed responseの2回目拒否を説明した |
| 98〜105分 | check/stop | AA09-C1/C2、診断4/5、終了を確認した |
| 105〜120分 | 読解5問 | 4/5以上を確認し、誤答は指定見出しへ戻った |

## 混同への問い返し

- 「その時点でACSはResponseを受け取りましたか」
- 「署名鍵が正しいことと、このSP向けであることは同じですか」
- 「Response InResponseToとSubjectConfirmationData InResponseToは何に一致しますか」
- 「Cookieを発行したのはKeycloakですか、SPですか」
- 「そのfailureでsession counterは増えましたか」
- 「その証拠はKeycloak runtimeですか、署名fixtureですか」

## 安全境界

- 失敗HTTP bodyは全caseで固定し、内部reasonを利用者へ返しません。
- raw SAMLResponseを画面共有、提出、ログへコピーさせません。
- dummy passwordを実credentialへ流用させません。
- Docker resourceを手動削除させず、`diagnose`、`reset`、`purge`を使います。
- host portはありません。平文HTTPはprivate network内training deviationです。
- 教材は`start --optimized`ですが、`dev-file` databaseとrealm importは本番要件を満たしません。`start-dev`も本番不可です。

## 未検証境界

この教材はKeycloak 26.7.0、scripted HTTP form/cookie agent、node-saml 5.1.0、単一SP/IdPを確認します。GUI browserのCSP/JavaScript/SameSite、IdP metadata rollover、複数証明書rotation、暗号化Assertion、Single Logout、IdP-initiated SSO、proxy/TLS終端、Microsoft製品との相互運用は扱いません。
