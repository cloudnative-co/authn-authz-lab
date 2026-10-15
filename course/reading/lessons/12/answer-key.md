<a id="AA12-A1"></a>
# 第12回 読解評価の解答と根拠

先にREADME.mdの5問へ回答してください。4問以上で合格です。不正解は指定見出しへ戻り、理由を言葉にしてから再回答します。

| 問題 | 正解 | 読み直す見出し |
| --- | --- | --- |
| AA12-Q1 | B | MFAは「確認を2回すること」ではない |
| AA12-Q2 | C | MFAは「確認を2回すること」ではない |
| AA12-Q3 | A | 今回作るのは「登録」と「login」の二つの流れ |
| AA12-Q4 | B | 30秒以内でも同じTOTPを受け入れない |
| AA12-Q5 | C | recoveryを弱い抜け道にしない |

## AA12-Q1

正解は **B** です。MFAは独立したfactor categoryを組み合わせる必要があり、同じ知識factorの反復ではありません。

読み直す見出し: [MFAは「確認を2回すること」ではない](https://blog.cloudnative.co.jp/articles/authn-authz-12-multi-factor-authentication/)

## AA12-Q2

正解は **C** です。serverはaccount passwordと、共有secretを持つauthenticatorが生成したTOTPを検証するため、知識と所持の組合せです。

読み直す見出し: [MFAは「確認を2回すること」ではない](https://blog.cloudnative.co.jp/articles/authn-authz-12-multi-factor-authentication/)

## AA12-Q3

正解は **A** です。利用者のauthenticatorに正しく登録されたことをcode verificationで確認してから有効化します。

読み直す見出し: [今回作るのは「登録」と「login」の二つの流れ](https://blog.cloudnative.co.jp/articles/authn-authz-12-multi-factor-authentication/)

## AA12-Q4

正解は **B** です。有効window内でも一度使ったcounterを記録し、replayを拒否します。

読み直す見出し: [30秒以内でも同じTOTPを受け入れない](https://blog.cloudnative.co.jp/articles/authn-authz-12-multi-factor-authentication/)

## AA12-Q5

正解は **C** です。recovery経路が主認証より弱い恒久的な抜け道にならないよう、一回性と保護、監査が必要です。

読み直す見出し: [recoveryを弱い抜け道にしない](https://blog.cloudnative.co.jp/articles/authn-authz-12-multi-factor-authentication/)
