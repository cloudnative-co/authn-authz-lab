# 第05回 読解評価

対象記事: [第05回](https://blog.cloudnative.co.jp/articles/auth-authz-05-basic-authentication/)

記事を読んでから、答えを見ずに5問へ回答します。4問以上で合格です。不正解だった問題は指定された見出しへ戻り、根拠を説明できてから再回答します。

この評価は理解を確かめる形成的評価（formative assessment）です。実習を伴うcourse outcomeや実行技能の修了は認定しません。学校・社内研修では講師が指定するまでanswer keyを開きません。

## 問1: AA05-Q1

Basic認証を要求する401 responseに必要なheaderはどれですか。

- A. Locationだけ
- B. Set-Cookieだけ
- C. WWW-Authenticate: Basic

迷ったら記事の「401はchallengeと一緒に読む」へ戻ります。

## 問2: AA05-Q2

BasicのAuthorization値を作る正しい順序はどれですか。

- A. user:passwordをoctet列にしBase64化してBasicを付ける
- B. passwordを暗号化せずURLへ付ける
- C. CookieをJWTへ変換する

迷ったら記事の「資格情報は4段階で作る」へ戻ります。

## 問3: AA05-Q3

Basic認証で保護resourceへ送るものはどれですか。

- A. 認証済みsessionだけを一度送る
- B. 原則として各requestのAuthorization header
- C. IdPのSAML metadata

迷ったら記事の「結論は401 challengeと毎requestのAuthorization」へ戻ります。

## 問4: AA05-Q4

Base64化したcredentialをnetworkで守るために必須の前提はどれですか。

- A. 短いusername
- B. 公開logへの保存
- C. TLS

迷ったら記事の「Base64は暗号化ではない」へ戻ります。

## 問5: AA05-Q5

複数人が同じBasic認証IDを共有すると、特に満たしにくくなる要件はどれですか。

- A. 個人単位の操作監査
- B. Base64の文字数を増やすこと
- C. HTTP statusを200に固定すること

迷ったら記事の「採用条件を6項目に分ける」へ戻ります。

## 答え合わせ

5問すべてへ回答した後に[解答と根拠](answer-key.md)を開きます。

[読解評価一覧へ戻る](../../README.md)
