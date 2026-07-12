# Lesson 09 SAML 2.0 technical design

## 目的と達成判定

このLessonは、Keycloak 26.7.0をIdPとしてSP-initiated Web Browser SSOを実行し、AuthnRequest生成、利用者login、署名済みHTTP-POST Response、ACS検証、local app session作成を一つのtraceで確認する。メタデータ取得またはAuthnRequest生成だけでは達成にしない。

正常系の実Keycloak traceと、runtime生成test keyで署名するconformance fixtureは別の証拠である。fixture成功をKeycloak相互運用成功として数えず、Keycloak成功を全IdP/GUI browser対応として一般化しない。

## 実行構成

Composeはhost portを公開せず、internal networkの3 serviceだけを持つ。

| Service | 役割 | 実装 |
| --- | --- | --- |
| `keycloak` | IdP login、SAML Response/Assertion署名、HTTP-POST form | Keycloak 26.7.0 digest固定 |
| `sp` | AuthnRequest、metadata trust、ACS、strict wrapper、local session | Node 24、node-saml 5.1.0 |
| `user-agent` | redirect、HTML login form、SAML POST form、Cookie | Node fetchによるscripted HTTP agent |

Keycloak imageは`quay.io/keycloak/keycloak:26.7.0@sha256:2eb3cd316835c990e69e26ade292ffa78f6fb0db7d5fc6377463c162e1979ac0`へ固定する。SP/agent baseもNode 24.14.0のmulti-architecture digestへ固定する。containerはprivilegedを使わず、read-only rootとbounded tmpfsを使う。user passwordとcontrol tokenはcourse state内0600 fileからCompose secretとして渡す。

Keycloakはbuild時にproviderを最適化し、runtimeは`start --optimized`で動かす。ただしrealm import、平文HTTP、ephemeral `dev-file` databaseはtraining deviationである。`start-dev`も本番では使わない。本番はTLS、外部database、鍵rotation、backup、監視、hostname/proxy設定を必要とする。

## 実Keycloak正常flow

1. SPの`/login`がnode-samlでAuthnRequest IDを生成する。
2. request IDはTTL 5分・最大256件のdigest-only cacheへ保存する。
3. SPはrandom RelayStateを作り、RelayState digestからrequest ID digestへのtransactionを保存する。
4. User AgentはHTTP-Redirect bindingでKeycloak SSO endpointへ移動する。
5. Keycloak login formへdummy credentialをPOSTする。
6. KeycloakはResponseとAssertionの両方をRSA-SHA256で署名し、HTTP-POST bindingのauto-submit formを返す。
7. User AgentはSAMLResponseとRelayStateをSP ACSへPOSTする。
8. SPはbounded input、canonical Base64、XML構造、署名、protocol semantics、replayを検証する。
9. 全条件成功後だけrandom local session Cookieを発行する。
10. User AgentはCookie付きで`/me`へ到達し、authenticated pageを確認する。

User Agentはredirect、HTML form、Cookieを実処理するが、GUI browserのJavaScript、CSP、SameSite差異、拡張機能、表示、アクセシビリティは検証しない。

## metadata trust

SPはKeycloak descriptorをbounded fetchし、期待entityID、1件のRedirect SSO endpoint、最大4件のsigning certificateを抽出する。SAML message内のKeyInfoだけをtrust anchorにしない。metadata rollover、署名付きmetadata、外部HTTPS metadata配布は本Lesson外であり、本番では取得経路とrotationを別途管理する。

## node-samlとstrict wrapperの責務

`@node-saml/node-saml`はCVE-2025-54419修正版の5.1.0へ直固定する。設定は次を必須とする。

- `validateInResponseTo: 'always'`
- `wantAuthnResponseSigned: true`
- `wantAssertionsSigned: true`
- `idpCert`: metadataから得たtrust anchor
- `audience`: SP entity ID
- request ID TTL 5分
- bounded digest-only cache

node-samlの署名、Audience、Conditions/time検証を使ったうえで、wrapperは同じ一意なResponse/Assertion nodeへ追加制約を適用する。未検証raw XMLからprincipalを採用しない。

### 構造制約

