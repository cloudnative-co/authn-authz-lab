<a id="AA05-A1"></a>
# 第05回 読解評価の解答と根拠

先にREADME.mdの5問へ回答してください。4問以上で合格です。不正解は指定見出しへ戻り、理由を言葉にしてから再回答します。

| 問題 | 正解 | 読み直す見出し |
| --- | --- | --- |
| AA05-Q1 | C | 401はchallengeと一緒に読む |
| AA05-Q2 | A | 資格情報は4段階で作る |
| AA05-Q3 | B | 結論は401 challengeと毎requestのAuthorization |
| AA05-Q4 | C | Base64は暗号化ではない |
| AA05-Q5 | A | 採用条件を6項目に分ける |

## AA05-Q1

正解は **C** です。HTTP authentication schemeのchallengeは401とWWW-Authenticateを組み合わせて伝えます。

読み直す見出し: [401はchallengeと一緒に読む](https://blog.cloudnative.co.jp/articles/authn-authz-05-basic-authentication/)

## AA05-Q2

正解は **A** です。Basicはuser-idとpasswordをcolonで結合したoctet列をBase64化してscheme名を付けます。

読み直す見出し: [資格情報は4段階で作る](https://blog.cloudnative.co.jp/articles/authn-authz-05-basic-authentication/)

## AA05-Q3

正解は **B** です。BasicはrequestごとにAuthorization headerでcredentialを提示するschemeです。

読み直す見出し: [結論は401 challengeと毎requestのAuthorization](https://blog.cloudnative.co.jp/articles/authn-authz-05-basic-authentication/)

## AA05-Q4

正解は **C** です。Base64は可逆な符号化なので、通信経路はTLSで保護し、headerをlogへ残さない必要があります。

読み直す見出し: [Base64は暗号化ではない](https://blog.cloudnative.co.jp/articles/authn-authz-05-basic-authentication/)

## AA05-Q5

正解は **A** です。共有IDでは、誰が操作したかを認証結果から個人単位で区別できません。個人監査が必要なら別方式を検討します。

読み直す見出し: [採用条件を6項目に分ける](https://blog.cloudnative.co.jp/articles/authn-authz-05-basic-authentication/)
