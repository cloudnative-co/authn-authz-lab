# 第06回 読解評価

対象記事: [第06回](https://blog.cloudnative.co.jp/articles/auth-authz-06-ldap-directory/)

記事を読んでから、答えを見ずに5問へ回答します。4問以上で合格です。不正解だった問題は指定された見出しへ戻り、根拠を説明できてから再回答します。

この評価は理解を確かめる形成的評価（formative assessment）です。実習を伴うcourse outcomeや実行技能の修了は認定しません。学校・社内研修では講師が指定するまでanswer keyを開きません。

## 問1: AA06-Q1

email入力からuser passwordを検証する典型的な順序はどれですか。

- A. directory adminでpasswordを復号
- B. service bind、user検索、検索結果DNでuser bind
- C. group bindだけ

迷ったら記事の「LDAP認証を4つの操作へ分ける」へ戻ります。

## 問2: AA06-Q2

directory tree内でentryを指す名前はどれですか。

- A. mail attributeだけ
- B. application role
- C. DN

迷ったら記事の「DN、attribute、groupを同じものにしない」へ戻ります。

## 問3: AA06-Q3

groupOfNamesで利用者の所属を探す条件として適切なのはどれですか。

- A. groupのmember attributeとuser DNの一致
- B. user bindの成功だけ
- C. display nameの部分一致だけ

迷ったら記事の「DN、attribute、groupを同じものにしない」へ戻ります。

## 問4: AA06-Q4

LDAP filter injectionを避ける実装はどれですか。

- A. raw入力をfilter文字列へ連結する
- B. 構造化EqualityFilterへ値として渡す
- C. 入力をlogへ保存して許可する

迷ったら記事の「filterは文字列連結で作らない」へ戻ります。

## 問5: AA06-Q5

空passwordを受け取ったclientが最初に行うべき処理はどれですか。

- A. anonymous bindとして成功扱いする
- B. directory adminで再試行する
- C. networkへ送る前に拒否する

迷ったら記事の「空passwordはLDAPへ送らない」へ戻ります。

## 答え合わせ

5問すべてへ回答した後に[解答と根拠](answer-key.md)を開きます。

[読解評価一覧へ戻る](../../README.md)
