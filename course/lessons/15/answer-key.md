# Lesson 15 answer key

正答値の正は`assessment.mjs`です。

## AA15-C1

- accessTokenProfile: `rfc9068-signed-rs256-at+jwt`
- resourceIndicator: `rfc8707-exact-resource-to-audience`
- clientTreatment: `opaque-forward-only`
- validation: `jwks-signature-typ-iss-aud-exp-sub-client-id-iat-jti-scope`

JWT形式でもClientはAccess Tokenの中身を読みません。Resource APIだけが、信頼済みissuerのJWKSと固定audienceを使って検証します。

## AA15-C2

- invalidToken: `401-bearer-invalid-token-before-policy`
- insufficientScope: `403-bearer-insufficient-scope-before-policy`
- idTokenConfusion: `rejected-by-explicit-type`
- validationOrder: `token-then-scope-then-project-policy`

署名、issuer、audience、期限、type、必須claimのどれかが不正なら401です。署名が同じ鍵で正しくても、ID Tokenの`typ`とaudienceはAccess Token用ではないため拒否します。有効Tokenに必要scopeだけがなければ403です。

## AA15-C3

- policyDecisionPoint: `project-core-after-token-and-scope`
- sameTenantViewer: `403-policy-forbidden`
- crossTenant: `404-resource-concealed`
- unknownObject: `404-resource-concealed`
- owner: `204-delete`

`project:delete`はproject削除APIを呼べる必要条件です。対象projectのownerかどうかはproject-coreが別に判断します。他テナントと未知IDを同じ404にするのは、対象の存在を外部へ明かさないためです。
