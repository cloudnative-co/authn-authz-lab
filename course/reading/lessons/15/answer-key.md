<a id="AA15-A1"></a>
# 第15回 読解評価の解答と根拠

先にREADME.mdの5問へ回答してください。4問以上で合格です。不正解は指定見出しへ戻り、理由を言葉にしてから再回答します。

| 問題 | 正解 | 読み直す見出し |
| --- | --- | --- |
| AA15-Q1 | B | JWT Access TokenでもClientにはopaque |
| AA15-Q2 | C | `resource`を`aud`へつなぐ |
| AA15-Q3 | A | Resource Serverは何を検証するか |
| AA15-Q4 | B | scopeを通過してもobject認可が残る |
| AA15-Q5 | C | 3つのGateに分ける |

## AA15-Q1

正解は **B** です。token形式がJWTでも、ClientはAuthorization ServerとResource Server間のcontractを独自解釈しません。

読み直す見出し: [JWT Access TokenでもClientにはopaque](https://blog.cloudnative.co.jp/articles/authn-authz-15-oauth-api-authorization/)

## AA15-Q2

正解は **C** です。要求した対象resourceはAccess Tokenのaudienceへ結びつき、Resource Serverが自分向けか確認します。

読み直す見出し: ``resource`を`aud`へつなぐ`

## AA15-Q3

正解は **A** です。署名だけでなくtoken種別、issuer、audience、expiryなどcontract全体を検証します。

読み直す見出し: [Resource Serverは何を検証するか](https://blog.cloudnative.co.jp/articles/authn-authz-15-oauth-api-authorization/)

## AA15-Q4

正解は **B** です。scopeはAPI capabilityの粗い境界で、対象object・tenant・ownershipの認可は別に残ります。

読み直す見出し: [scopeを通過してもobject認可が残る](https://blog.cloudnative.co.jp/articles/authn-authz-15-oauth-api-authorization/)

## AA15-Q5

正解は **C** です。tokenとscopeのGateは通ってもobject認可で拒否し、存在秘匿contractなら404へ畳みます。

読み直す見出し: [3つのGateに分ける](https://blog.cloudnative.co.jp/articles/authn-authz-15-oauth-api-authorization/)
