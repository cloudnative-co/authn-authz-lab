<a id="AA06-A1"></a>
# 第06回 読解評価の解答と根拠

先にREADME.mdの5問へ回答してください。4問以上で合格です。不正解は指定見出しへ戻り、理由を言葉にしてから再回答します。

| 問題 | 正解 | 読み直す見出し |
| --- | --- | --- |
| AA06-Q1 | B | LDAP認証を4つの操作へ分ける |
| AA06-Q2 | C | DN、attribute、groupを同じものにしない |
| AA06-Q3 | A | DN、attribute、groupを同じものにしない |
| AA06-Q4 | B | filterは文字列連結で作らない |
| AA06-Q5 | C | 空passwordはLDAPへ送らない |

## AA06-Q1

正解は **B** です。検索権限を持つservice accountでentryを見つけ、そのDNを使う別のsimple bindでpasswordを検証します。

読み直す見出し: [LDAP認証を4つの操作へ分ける](https://blog.cloudnative.co.jp/articles/authn-authz-06-ldap-directory/)

## AA06-Q2

正解は **C** です。DNはtree内のentryを指しますが、renameやmoveで変わり得るため長期不変IDとは限りません。

読み直す見出し: [DN、attribute、groupを同じものにしない](https://blog.cloudnative.co.jp/articles/authn-authz-06-ldap-directory/)

## AA06-Q3

正解は **A** です。group entryのmember attributeがuser DNを含むかを検索します。

読み直す見出し: [DN、attribute、groupを同じものにしない](https://blog.cloudnative.co.jp/articles/authn-authz-06-ldap-directory/)

## AA06-Q4

正解は **B** です。構造化filter APIへ値として渡し、特殊文字の扱いを実装へ委ねます。

読み直す見出し: [filterは文字列連結で作らない](https://blog.cloudnative.co.jp/articles/authn-authz-06-ldap-directory/)

## AA06-Q5

正解は **C** です。unauthenticated・anonymous bindとの混同を避けるため、client生成やnetwork送信より前に拒否します。

読み直す見出し: [空passwordはLDAPへ送らない](https://blog.cloudnative.co.jp/articles/authn-authz-06-ldap-directory/)
