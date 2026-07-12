# 第14回 読解評価

対象記事: [第14回](https://blog.cloudnative.co.jp/articles/auth-authz-14-passkey-login/)

記事を読んでから、答えを見ずに5問へ回答します。4問以上で合格です。不正解だった問題は指定された見出しへ戻り、根拠を説明できてから再回答します。

この評価は理解を確かめる形成的評価（formative assessment）です。実習を伴うcourse outcomeや実行技能の修了は認定しません。学校・社内研修では講師が指定するまでanswer keyを開きません。

## 問1: AA14-Q1

Passkeyを最も正確に説明する選択肢はどれですか。

- A. passwordをBase64化したもの
- B. 任意のOAuth scope
- C. discoverableなFIDO credentialを利用する体験・運用を含む呼称

迷ったら記事の「Passkeyをプロトコルの言葉で捉える」へ戻ります。

## 問2: AA14-Q2

username入力前に利用可能なcredentialをauthenticatorが提示できる条件はどれですか。

- A. discoverable credentialとして登録されている
- B. password hashがbrowserにある
- C. SAML metadataがある

迷ったら記事の「ユーザー名なし認証」へ戻ります。

## 問3: AA14-Q3

backup eligibleだが現在backupされていないcredentialの状態はどれですか。

- A. BE=false、BS=true
- B. BE=true、BS=false
- C. BE=true、BS=trueだけ

迷ったら記事の「BEとBSを区別する」へ戻ります。

## 問4: AA14-Q4

RP側でcredentialを失効した後にも別に扱う必要がある状態はどれですか。

- A. 公開鍵algorithm名だけ
- B. 記事タイトル
- C. accountと既存application session

迷ったら記事の「3種類の状態を分ける」へ戻ります。

## 問5: AA14-Q5

端末全喪失に備える復旧設計として適切なのはどれですか。

- A. 事前に複数credentialや強い本人確認付きrecoveryを設計する
- B. 共有passwordを公開する
- C. 失効機能を削除する

迷ったら記事の「実務の復旧設計へ移す」へ戻ります。

## 答え合わせ

5問すべてへ回答した後に[解答と根拠](answer-key.md)を開きます。

[読解評価一覧へ戻る](../../README.md)
