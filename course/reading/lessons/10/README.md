# 第10回 読解評価

対象記事: [第10回](https://blog.cloudnative.co.jp/articles/auth-authz-10-oauth-basics-for-oidc/)

記事を読んでから、答えを見ずに5問へ回答します。4問以上で合格です。不正解だった問題は指定された見出しへ戻り、根拠を説明できてから再回答します。

この評価は理解を確かめる形成的評価（formative assessment）です。実習を伴うcourse outcomeや実行技能の修了は認定しません。学校・社内研修では講師が指定するまでanswer keyを開きません。

## 問1: AA10-Q1

OAuthで保護resourceを保持しAccess Tokenを検証するroleはどれですか。

- A. Resource Server
- B. Resource Ownerだけ
- C. browser Cookie Store

迷ったら記事の「結論は、誰が何を委任するかを見ること」へ戻ります。

## 問2: AA10-Q2

authorization responseを開始したbrowser transactionへ結びつける値はどれですか。

- A. code_verifierだけ
- B. state
- C. Access Tokenのscope

迷ったら記事の「state、PKCE、codeを混ぜない」へ戻ります。

## 問3: AA10-Q3

盗まれたAuthorization Codeだけではtoken交換できなくする仕組みはどれですか。

- A. Cookie Path
- B. HTTP Basic challenge
- C. PKCE

迷ったら記事の「state、PKCE、codeを混ぜない」へ戻ります。

## 問4: AA10-Q4

Authorization Requestのredirect URIが未登録だった場合、Authorization Serverの処理はどれですか。

- A. requestを400で拒否し、そのURIへredirectしない
- B. そのURIへerrorを付けてredirectする
- C. 登録済みURIへ自動的に書き換える

迷ったら記事の「一条件だけ変えた拒否を確認する」へ戻ります。

## 問5: AA10-Q5

成功済みAuthorization Codeをもう1度Token Endpointへ送った場合の結果はどれですか。

- A. 同じAccess Tokenを再表示する
- B. invalid_grantとして拒否する
- C. scopeを増やして交換する

迷ったら記事の「一条件だけ変えた拒否を確認する」へ戻ります。

## 答え合わせ

5問すべてへ回答した後に[解答と根拠](answer-key.md)を開きます。

[読解評価一覧へ戻る](../../README.md)
