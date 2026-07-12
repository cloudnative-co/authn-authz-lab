# 第12回 読解評価

対象記事: [第12回](https://blog.cloudnative.co.jp/articles/auth-authz-12-multi-factor-authentication/)

記事を読んでから、答えを見ずに5問へ回答します。4問以上で合格です。不正解だった問題は指定された見出しへ戻り、根拠を説明できてから再回答します。

この評価は理解を確かめる形成的評価（formative assessment）です。実習を伴うcourse outcomeや実行技能の修了は認定しません。学校・社内研修では講師が指定するまでanswer keyを開きません。

## 問1: AA12-Q1

passwordを二回入力する方式がMFAにならない理由はどれですか。

- A. passwordは必ず長い
- B. 同じ知識factorを繰り返している
- C. 二回目は認可だから

迷ったら記事の「MFAは「確認を2回すること」ではない」へ戻ります。

## 問2: AA12-Q2

account passwordとTOTP authenticatorの組合せは、どのfactorを組み合わせていますか。

- A. 知識と知識
- B. 生体と認可
- C. 知識と所持

迷ったら記事の「MFAは「確認を2回すること」ではない」へ戻ります。

## 問3: AA12-Q3

TOTP登録を完了扱いにする前に必要な確認はどれですか。

- A. 利用者が生成したcodeを一度検証する
- B. secretをlogへ保存する
- C. recovery codeを無制限に使う

迷ったら記事の「今回作るのは「登録」と「login」の二つの流れ」へ戻ります。

## 問4: AA12-Q4

同じ有効時間stepのcodeを二度使った場合に必要な処理はどれですか。

- A. 時間内なら何度でも成功
- B. 二度目をreplayとして拒否
- C. passwordなしでadmin化

迷ったら記事の「30秒以内でも同じTOTPを受け入れない」へ戻ります。

## 問5: AA12-Q5

recovery codeの設計として適切なのはどれですか。

- A. 全利用者で共有する
- B. 永続的に平文表示する
- C. single-useで安全に保存し利用時に失効する

迷ったら記事の「recoveryを弱い抜け道にしない」へ戻ります。

## 答え合わせ

5問すべてへ回答した後に[解答と根拠](answer-key.md)を開きます。

[読解評価一覧へ戻る](../../README.md)
