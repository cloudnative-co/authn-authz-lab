<a id="AA13-A1"></a>
# 第13回 読解評価の解答と根拠

先にREADME.mdの5問へ回答してください。4問以上で合格です。不正解は指定見出しへ戻り、理由を言葉にしてから再回答します。

| 問題 | 正解 | 読み直す見出し |
| --- | --- | --- |
| AA13-Q1 | A | 3つの主体と2つのceremony |
| AA13-Q2 | B | challengeはbrowser tabではなくserver transactionに結びつける |
| AA13-Q3 | C | 失敗した登録をRPへ保存しない |
| AA13-Q4 | A | 6つの拒否を1条件ずつ確認する |
| AA13-Q5 | B | 6つの拒否を1条件ずつ確認する |

## AA13-Q1

正解は **A** です。Relying Party、User Agent、Authenticatorが登録と認証のceremonyを構成します。

読み直す見出し: [3つの主体と2つのceremony](https://blog.cloudnative.co.jp/articles/authn-authz-13-fido-webauthn/)

## AA13-Q2

正解は **B** です。challengeはserverが発行し、対象operation・利用者・期限へ結びつけて一度だけ受理します。

読み直す見出し: [challengeはbrowser tabではなくserver transactionに結びつける](https://blog.cloudnative.co.jp/articles/authn-authz-13-fido-webauthn/)

## AA13-Q3

正解は **C** です。全検証が完了する前にcredentialを永続化すると、不正な登録状態が残ります。

読み直す見出し: [失敗した登録をRPへ保存しない](https://blog.cloudnative.co.jp/articles/authn-authz-13-fido-webauthn/)

## AA13-Q4

正解は **A** です。RPはclientDataJSONのoriginを期待値と照合します。他の条件と署名が正しくても、originが不一致なら認証を拒否します。

読み直す見出し: [6つの拒否を1条件ずつ確認する](https://blog.cloudnative.co.jp/articles/authn-authz-13-fido-webauthn/)

## AA13-Q5

正解は **B** です。userHandleはRPのaccountとcredentialを対応づけるopaque値です。保存済みmappingと一致しなければ認証を拒否します。

読み直す見出し: [6つの拒否を1条件ずつ確認する](https://blog.cloudnative.co.jp/articles/authn-authz-13-fido-webauthn/)
