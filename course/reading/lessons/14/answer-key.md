<a id="AA14-A1"></a>
# 第14回 読解評価の解答と根拠

先にREADME.mdの5問へ回答してください。4問以上で合格です。不正解は指定見出しへ戻り、理由を言葉にしてから再回答します。

| 問題 | 正解 | 読み直す見出し |
| --- | --- | --- |
| AA14-Q1 | C | Passkeyをプロトコルの言葉で捉える |
| AA14-Q2 | A | ユーザー名なし認証 |
| AA14-Q3 | B | BEとBSを区別する |
| AA14-Q4 | C | 3種類の状態を分ける |
| AA14-Q5 | A | 実務の復旧設計へ移す |

## AA14-Q1

正解は **C** です。PasskeyはWebAuthn/FIDOのdiscoverable credentialを基盤に、同期や利用体験を含めて語られるものです。

読み直す見出し: [Passkeyをプロトコルの言葉で捉える](https://blog.cloudnative.co.jp/articles/authn-authz-14-passkey-login/)

## AA14-Q2

正解は **A** です。discoverable credentialならRP IDなどに基づいてauthenticator側から候補を見つけられます。

読み直す見出し: [ユーザー名なし認証](https://blog.cloudnative.co.jp/articles/authn-authz-14-passkey-login/)

## AA14-Q3

正解は **B** です。BEはbackup可能性、BSは現在backup済みであることを示す別のflagです。

読み直す見出し: [BEとBSを区別する](https://blog.cloudnative.co.jp/articles/authn-authz-14-passkey-login/)

## AA14-Q4

正解は **C** です。credential、account、sessionは別状態なので、一つの失効が他を自動的に無効化するとは限りません。

読み直す見出し: [3種類の状態を分ける](https://blog.cloudnative.co.jp/articles/authn-authz-14-passkey-login/)

## AA14-Q5

正解は **A** です。第二credential、組織管理のrecovery、失効と監査を事前に設計し、弱い恒久fallbackを避けます。

読み直す見出し: [実務の復旧設計へ移す](https://blog.cloudnative.co.jp/articles/authn-authz-14-passkey-login/)
