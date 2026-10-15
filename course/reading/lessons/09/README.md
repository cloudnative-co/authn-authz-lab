# 第09回 読解評価

対象記事: [第09回](https://blog.cloudnative.co.jp/articles/authn-authz-09-saml-sso/)

記事を読んでから、答えを見ずに5問へ回答します。4問以上で合格です。不正解だった問題は指定された見出しへ戻り、根拠を説明できてから再回答します。

この評価は理解を確かめる形成的評価（formative assessment）です。実習を伴うcourse outcomeや実行技能の修了は認定しません。学校・社内研修では講師が指定するまでanswer keyを開きません。

## 問1: AA09-Q1

SP-initiated SSOでbrowserがIdP認証後にSPへ運ぶものはどれですか。

- A. Resource Server向けBearer tokenだけ
- B. HTTP-POSTされたSAMLResponse
- C. LDAP bind password

迷ったら記事の「実KeycloakのSSOを最後まで通す」へ戻ります。

## 問2: AA09-Q2

ACS検証がすべて成功した後にSPが発行するものはどれですか。

- A. KDCのTGT
- B. directory admin password
- C. application session

迷ったら記事の「SAMLResponseとapp sessionは別物」へ戻ります。

## 問3: AA09-Q3

実Keycloakの正常系と、一条件を変えた拒否caseの証拠を扱う方法はどれですか。

- A. actual正常系と明示したfixture拒否を区別する
- B. 同じものとしてactualと呼ぶ
- C. 拒否caseを省略する

迷ったら記事の「actual正常系と拒否fixtureを混ぜない」へ戻ります。

## 問4: AA09-Q4

有効な署名だけ確認したSAML Assertionを受け入れてはいけない理由はどれですか。

- A. 署名は常に平文だから
- B. issuer、Audience、Destination、期限などの文脈も一致が必要
- C. Assertionにはsubjectがないから

迷ったら記事の「署名だけでは足りない」へ戻ります。

## 問5: AA09-Q5

同じSAMLResponseを二度ACSへ送った場合に必要な結果はどれですか。

- A. 二つのsessionを必ず発行
- B. 署名を外して受理
- C. 二度目をreplayとして拒否

迷ったら記事の「署名だけでは足りない」へ戻ります。

## 答え合わせ

5問すべてへ回答した後に[解答と根拠](answer-key.md)を開きます。

[読解評価一覧へ戻る](../../README.md)
