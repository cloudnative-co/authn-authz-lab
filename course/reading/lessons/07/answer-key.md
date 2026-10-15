<a id="AA07-A1"></a>
# 第07回 読解評価の解答と根拠

先にREADME.mdの5問へ回答してください。4問以上で合格です。不正解は指定見出しへ戻り、理由を言葉にしてから再回答します。

| 問題 | 正解 | 読み直す見出し |
| --- | --- | --- |
| AA07-Q1 | A | TGTとservice ticketは別のもの |
| AA07-Q2 | B | HTTP NegotiateはKerberosをHTTPで運ぶ |
| AA07-Q3 | C | 正常系はcacheの前後差で読む |
| AA07-Q4 | A | 誤SPNはTGSで止まる |
| AA07-Q5 | B | stale keytabはacceptorで止まる |

## AA07-Q1

正解は **A** です。clientはTGTをTGSへ提示し、対象SPN向けのservice ticketを得ます。

読み直す見出し: [TGTとservice ticketは別のもの](https://blog.cloudnative.co.jp/articles/authn-authz-07-kerberos-authentication/)

## AA07-Q2

正解は **B** です。HTTP Negotiateでは401 challengeを受け、clientがservice ticket由来tokenをAuthorizationで送ります。

読み直す見出し: [HTTP NegotiateはKerberosをHTTPで運ぶ](https://blog.cloudnative.co.jp/articles/authn-authz-07-kerberos-authentication/)

## AA07-Q3

正解は **C** です。TGTとは別に対象SPN向けservice ticketが取得され、credential cacheの差として観察できます。

読み直す見出し: [正常系はcacheの前後差で読む](https://blog.cloudnative.co.jp/articles/authn-authz-07-kerberos-authentication/)

## AA07-Q4

正解は **A** です。KDCのTGSがservice principalを解決できず、applicationへのAP exchange前に止まります。

読み直す見出し: [誤SPNはTGSで止まる](https://blog.cloudnative.co.jp/articles/authn-authz-07-kerberos-authentication/)

## AA07-Q5

正解は **B** です。clientは新しいkeyでticketを得ますが、古いkeytabのacceptorは復号・検証できません。

読み直す見出し: [stale keytabはacceptorで止まる](https://blog.cloudnative.co.jp/articles/authn-authz-07-kerberos-authentication/)
