# 第08回 読解評価

対象記事: [第08回](https://blog.cloudnative.co.jp/articles/authn-authz-08-ad-freeipa-identity-platform/)

記事を読んでから、答えを見ずに5問へ回答します。4問以上で合格です。不正解だった問題は指定された見出しへ戻り、根拠を説明できてから再回答します。

この評価は理解を確かめる形成的評価（formative assessment）です。実習を伴うcourse outcomeや実行技能の修了は認定しません。学校・社内研修では講師が指定するまでanswer keyを開きません。

## 問1: AA08-Q1

ID基盤を導入してもapplication側に残る責任はどれですか。

- A. すべてのgroupを無条件にadminへすること
- B. passwordをapplication logへ保存すること
- C. directory groupからapplication roleへの明示mappingとsession管理

迷ったら記事の「ID基盤は何を束ね、アプリケーションには何が残るのか」へ戻ります。

## 問2: AA08-Q2

OU移動でDNが変わる環境の長期identity linkとして優先すべきものはどれですか。

- A. 製品契約で安定性を確認したopaque identifier
- B. DN文字列だけ
- C. 表示名だけ

迷ったら記事の「Mover: DNが変わっても同じ人物か」へ戻ります。

## 問3: AA08-Q3

directory accountをdisableした直後に必要な追加処理はどれですか。

- A. 既存sessionを永久に維持
- B. application sessionの失効・再検証
- C. group名の変更だけ

迷ったら記事の「Leaver: account disableとsession失効は別のイベント」へ戻ります。

## 問4: AA08-Q4

directoryのengineering groupをapplication adminへ対応させる安全な方法はどれですか。

- A. 全group名を同名roleへ自動昇格
- B. clientが送るrole headerを信頼
- C. 明示したallowlist mappingとowner review

迷ったら記事の「directory groupをapplication roleへ直接コピーしない」へ戻ります。

## 問5: AA08-Q5

group変更直後の既存sessionについて正しい説明はどれですか。

- A. session再検証・失効の設計がなければ古い権限を保持し得る
- B. 自動的に必ず最新roleへ変わる
- C. DN変更だけで必ずlogoutする

迷ったら記事の「Mover直後の既存sessionはどうなるか」へ戻ります。

## 答え合わせ

5問すべてへ回答した後に[解答と根拠](answer-key.md)を開きます。

[読解評価一覧へ戻る](../../README.md)
