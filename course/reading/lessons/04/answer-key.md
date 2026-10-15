<a id="AA04-A1"></a>
# 第04回 読解評価の解答と根拠

先にREADME.mdの5問へ回答してください。4問以上で合格です。不正解は指定見出しへ戻り、理由を言葉にしてから再回答します。

| 問題 | 正解 | 読み直す見出し |
| --- | --- | --- |
| AA04-Q1 | A | principalが分かることと、操作を許可することは別 |
| AA04-Q2 | B | PEPとPDPの境界を追う |
| AA04-Q3 | C | 403、404、204をstatus番号だけで暗記しない |
| AA04-Q4 | A | BOLAはIDを難しくするだけでは防げない |
| AA04-Q5 | B | 403、404、204をstatus番号だけで暗記しない |

## AA04-Q1

正解は **A** です。principalの確定は認証・sessionの結果であり、操作許可には対象とactionを含む認可評価が必要です。

読み直す見出し: [principalが分かることと、操作を許可することは別](https://blog.cloudnative.co.jp/articles/authn-authz-04-application-authorization/)

## AA04-Q2

正解は **B** です。Policy Enforcement Pointが信頼できる入力を作って判断を呼び、その結果をrequestへ強制します。

読み直す見出し: [PEPとPDPの境界を追う](https://blog.cloudnative.co.jp/articles/authn-authz-04-application-authorization/)

## AA04-Q3

正解は **C** です。存在自体を開示しない契約では、権限不足を404へ畳むことがあります。statusだけで認可実装の安全性は決まりません。

読み直す見出し: [403、404、204をstatus番号だけで暗記しない](https://blog.cloudnative.co.jp/articles/authn-authz-04-application-authorization/)

## AA04-Q4

正解は **A** です。識別子の推測困難性は補助であり、serverは毎回resourceとsubjectの関係を認可しなければなりません。

読み直す見出し: [BOLAはIDを難しくするだけでは防げない](https://blog.cloudnative.co.jp/articles/authn-authz-04-application-authorization/)

## AA04-Q5

正解は **B** です。Lesson 04はHTTP authentication schemeのchallenge-responseではないCookie session APIなので、利用できるsessionがなければ教材契約の403 SESSION_UNAVAILABLEを返します。

読み直す見出し: [403、404、204をstatus番号だけで暗記しない](https://blog.cloudnative.co.jp/articles/authn-authz-04-application-authorization/)
