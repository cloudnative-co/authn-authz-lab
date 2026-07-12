<a id="AA01-A1"></a>
# 第01回 読解評価の解答と根拠

先にREADME.mdの5問へ回答してください。4問以上で合格です。不正解は指定見出しへ戻り、理由を言葉にしてから再回答します。

| 問題 | 正解 | 読み直す見出し |
| --- | --- | --- |
| AA01-Q1 | A | 「ログイン」を5つの責任に分ける |
| AA01-Q2 | B | CookieとSession IDは同じものではない |
| AA01-Q3 | C | フェデレーションと委任認可は、受け入れるものが違う |
| AA01-Q4 | A | 認証は「実在人物の身元確認」と同じではない |
| AA01-Q5 | B | 迷ったら「拒否の直接原因」を探す |

## AA01-Q1

正解は **A** です。利用者とsessionはすでに確定しており、対象resourceへのaction可否を決める認可で止まっています。

読み直す見出し: [「ログイン」を5つの責任に分ける](https://blog.cloudnative.co.jp/articles/auth-authz-01-login-basics/)

## AA01-Q2

正解は **B** です。Cookieは配送手段、Session IDはserver-side session recordを参照する識別子です。

読み直す見出し: [CookieとSession IDは同じものではない](https://blog.cloudnative.co.jp/articles/auth-authz-01-login-basics/)

## AA01-Q3

正解は **C** です。外部identity providerの認証結果をtrustして受け入れるのはフェデレーションです。

読み直す見出し: [フェデレーションと委任認可は、受け入れるものが違う](https://blog.cloudnative.co.jp/articles/auth-authz-01-login-basics/)

## AA01-Q4

正解は **A** です。認証成功は検証対象credentialの提示を確かめた結果であり、実在人物の同一性や全操作の許可までは証明しません。

読み直す見出し: [認証は「実在人物の身元確認」と同じではない](https://blog.cloudnative.co.jp/articles/auth-authz-01-login-basics/)

## AA01-Q5

正解は **B** です。期限とserver-side recordを検証するsession境界が直接の停止地点です。

読み直す見出し: [迷ったら「拒否の直接原因」を探す](https://blog.cloudnative.co.jp/articles/auth-authz-01-login-basics/)
