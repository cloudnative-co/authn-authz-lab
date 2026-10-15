<a id="AA11-A1"></a>
# 第11回 読解評価の解答と根拠

先にREADME.mdの5問へ回答してください。4問以上で合格です。不正解は指定見出しへ戻り、理由を言葉にしてから再回答します。

| 問題 | 正解 | 読み直す見出し |
| --- | --- | --- |
| AA11-Q1 | C | OIDCはOAuthの上のidentity layer |
| AA11-Q2 | A | discoveryとJWKSで検証の入口を固定する |
| AA11-Q3 | B | discoveryとJWKSで検証の入口を固定する |
| AA11-Q4 | C | ID Tokenはbrowser callbackへ直接返さない |
| AA11-Q5 | A | 六つの一条件不正を拒否する |

## AA11-Q1

正解は **C** です。OIDCはOAuth 2.0の上でEnd-User認証とclaimsの標準化を追加します。

読み直す見出し: [OIDCはOAuthの上のidentity layer](https://blog.cloudnative.co.jp/articles/authn-authz-11-openid-connect/)

## AA11-Q2

正解は **A** です。信頼するissuerを先に固定し、そのmetadataが示すJWKSを使います。token任意入力のURLへ追従しません。

読み直す見出し: [discoveryとJWKSで検証の入口を固定する](https://blog.cloudnative.co.jp/articles/authn-authz-11-openid-connect/)

## AA11-Q3

正解は **B** です。kidは鍵rotation時などに候補を選ぶ識別子で、鍵自体のtrustや他claims検証を置き換えません。

読み直す見出し: [discoveryとJWKSで検証の入口を固定する](https://blog.cloudnative.co.jp/articles/authn-authz-11-openid-connect/)

## AA11-Q4

正解は **C** です。ID TokenのaudienceはClientで、Access Tokenは保護resourceへのaccess用です。

読み直す見出し: [ID Tokenはbrowser callbackへ直接返さない](https://blog.cloudnative.co.jp/articles/authn-authz-11-openid-connect/)

## AA11-Q5

正解は **A** です。Access TokenとID Tokenは用途と検証者が異なります。ID Tokenでない値は認証結果として受け入れず、sessionも発行しません。

読み直す見出し: [六つの一条件不正を拒否する](https://blog.cloudnative.co.jp/articles/authn-authz-11-openid-connect/)
