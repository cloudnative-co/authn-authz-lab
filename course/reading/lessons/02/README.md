# 第02回 読解評価

対象記事: [第02回](https://blog.cloudnative.co.jp/articles/auth-authz-02-password-authentication/)

記事を読んでから、答えを見ずに5問へ回答します。4問以上で合格です。不正解だった問題は指定された見出しへ戻り、根拠を説明できてから再回答します。

この評価は理解を確かめる形成的評価（formative assessment）です。実習を伴うcourse outcomeや実行技能の修了は認定しません。学校・社内研修では講師が指定するまでanswer keyを開きません。

## 問1: AA02-Q1

同じpasswordを同じ方式で2回登録したところ保存表現が異なりました。主な理由はどれですか。

- A. passwordが自動で別文字列になる
- B. hashは毎回復号される
- C. requestごとのsaltが異なる

迷ったら記事の「保存側では何をしているか」へ戻ります。

## 問2: AA02-Q2

login時の照合として適切な処理はどれですか。

- A. 保存済みparameterとsaltで入力を再計算し比較する
- B. 保存hashを復号して比較する
- C. 入力passwordをlogへ出して目視する

迷ったら記事の「照合側では何をしているか」へ戻ります。

## 問3: AA02-Q3

未知identifierと誤passwordで外部応答を同じ422へそろえる主目的はどれですか。

- A. KDF計算を不要にする
- B. account存在の推測材料を減らす
- C. sessionを発行する

迷ったら記事の「実HTTPで成功と拒否を読む」へ戻ります。

## 問4: AA02-Q4

per-identifier rate limitが直接抑える攻撃はどれですか。

- A. database漏えい後のoffline cracking
- B. server backupの暗号化
- C. 同一identifierへのonline試行

迷ったら記事の「onlineとofflineを分ける」へ戻ります。

## 問5: AA02-Q5

分散した多数identifierへの試行でKDF資源が枯渇する問題に追加で必要なのはどれですか。

- A. 全体容量の監視と保護
- B. saltの共通化
- C. 失敗ごとに異なるstatus

迷ったら記事の「onlineとofflineを分ける」へ戻ります。

## 答え合わせ

5問すべてへ回答した後に[解答と根拠](answer-key.md)を開きます。

[読解評価一覧へ戻る](../../README.md)
