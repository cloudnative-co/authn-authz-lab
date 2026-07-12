<a id="AA10-A1"></a>
# 第10回 読解評価の解答と根拠

先にREADME.mdの5問へ回答してください。4問以上で合格です。不正解は指定見出しへ戻り、理由を言葉にしてから再回答します。

| 問題 | 正解 | 読み直す見出し |
| --- | --- | --- |
| AA10-Q1 | A | 結論は、誰が何を委任するかを見ること |
| AA10-Q2 | B | state、PKCE、codeを混ぜない |
| AA10-Q3 | C | state、PKCE、codeを混ぜない |
| AA10-Q4 | A | 一条件だけ変えた拒否を確認する |
| AA10-Q5 | B | 一条件だけ変えた拒否を確認する |

## AA10-Q1

正解は **A** です。Resource Serverがtokenを受け、対象APIへのaccess可否を検証します。

読み直す見出し: [結論は、誰が何を委任するかを見ること](https://blog.cloudnative.co.jp/articles/auth-authz-10-oauth-basics-for-oidc/)

## AA10-Q2

正解は **B** です。stateはcallbackを開始時のtransactionへ結びつけ、CSRFなどの取り違えを防ぎます。

読み直す見出し: [state、PKCE、codeを混ぜない](https://blog.cloudnative.co.jp/articles/auth-authz-10-oauth-basics-for-oidc/)

## AA10-Q3

正解は **C** です。Clientが保持するcode_verifierと事前のcode_challengeを照合し、code単独の利用を防ぎます。

読み直す見出し: [state、PKCE、codeを混ぜない](https://blog.cloudnative.co.jp/articles/auth-authz-10-oauth-basics-for-oidc/)

## AA10-Q4

正解は **A** です。未登録URIは攻撃者が制御する可能性があるため、Authorization ServerはそのURIをredirect先に使わず拒否します。

読み直す見出し: [一条件だけ変えた拒否を確認する](https://blog.cloudnative.co.jp/articles/auth-authz-10-oauth-basics-for-oidc/)

## AA10-Q5

正解は **B** です。Authorization Codeは一回限りの交換券であり、成功済みcodeの再利用はinvalid_grantとして拒否します。

読み直す見出し: [一条件だけ変えた拒否を確認する](https://blog.cloudnative.co.jp/articles/auth-authz-10-oauth-basics-for-oidc/)
