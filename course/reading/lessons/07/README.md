# 第07回 読解評価

対象記事: [第07回](https://blog.cloudnative.co.jp/articles/auth-authz-07-kerberos-authentication/)

記事を読んでから、答えを見ずに5問へ回答します。4問以上で合格です。不正解だった問題は指定された見出しへ戻り、根拠を説明できてから再回答します。

この評価は理解を確かめる形成的評価（formative assessment）です。実習を伴うcourse outcomeや実行技能の修了は認定しません。学校・社内研修では講師が指定するまでanswer keyを開きません。

## 問1: AA07-Q1

TGTを使って特定service向けticketを得るexchangeはどれですか。

- A. TGS exchange
- B. AS exchange
- C. HTTP redirectだけ

迷ったら記事の「TGTとservice ticketは別のもの」へ戻ります。

## 問2: AA07-Q2

HTTP serviceが未認証requestへ返すchallengeはどれですか。

- A. 403とWWW-Authenticate: Basic
- B. 401とWWW-Authenticate: Negotiate
- C. 200とLocation

迷ったら記事の「HTTP NegotiateはKerberosをHTTPで運ぶ」へ戻ります。

## 問3: AA07-Q3

service access前後で新たにcacheへ現れるものはどれですか。

- A. 利用者の平文password
- B. server keytabの秘密
- C. 対象HTTP service ticket

迷ったら記事の「正常系はcacheの前後差で読む」へ戻ります。

## 問4: AA07-Q4

存在しないSPNを要求したとき、最初に拒否する境界はどれですか。

- A. TGS
- B. applicationのresource認可
- C. browser Cookie store

迷ったら記事の「誤SPNはTGSで止まる」へ戻ります。

## 問5: AA07-Q5

KDC側key更新後にserviceが古いkeytabを使い続けた場合の停止地点はどれですか。

- A. ASでの利用者認証前
- B. service acceptorのticket復号・検証
- C. OAuth introspection

迷ったら記事の「stale keytabはacceptorで止まる」へ戻ります。

## 答え合わせ

5問すべてへ回答した後に[解答と根拠](answer-key.md)を開きます。

[読解評価一覧へ戻る](../../README.md)
