<a id="AA08-A1"></a>
# 第08回 読解評価の解答と根拠

先にREADME.mdの5問へ回答してください。4問以上で合格です。不正解は指定見出しへ戻り、理由を言葉にしてから再回答します。

| 問題 | 正解 | 読み直す見出し |
| --- | --- | --- |
| AA08-Q1 | C | ID基盤は何を束ね、アプリケーションには何が残るのか |
| AA08-Q2 | A | Mover: DNが変わっても同じ人物か |
| AA08-Q3 | B | Leaver: account disableとsession失効は別のイベント |
| AA08-Q4 | C | directory groupをapplication roleへ直接コピーしない |
| AA08-Q5 | A | Mover直後の既存sessionはどうなるか |

## AA08-Q1

正解は **C** です。共通基盤がidentityを束ねても、application固有roleへのmappingとsession・resource認可はapplication側に残ります。

読み直す見出し: [ID基盤は何を束ね、アプリケーションには何が残るのか](https://blog.cloudnative.co.jp/articles/auth-authz-08-ad-freeipa-identity-platform/)

## AA08-Q2

正解は **A** です。rename・moveで変わるDNではなく、namespaceと再利用条件を確認した安定identifierを使います。

読み直す見出し: [Mover: DNが変わっても同じ人物か](https://blog.cloudnative.co.jp/articles/auth-authz-08-ad-freeipa-identity-platform/)

## AA08-Q3

正解は **B** です。新規認証を止めても既存application sessionは別状態なので、失効または再検証が必要です。

読み直す見出し: [Leaver: account disableとsession失効は別のイベント](https://blog.cloudnative.co.jp/articles/auth-authz-08-ad-freeipa-identity-platform/)

## AA08-Q4

正解は **C** です。directory groupとapplication roleは意味とownerが異なるため、明示mappingをレビューします。

読み直す見出し: [directory groupをapplication roleへ直接コピーしない](https://blog.cloudnative.co.jp/articles/auth-authz-08-ad-freeipa-identity-platform/)

## AA08-Q5

正解は **A** です。directory変更とapplication session更新は別eventであり、同期・再検証・失効の契約が必要です。

読み直す見出し: [Mover直後の既存sessionはどうなるか](https://blog.cloudnative.co.jp/articles/auth-authz-08-ad-freeipa-identity-platform/)
