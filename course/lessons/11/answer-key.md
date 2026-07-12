# Lesson 11 answer key

正答は`assessment.mjs`の構造化値を正とします。

## AA11-C1

- discovery: `exact-issuer-and-http-fetched-jwks`
- idTokenDelivery: `backchannel-token-response`
- validation: `rs256-signature-iss-aud-time-nonce`
- session: `digest-only-after-full-validation`

payloadをdecodeできることは検証ではありません。RPは固定issuerとdiscovery結果を一致させ、JWKSの鍵でRS256署名とclaimを検証してからsessionを発行します。

## AA11-C2

- identityKey: `issuer-subject-pair`
- email: `optional-attribute-not-subject`
- accessToken: `api-authorization-not-login-proof`
- negativeMatrix: `one-fault-id-tokens-all-rejected`

RPが一つのID Tokenから確認できるのは、`sub`が非空で教材上限255文字以下であることです。issuer内でlocally uniqueかつnever reassignedであることはissuerの契約であり、1回のloginから実測できません。複数issuerを扱うaccount keyは`(iss, sub)`の組です。emailは変更可能な属性です。access tokenはResource API向けであり、RPのログイン成立を示すID Tokenの代わりにはなりません。