- XML 512 KiB以下、Base64 700 KiB以下、depth 32以下、node 2048以下
- DOCTYPE、ENTITY、xml-stylesheet禁止
- SAML protocol namespaceのroot Responseが1件
- direct childのunencrypted Assertionが1件、EncryptedAssertionなし
- Response/Assertion Issuerが各1件
- Subject、NameID、SubjectConfirmation、SubjectConfirmationDataが各1件
- Conditions、AudienceRestriction、Audienceが各1件
- Response IDとAssertion IDは別のbounded ID

### 署名後に確認する意味

- Response IssuerとAssertion Issuerが期待IdP entityIDと一致
- Response DestinationがACS exact URLと一致
- Response InResponseToがRelayState transactionに紐づくrequest IDと一致
- SubjectConfirmation Methodがbearer
- RecipientがACS exact URLと一致
- SubjectConfirmationData InResponseToがResponse/requestと一致
- SubjectConfirmationData NotOnOrAfterが有効、NotBeforeは受け付けない
- ConditionsのNotBefore/NotOnOrAfterとAudienceが一致
- node-samlが返すprofile issuer/NameIDが、署名済みAssertionの同じ値と一致

## replayと並行性

Response ID、Assertion ID、AuthnRequest IDをone-timeにする。store keyはSHA-256 digestだけで、raw IDを保持しない。最大件数とTTLを持ち、成功後にResponse/Assertion digestを記録する。ACS検証をservice内で直列化し、同じsigned responseの並行POSTが二つとも通る競合を防ぐ。

exact replay caseは同一Base64 SAMLResponseとRelayStateを2回POSTする。1回目だけsessionを発行し、2回目は`REPLAY_DETECTED`の内部reasonでgeneric 400にする。

## conformance fixture

SP起動時にOpenSSLで24時間未満のruntime test key/certificateを`/tmp`へ生成する。private key、certificate、SAML XMLはcommitしない。fixture用IdP issuer、SP audience、ACSは実Keycloak構成と分ける。

各caseで新しいAuthnRequestと署名済みResponseを作り、一つの条件だけを変える。signature、Response/Assertion issuer、Audience、Destination、Response InResponseTo、SubjectConfirmation Method/Recipient/InResponseTo、expiryを各1件、最後にexact replayを確認する。各failureはHTTP 400の同じbodyで、session creation counterが増えないことを確認する。

## HTTP inputと外部failure

- ACSはPOSTと`application/x-www-form-urlencoded`だけを受け付ける。
- Content-Type、Content-Length、Cookie、Authorizationのduplicateをrejectする。
- transfer/content encodingを受け付けない。
- form fieldは`SAMLResponse`と`RelayState`が各1件だけで、unknown fieldをrejectする。
- body 768 KiB、header数64、request/header/body timeを有界にする。
- 外部failureは常に`SAML_LOGIN_FAILED`のgeneric 400とし、内部reasonを返さない。

sessionは検証関数が成功した後だけ作る。Cookie tokenはrandomで、store keyはdigestだけである。平文HTTPのため教材CookieにSecureを付けられないこと自体がtraining deviationであり、本番HTTPSではSecureを必須とする。

## evidence境界

保存してよいものはstage、HTTP status、binding名、固定reason、boolean、digestの存在だけである。次は保存しない。

- raw SAMLResponse、Assertion XML
- NameID、email
- session Cookie/token
- password、control token
- private key、certificate本文
- container ID、Compose project名、install ID

## lifecycleとownership

common managed-compose layerがproject名、course/install/resource label、container/network identity、config digestを記録する。setup、stop、reset、purgeはrecordと実labelが一致する所有resourceだけを扱う。foreign resource、config/source drift、partial crashはadoptまたは固定reasonで停止し、名前だけで削除しない。

## 検証

- unit: canonical Base64、XML shape、二重署名、semantic checks、digest store、exact replay
- fake runner: argv、timeout、output上限、ownership spec、submission schema、採点
- actual Docker: image build、Keycloak import、login form、signed POST、ACS、session、11拒否、stop/reset/purge
- learner flow: doctor→setup→demo→observe→回答→check→diagnose→stop
