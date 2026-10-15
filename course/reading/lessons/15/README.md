# 第15回 読解評価

対象記事: [第15回](https://blog.cloudnative.co.jp/articles/authn-authz-15-oauth-api-authorization/)

記事を読んでから、答えを見ずに5問へ回答します。4問以上で合格です。不正解だった問題は指定された見出しへ戻り、根拠を説明できてから再回答します。

この評価は理解を確かめる形成的評価（formative assessment）です。実習を伴うcourse outcomeや実行技能の修了は認定しません。学校・社内研修では講師が指定するまでanswer keyを開きません。

## 問1: AA15-Q1

JWT形式のAccess Tokenを受け取ったClientが行うべき扱いはどれですか。

- A. claimsを書き換えて権限を増やす
- B. 意味を独自解釈せずResource Serverへ渡すopaqueなcredentialとして扱う
- C. ID Tokenとしてloginに使う

迷ったら記事の「JWT Access TokenでもClientにはopaque」へ戻ります。

## 問2: AA15-Q2

authorization requestのresource indicatorがtokenへ反映される中心的なclaimはどれですか。

- A. nonceだけ
- B. Cookie Path
- C. aud

迷ったら記事の「`resource`を`aud`へつなぐ」へ戻ります。

## 問3: AA15-Q3

Resource ServerがJWT Access Tokenで検証すべき組合せはどれですか。

- A. 署名、typ、iss、aud、時刻と必要claims
- B. Base64 decodeできることだけ
- C. Client画面にroleがあることだけ

迷ったら記事の「Resource Serverは何を検証するか」へ戻ります。

## 問4: AA15-Q4

project:delete scopeを持つ利用者が別tenantのprojectを削除しようとしました。次に必要な判断はどれですか。

- A. scopeだけで無条件に許可する
- B. tenantとownershipをproject-coreで認可する
- C. tokenをID Tokenへ変える

迷ったら記事の「scopeを通過してもobject認可が残る」へ戻ります。

## 問5: AA15-Q5

有効tokenと必要scopeはあるが、存在を秘匿する他tenant resourceだった場合に使い得るstatusはどれですか。

- A. 401 invalid_token
- B. 204 success
- C. 404

迷ったら記事の「3つのGateに分ける」へ戻ります。

## 答え合わせ

5問すべてへ回答した後に[解答と根拠](answer-key.md)を開きます。

[読解評価一覧へ戻る](../../README.md)
