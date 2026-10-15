# 第04回 読解評価

対象記事: [第04回](https://blog.cloudnative.co.jp/articles/authn-authz-04-application-authorization/)

記事を読んでから、答えを見ずに5問へ回答します。4問以上で合格です。不正解だった問題は指定された見出しへ戻り、根拠を説明できてから再回答します。

この評価は理解を確かめる形成的評価（formative assessment）です。実習を伴うcourse outcomeや実行技能の修了は認定しません。学校・社内研修では講師が指定するまでanswer keyを開きません。

## 問1: AA04-Q1

利用者Aliceのidentityが確定していても削除可否を決めるために追加で必要なのはどれですか。

- A. subject、resource、action、contextの評価
- B. 再度passwordを保存すること
- C. Cookie名だけの確認

迷ったら記事の「principalが分かることと、操作を許可することは別」へ戻ります。

## 問2: AA04-Q2

requestを受けてpolicy判断を呼び、結果を強制する境界はどれですか。

- A. password store
- B. PEP
- C. IdP metadata

迷ったら記事の「PEPとPDPの境界を追う」へ戻ります。

## 問3: AA04-Q3

resource存在を権限のない利用者へ秘匿する設計で使い得るstatusはどれですか。

- A. 201
- B. 101
- C. 404

迷ったら記事の「403、404、204をstatus番号だけで暗記しない」へ戻ります。

## 問4: AA04-Q4

UUIDのような推測しにくいresource IDを使えばBOLA対策が完了する、という説明の問題はどれですか。

- A. 各requestのownership・tenant認可が残る
- B. UUIDは必ず短い
- C. HTTPではUUIDを送れない

迷ったら記事の「BOLAはIDを難しくするだけでは防げない」へ戻ります。

## 問5: AA04-Q5

利用できるCookie sessionがないLesson 04のAPI requestについて、この教材が定める応答はどれですか。

- A. 401とBasic challenge
- B. 403 SESSION_UNAVAILABLE
- C. 204 No Content

迷ったら記事の「403、404、204をstatus番号だけで暗記しない」へ戻ります。

## 答え合わせ

5問すべてへ回答した後に[解答と根拠](answer-key.md)を開きます。

[読解評価一覧へ戻る](../../README.md)
