# 準備ラボ

このラボでは、教材を始める前に環境を診断し、stateの作成、診断、初期化、合格確認、完全削除を1回ずつ行います。所要時間の目安は60分です。

完全コースと実習のみの経路では必須です。`AA-SETUP-C1`〜`AA-SETUP-C3`の全required checkと最後の`purge`確認を完了するまでLesson 01へ進みません。読解のみの経路では実行不要です。

## 前提

- Gitでcloneする場合はGitが使える
- Node.js 24.xが使える
- リポジトリのルートへ書き込める
- 256 MiB以上の空き容量がある

Dockerとブラウザは準備ラボでは使いません。後続回で必要になった時点で、その回の`doctor`が確認します。

## 1. 配布物を準備する

sample root READMEから来た場合、repository取得と`npm ci`は完了しています。同じrepositoryの内側へcloneし直さず、リポジトリのルートにいることだけ確認して「2. stateの変化を予測する」へ進みます。

```bash
test -f course.mjs && test -f package-lock.json
```

終了codeが0なら現在地は正しいです。まだ教材を取得していない場合だけ、教材を置きたい親directoryで次を実行します。

```bash
git clone https://github.com/cloudnative-co/auth-authz-sample-app.git
```

cloneが終了code 0で完了したことを確認してから、取得したrepositoryへ移動します。失敗した場合は、同名directoryの有無、network、Gitのerrorを解消して再実行します。

```bash
cd auth-authz-sample-app
```

`course.mjs`と`package-lock.json`が見えるrepository rootへ移動できたことを確認してから、Node.jsのversionを確認します。

```bash
node --version
```

表示が`v24.`で始まることを確認してから依存関係を入れます。23以前または25以降では進めません。

```bash
npm ci
```

`node --version`が`v24.`で始まることを確認します。23以前または25以降では進めません。`npm install`ではなく、配布物と同じ依存関係を再現する`npm ci`を使います。

## 2. stateの変化を予測する

まだ後続の説明を読まず、次の各commandが教材stateを「作成する」「更新する」「削除する」「変更しない」のどれかをメモします。

| Command | 自分の予測 |
| --- | --- |
| `doctor` |  |
| `setup` |  |
| `reset` |  |
| `purge` |  |

実行後に各節の説明と診断結果を使って予測を見直します。

## 3. 環境だけを診断する

```bash
node course.mjs doctor
```

`doctor`はstateを作らず、Node.js、OSとCPU、依存関係、書込権限、空き容量、WSL2での配置を確認します。`[PASS] course doctor`にならない場合は、表示された`reasonCode`と`recovery`を先に解消します。

## 4. 教材stateを作る

```bash
node course.mjs setup
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs diagnose
```

`setup`はリポジトリ直下の`.lab/`だけを教材stateとして所有します。自分のファイルを`.lab/`へ置きません。`diagnose`が`pass`なら、stateと現在の教材sourceは一致しています。

同じ`setup`を再実行した場合は`safe-noop`になり、既存の学習記録を上書きしません。

## 5. 初期化を練習する

```bash
node course.mjs reset
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs diagnose
```

この`diagnose`はreset後のstate整合性を読み取り専用で診断します。`[PASS]`を確認してから合格確認へ進みます。

`reset`は教材stateの実行世代を進め、後続ラボの一時resourceを初期状態へ戻します。内部evidenceは保持します。

## 6. 合格確認をする

```bash
node course.mjs lesson setup check --json
```

JSONの`status`が`pass`で、`evidenceId`が空でないことを確認します。`AA-SETUP-C1`から`AA-SETUP-C3`が、環境診断、初期化、reset前後の再診断を確認します。

`status`が`fail`なら`purge`へ進みません。表示された未達checkと`reasonCode`を確認し、必要な`doctor`または`diagnose`をやり直してから、同じ`check`を再実行します。3つのrequired checkがすべて`pass`した後だけ次へ進みます。

この後の`purge`で内部evidenceも消えるため、研修の採点システムへ提出する場合は、このJSONを教材外で保持します。

## 7. 完全削除を確認する

```bash
node course.mjs purge --yes --json
```

JSONの`status`が`pass`で、`diagnostics[]`内の`id: "resources.remaining"`である要素の`actual`が文字列`"0"`であることを確認します。`.lab/`が残っていないことも確認します。

`purge`は取り消せません。教材が所有を確認できないファイル、symlink、processがある場合は削除せず停止します。`rm -rf .lab`やport番号だけを使ったprocess停止で回避しません。

## 8. Lesson開始用のstateを作り直す

前節で`diagnostics[]`内の`resources.remaining`が`"0"`で、`.lab/`が存在しないことを確認した後、Lesson 01が使うcourse stateを作ります。

```bash
node course.mjs setup
```

`[PASS]`または`safe-noop`を確認してから次を実行します。

```bash
node course.mjs diagnose
```

この`diagnose`はLesson開始用stateを読み取り専用で診断します。`[PASS]`なら準備ラボは完了です。完全コースは第01回の記事、実習のみはLesson 01受講者ガイドへ進みます。この再`setup`は準備ラボの採点証拠を変更せず、後続Lessonの前提stateだけを作ります。

## 困ったとき

| `reasonCode` | 意味 | 次にすること |
| --- | --- | --- |
| `PREREQUISITE_NODE_VERSION` | Node.jsのmajor versionが違う | Node.js 24へ切り替え、`doctor`を再実行する |
| `PREREQUISITE_DEPENDENCIES` | `npm ci`の結果がない、またはlockと違う | Node.js 24で`npm ci`を実行する |
| `UNSUPPORTED_WSL_WINDOWS_FILESYSTEM` | WSL2からWindows側filesystemを使用している | WSL2のhome配下へcloneし直す |
| `STATE_UNOWNED_ROOT` | `.lab`を教材所有と確認できない | 自分のファイルなら教材外へ退避し、診断に従う |
| `STATE_SOURCE_DRIFT` | setup時と現在のsourceが違う | 元のsourceへ戻すか、必要な成果を退避して`purge`後にsetupする |
| `STATE_INCOMPLETE_TRANSACTION` | 強制終了などで操作が未完了 | `diagnose`の案内に従い、所有確認済みの`purge`からやり直す |
| `LOCK_STALE` | 以前の操作が途中終了した | 教材processが動いていないことを確認し、案内された復旧を実行する |

診断結果だけで15分以内に復帰できない場合は、実行したコマンド、終了コード、`reasonCode`を教材管理者へ共有します。token、home path、`.lab`内部のcontrol fileは共有しません。
