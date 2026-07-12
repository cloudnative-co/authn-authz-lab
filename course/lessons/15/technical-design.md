# Lesson 15 technical design: RFC 9068 JWT Access Token and project authorization

## Protocol boundary

Lesson 10/11と同じ1 process・3固定originを再利用する。listener、issuer、redirect URI、resource identifierはrequestのHostから導出しない。

| Origin | Role | Responsibility |
| --- | --- | --- |
| `http://127.0.0.1:4100` | Authorization Server | Authorization Code + PKCE、Resource Indicator、JWT署名、JWKS |
| `http://127.0.0.1:4101` | public Client | state/PKCE、code交換、Access Tokenのopaque転送 |
| `http://127.0.0.1:4102` | Resource Server / PEP | JWT検証、scope検証、project-coreへのprincipal引き渡し |

## Resource Indicator and token issuance

ClientはAuthorization Requestに、登録済みのAPI identifierを1つだけ送る。

```text
resource=http://127.0.0.1:4102/projects
scope=project:delete
```

ASは`resource`をexact matchし、code metadataへ束縛する。Token Requestでも同じ値を要求する。欠損、重複、別resourceは`invalid_target`で拒否する。RFC 8707のresource valueはabsolute URIでありfragmentを持てない。この教材では登録済み1値だけを許可し、複数resourceやaudience arrayは扱わない。

ASはRFC 9068 profileとして、RS256で署名し、次を入れる。

- JOSE header: `alg=RS256`, `typ=at+jwt`, 固定`kid`
- required claims: `iss`, `exp`, `aud`, `sub`, `client_id`, `iat`, `jti`
- requested scopeがあるため`scope`

RFC 9068はJWT Access Tokenの署名を必須とし、準拠AS/RSにRS256 supportを求め、`typ`でAccess Token用途を明示する。ClientはJWTを解析せず、OAuthのAccess Tokenとしてopaqueに扱う。

## Resource Server validation order

Resource Serverは次をすべて通過するまでproject-coreを呼ばない。

1. Authorization headerが1つだけで、Bearer credentialがある
2. compact JWTのsizeとshapeが上限内
3. protected headerの`typ`が`at+jwt`または`application/at+jwt`
4. Authorization ServerのJWKSから取得した鍵でRS256署名を検証
5. `iss`が固定issuerとexact match
6. `aud`に固定resource identifierが含まれる
7. `exp`、`iat`、最大token ageを検証
8. `sub`、`client_id`、`jti`、`scope`の存在と型を検証
9. `client_id`が登録Client、`sub`がlocal principalへ対応できる
10. `project:delete` scopeがある
11. 検証済み`sub`だけをproject-coreへ渡す

`jti`は存在と形を検証するが、このLessonはjti replay storeや緊急失効を実装しない。JWKSはRemote JWK Setとして取得・cacheするが、鍵rotationを起こすscenarioは扱わない。

## HTTP and policy outcomes

| Boundary | Outcome | project-core |
| --- | --- | --- |
| Bearerなし | 401 + Bearer challenge | 呼ばない |
| malformed、署名、iss、aud、exp、typ、claim不正 | 401 `invalid_token` | 呼ばない |
| Token有効、scope不足 | 403 `insufficient_scope` | 呼ばない |
| scope通過、同一tenantのviewer | 403 | 呼ぶ |
| scope通過、cross-tenantまたは未知project | concealed 404 | 呼ぶ |
| scope通過、owner | 204 | 呼ぶ、削除と監査を同一project-core transactionで行う |

401/403のBearer errorはRFC 6750 Section 3.1に従う。project認可の403/404はOAuth Tokenの有効性ではなくlocal resource policyの結果である。

## Cross-JWT confusion

同じissuer、同じ公開鍵で検証可能でも、ID TokenをResource APIが受け入れてはいけない。`typ=at+jwt`とAPI固有audienceを別々に検証する。故障注入のID Token混同ケースは、署名済みID Token型をAccess Token位置へ置換する一条件fixtureであり、通常ASの標準動作ではない。

## Fault and evidence boundary

`lesson-15` profileはfresh scenario内部だけに、malformed、bad signature、issuer、audience、expiry、wrong typ、ID Token substitution、required claim欠損を順番に1件ずつ注入する。scenario作成にはmanaged-process control capabilityが必要で、通常のbrowser requestでは選べない。

evidenceはrole、固定origin、method、queryなしpath、status、固定reason、booleanだけを記録する。JWT、code、verifier、Cookie、password、鍵、scenario ID、subjectを記録しない。

## Training deviations and omissions

- loopback HTTPは観察用。本番はHTTPSと証明書検証が必須
- key rotation、revocation、DPoP/mTLS、refresh token、multiple resource、distributed storageは未実装
- 5秒のclock toleranceを使うが、実環境の時刻同期・許容値は別途設計する
- project-core seedは単一projectの教材用domainであり、汎用ABAC/PBAC engineではない
- BOLAの検証はdelete endpoint 1本に限定し、列挙、batch、indirect referenceは扱わない

## Primary specifications

- [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html): Resource Indicators
- [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068.html): JWT Access Token header, claims, validation, client opacity
- [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750.html): Bearer presentation and error response
- [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html): audience restriction and OAuth security BCP
- [RFC 7517](https://www.rfc-editor.org/rfc/rfc7517.html): JSON Web Key / JWK Set
