# 第01回 認証・セッション・認可の責任を分ける

実習のみ（1240分）では、準備ラボ完了後にこのガイドを上から進めます。完全コース（1935分）では、対応記事の中でこの実習を一度だけ行い、記事を読み終えた後に[第01回の読解5問](../../reading/lessons/01/README.md)で4問以上を確認します。このガイドは詳細確認に使い、同じcommandを二重実行しません。読解のみ（695分）では実習不要です。

この演習では、10件のHTTPリクエスト事例を読み、失敗または受け入れを直接判断した責任境界を分類します。所要時間の目安は、演習15分、確認15分です。

## この回でできるようになること

- 認証、セッション、認可、フェデレーション、委任認可を、担当する検証処理で区別する
- 1つのリクエストに複数の責任が含まれていても、強調された検証または拒否の直接原因を特定する
- 「ログインできた」と「対象操作が許可された」を別の判断として説明する

## この演習の証拠範囲

課題の10事例は、分類を練習するために教材が用意した有限の事例です。project-appからHTTPで取得しますが、事例内のSAML、OpenID Connect、OAuthの通信を実行して採取したものではありません。

したがって、この回の合格証拠は分類結果と検証責任の対応だけです。実プロトコルが動いた証拠としては使いません。各プロトコルの実行と観察は、そのプロトコルを扱う回で行います。

## 前提

リポジトリのルートで、次のコマンドがすべて成功している必要があります。

```bash
node --version
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
npm ci
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs doctor
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs setup
```

`[PASS]`または`safe-noop`を確認してから、このLessonの予測と個別`doctor`へ進みます。`[BLOCKED]`または`[FAIL]`なら、表示された`reasonCode`と`recovery`を解消し、同じ`setup`を再実行します。

Node.jsは24.xを使います。`doctor`または`setup`が`blocked`になった場合は、第01回へ進まず、表示された`reasonCode`と`recovery`に従います。

## 1. 予測する

実行前に、次の問いへ自分の言葉で答えます。

> 有効なセッションを持つ利用者がプロジェクト削除を拒否された場合、失敗したのは認証、セッション、認可のどこでしょうか。

正答はまだ確認しません。演習後に同じ問いへ戻ります。

## 2. 課題を準備する

```bash
node course.mjs lesson 01 doctor
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 01 setup
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 01 demo
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs lesson 01 observe
```

`[PASS]`を確認してから回答を編集します。失敗時は`check`へ進まず、`reasonCode`と`recovery`を解消して同じ`observe`を再実行します。

`setup`はloopbackの`127.0.0.1`だけでproject-appを起動し、次の2ファイルを作ります。

- `.lab/submissions/01/exercise.json`: 10件の事例と選択肢。変更しない
- `.lab/submissions/01/submission.json`: 自分の回答。こちらを編集する

`setup`を再実行しても回答は上書きされません。最初からやり直す場合だけ、後述の`reset`を使います。

## 3. 10件を分類する

`.lab/submissions/01/submission.json`の各`classification`に、次のいずれかを入力します。

| 値 | 判断する責任 |
| --- | --- |
| `authentication` | 資格情報を検証し、主体を確定する |
| `session` | セッション識別子、期限、失効を検証する |
| `authorization` | 主体、対象、操作、条件から許可または拒否を決める |
| `federation` | 外部の発行者が表明したアイデンティティを検証する |
| `delegated-authorization` | 委任されたアクセストークンと権限範囲を検証する |

1つのHTTPリクエストに複数の責任が残る場合があります。この問題では、事例で強調された検証、または拒否の直接原因を1つ選びます。

## 4. 5つの検証者を対応づける

同じ回答ファイルの`verifiers`で、5つの責任境界へ担当する検証者を割り当てます。使用できる値と説明は`exercise.json`の`verifierOptions`にあります。

ここでは製品名ではなく役割を選びます。たとえば、外部IdPを使う場合でも、受け取った結果を検証して受け入れる責任はアプリ側のリライングパーティに残ります。

## 5. 採点する

```bash
node course.mjs lesson 01 check
```

全required checkが`pass`になるまで、教材processまたはlesson stateを保持します。`fail`の場合は`stop`や`reset`へ進まず、`observe`→回答修正→`check`を繰り返します。

合格条件は次の両方です。

- `AA01-C1`: 10事例中9件以上を正しく分類する
- `AA01-C2`: 5つの責任境界すべてを正しい検証者へ対応づける

`pass`の場合は`evidenceId`が表示されます。保存されるのは点数と到達判定を正規化したダイジェストで、回答内容や実プロトコルの通信ではありません。

`fail`の場合は、点数と未達の条件を確認して回答を直し、同じ`check`を再実行します。

## 6. 予測を見直す

冒頭の問いへ戻ります。有効なセッションを受け入れた後、対象プロジェクトの削除可否で拒否されたなら、直接の失敗箇所は認可です。認証とセッションが成功しても、認可が自動的に成功するわけではありません。

自分が扱うSaaSまたはWebアプリを1つ選び、次の5行を書ければこの回の内容を実務へ移せています。

1. 資格情報を検証するコンポーネント
2. ログイン状態を検証するコンポーネント
3. 対象操作を許可するコンポーネント
4. 外部アイデンティティを受け入れるコンポーネント
5. 委任されたAPI権限を検証するコンポーネント

該当する仕組みがなければ「なし」と書きます。推測で製品名を当てる必要はありません。

## やり直しと終了

回答を初期状態へ戻し、project-appを新しい実行世代で起動し直します。

```bash
node course.mjs lesson 01 reset
```

回答と証拠を残したまま、教材が所有するproject-appだけを停止します。

全required checkの`pass`を確認した後だけ、次の`stop`を実行します。

```bash
node course.mjs lesson 01 stop
```

教材の全stateと内部証拠を削除する場合は、リポジトリのルートで次を実行します。この操作は取り消せません。

```bash
node course.mjs purge --yes --json
```

## 困ったとき

| 状況 | 何を確認するか | 復旧方法 |
| --- | --- | --- |
| `PREREQUISITE_SETUP` | course stateがない | `node course.mjs setup`を実行する |
| Node.jsまたは依存関係で`blocked` | `doctor`の診断 | 表示された`recovery`を実行し、`doctor`を再実行する |
| port 3000を利用できない | 別アプリが使用中か | 別アプリを自分で停止する。教材は所有未確認のprocessを停止しない |
| 回答JSONが不正 | カンマ、引用符、`TODO`、未知の値 | エディタで直す。破棄してよければ`lesson 01 reset`を実行する |
| 中断後に状態が一致しない | `reasonCode`と管理processの状態 | `node course.mjs lesson 01 diagnose`を実行する |
| sourceを変更後にstateを再利用できない | source digestの不一致 | 必要な回答を退避し、`purge --yes`後にsetupし直す |

`purge`が所有権を確認できない状態で止まった場合、`.lab`や他processを手作業で削除しません。診断結果を確認し、教材外のファイルが混ざっていないかを先に調べます。
