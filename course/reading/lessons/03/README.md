# 第03回 読解評価

対象記事: [第03回](https://blog.cloudnative.co.jp/articles/authn-authz-03-session-management/)

記事を読んでから、答えを見ずに5問へ回答します。4問以上で合格です。不正解だった問題は指定された見出しへ戻り、根拠を説明できてから再回答します。

この評価は理解を確かめる形成的評価（formative assessment）です。実習を伴うcourse outcomeや実行技能の修了は認定しません。学校・社内研修では講師が指定するまでanswer keyを開きません。

## 問1: AA03-Q1

serverがlogout後に無効化すべき中心的な状態はどれですか。

- A. browserの表示履歴だけ
- B. server-side session record
- C. password hash

迷ったら記事の「Cookie、Session ID、Session Storeを分ける」へ戻ります。

## 問2: AA03-Q2

認証成功時にSession IDを更新する主な理由はどれですか。

- A. Cookieを暗号化する
- B. passwordを長くする
- C. session fixationを防ぐ

迷ったら記事の「pre-authからauthenticatedへrotationする」へ戻ります。

## 問3: AA03-Q3

Set-CookieにHttpOnlyがあることから、この教材が直接証明できる範囲はどれですか。

- A. serverがHttpOnly属性を発行したこと
- B. browserが全状況で強制したこと
- C. CSRFが完全に防げること

迷ったら記事の「Cookie属性はheaderで観察する」へ戻ります。

## 問4: AA03-Q4

利用者の全sessionを管理側から止めたいときの処理はどれですか。

- A. 現在のtabのCookieだけ消す
- B. subjectに紐づくserver-side sessionを失効する
- C. absolute expiryを延長する

迷ったら記事の「3つの終了経路を分ける」へ戻ります。

## 問5: AA03-Q5

利用が続いていても設定時刻で必ず終了する期限はどれですか。

- A. idle timeout
- B. Cookie path
- C. absolute expiry

迷ったら記事の「absolute expiry」へ戻ります。

## 答え合わせ

5問すべてへ回答した後に[解答と根拠](answer-key.md)を開きます。

[読解評価一覧へ戻る](../../README.md)
