# 第13回 読解評価

対象記事: [第13回](https://blog.cloudnative.co.jp/articles/auth-authz-13-fido-webauthn/)

記事を読んでから、答えを見ずに5問へ回答します。4問以上で合格です。不正解だった問題は指定された見出しへ戻り、根拠を説明できてから再回答します。

この評価は理解を確かめる形成的評価（formative assessment）です。実習を伴うcourse outcomeや実行技能の修了は認定しません。学校・社内研修では講師が指定するまでanswer keyを開きません。

## 問1: AA13-Q1

WebAuthn ceremonyの三主体はどれですか。

- A. RP、browser、authenticator
- B. KDC、TGS、LDAP
- C. Client、SMTP、DNS

迷ったら記事の「3つの主体と2つのceremony」へ戻ります。

## 問2: AA13-Q2

challengeを安全に扱う方法はどれですか。

- A. 固定文字列を全利用者で共有する
- B. server-side transactionへ期限・一回性付きで結びつける
- C. client回答だけを信頼する

迷ったら記事の「challengeはbrowser tabではなくserver transactionに結びつける」へ戻ります。

## 問3: AA13-Q3

origin検証に失敗したregistration responseの扱いはどれですか。

- A. 保存して後で検証する
- B. admin credentialとして保存する
- C. credentialを保存せず拒否する

迷ったら記事の「失敗した登録をRPへ保存しない」へ戻ります。

## 問4: AA13-Q4

clientDataJSONのoriginがRPの期待値と異なる、それ以外は正しく署名されたassertionの扱いはどれですか。

- A. 認証を拒否する
- B. originをRP IDに書き換えて成功にする
- C. userHandleがあればsessionを発行する

迷ったら記事の「6つの拒否を1条件ずつ確認する」へ戻ります。

## 問5: AA13-Q5

認証時に返ったuserHandleが、credential IDに対応する保存済みaccountと一致しない場合の処理はどれですか。

- A. 表示名が同じなら成功にする
- B. account mappingの不一致として拒否する
- C. email addressに変換して保存する

迷ったら記事の「6つの拒否を1条件ずつ確認する」へ戻ります。

## 答え合わせ

5問すべてへ回答した後に[解答と根拠](answer-key.md)を開きます。

[読解評価一覧へ戻る](../../README.md)
