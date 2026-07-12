# Lesson 10 answer key

正答は`assessment.mjs`の構造化値を正とします。

## AA10-C1

- flow: `authorization-code-with-pkce-s256`
- client: `public-client-without-secret`
- state: `one-time-server-side-transaction`
- code: `opaque-digest-only-bound-one-time`
- accessToken: `opaque-with-authenticated-introspection`

stateはcallbackとClient transactionを結び、PKCEはcodeを奪った別主体の交換を防ぎます。役割は同じではありません。codeは誤verifierの試行でも消費されます。

## AA10-C2

- bearerFailure: `401-with-bearer-challenge`
- scopeFailure: `403-with-insufficient-scope`
- passwordBoundary: `authorization-server-only`
- transport: `https-required-loopback-http-training-only`

tokenがない・無効なら認証問題、activeでも必要scopeがないなら認可問題です。loopback HTTPは観察用の意図的省略であり、本番の承認ではありません。
