# 第11回 読解評価

対象記事: [第11回](https://blog.cloudnative.co.jp/articles/auth-authz-11-openid-connect/)

記事を読んでから、答えを見ずに5問へ回答します。4問以上で合格です。不正解だった問題は指定された見出しへ戻り、根拠を説明できてから再回答します。

この評価は理解を確かめる形成的評価（formative assessment）です。実習を伴うcourse outcomeや実行技能の修了は認定しません。学校・社内研修では講師が指定するまでanswer keyを開きません。

## 問1: AA11-Q1

OIDCがOAuthへ追加する中心的な成果物はどれですか。

- A. LDAP group entry
- B. Kerberos keytab
- C. End-User認証についてのID Token

迷ったら記事の「OIDCはOAuthの上のidentity layer」へ戻ります。

## 問2: AA11-Q2

署名検証鍵を選ぶ前に固定すべきものはどれですか。

- A. 期待するissuerと、そのissuerのdiscovery metadata
- B. JWT headerのURLなら任意
- C. Clientが入力したJWKS URL

迷ったら記事の「discoveryとJWKSで検証の入口を固定する」へ戻ります。

## 問3: AA11-Q3

JWT headerのkidの役割として適切なのはどれですか。

- A. issuer検証を省略する許可
- B. 信頼済みJWKS内の候補鍵を選ぶ手掛かり
- C. 利用者のpassword

迷ったら記事の「discoveryとJWKSで検証の入口を固定する」へ戻ります。

## 問4: AA11-Q4

ID TokenとAccess Tokenの正しい使い分けはどれですか。

- A. ID Tokenを任意APIのBearerとして送る
- B. Access TokenでClient sessionを無条件に作る
- C. ID TokenはClientで認証結果を検証し、Access TokenはResource Serverへ送る

迷ったら記事の「ID Tokenはbrowser callbackへ直接返さない」へ戻ります。

## 問5: AA11-Q5

正常なopaque Access TokenがID Token欄へ取り違えて返された場合、RPはどうしますか。

- A. callbackを拒否しsessionを発行しない
- B. Access Tokenをlogin証明としてsessionを発行する
- C. tokenをJWKSへ登録して再試行する

迷ったら記事の「六つの一条件不正を拒否する」へ戻ります。

## 答え合わせ

5問すべてへ回答した後に[解答と根拠](answer-key.md)を開きます。

[読解評価一覧へ戻る](../../README.md)
