<a id="AA03-A1"></a>
# 第03回 読解評価の解答と根拠

先にREADME.mdの5問へ回答してください。4問以上で合格です。不正解は指定見出しへ戻り、理由を言葉にしてから再回答します。

| 問題 | 正解 | 読み直す見出し |
| --- | --- | --- |
| AA03-Q1 | B | Cookie、Session ID、Session Storeを分ける |
| AA03-Q2 | C | pre-authからauthenticatedへrotationする |
| AA03-Q3 | A | Cookie属性はheaderで観察する |
| AA03-Q4 | B | 3つの終了経路を分ける |
| AA03-Q5 | C | absolute expiry |

## AA03-Q1

正解は **B** です。Cookie削除だけでなく、Session IDが参照するserver-side recordを無効化する必要があります。

読み直す見出し: [Cookie、Session ID、Session Storeを分ける](https://blog.cloudnative.co.jp/articles/authn-authz-03-session-management/)

## AA03-Q2

正解は **C** です。認証前に攻撃者が知り得たIDを認証後も使わせないためにrotationします。

読み直す見出し: [pre-authからauthenticatedへrotationする](https://blog.cloudnative.co.jp/articles/authn-authz-03-session-management/)

## AA03-Q3

正解は **A** です。header観察で分かるのは属性の発行です。browserによる全強制動作やCSRF対策全体までは証明しません。

読み直す見出し: [Cookie属性はheaderで観察する](https://blog.cloudnative.co.jp/articles/authn-authz-03-session-management/)

## AA03-Q4

正解は **B** です。管理側失効は対象subjectのserver-side sessionを無効化し、各requestで拒否できる状態にします。

読み直す見出し: [3つの終了経路を分ける](https://blog.cloudnative.co.jp/articles/authn-authz-03-session-management/)

## AA03-Q5

正解は **C** です。absolute expiryは活動の有無に関係なくsessionの最大寿命を制限します。

読み直す見出し: [absolute expiry](https://blog.cloudnative.co.jp/articles/authn-authz-03-session-management/)
