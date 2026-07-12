# 第01回 講師ガイド

対象は、Webアプリの利用経験はあるものの、認証認可を体系的に学んだことがない受講者です。授業時間は60分を想定します。

## 授業の到達目標

- `AA01-O1`: request事例を5つの責任境界へ分類できる
- `AA01-O2`: 直接判断した検証者を特定できる

この回では実プロトコルの実行能力を認定しません。project-appのHTTP APIは教材の配布と採点に使いますが、SAML、OpenID Connect、OAuthの事例はprovided caseです。

## 時間配分

| 時間 | 内容 | 講師が確認すること |
| ---: | --- | --- |
| 0〜5分 | 前提確認 | Node.js 24、`doctor`、course `setup`が成功している |
| 5〜10分 | 予測 | 有効なsession後の削除拒否をどこへ分類したか |
| 10〜25分 | 10事例の分類 | 1つのrequestに複数責任が残ることを理解している |
| 25〜35分 | 検証者の対応 | 製品名ではなく責任で選べている |
| 35〜45分 | 自動採点と再提出 | 9/10かつ5/5を満たす |
| 45〜55分 | 誤答の討議 | 認証済みと許可済みを分けて説明できる |
| 55〜60分 | 回答保全の確認、stop | resetは回答を破棄してよい場合だけ使い、安全に終了する |
| 60〜75分 | 読解5問 | 4/5以上を確認し、誤答は指定見出しへ戻る |

## 事前準備

授業前に、受講者と同じ配布物で次を実行します。

```bash
npm ci
node course.mjs doctor
node course.mjs setup
node course.mjs lesson 01 setup
node course.mjs lesson 01 observe
node course.mjs lesson 01 reset
node course.mjs lesson 01 stop
node course.mjs purge --yes --json
```

最後のJSONで教材所有resourceが0件であることを確認します。port 3000、ファイル書込権限、Node.js versionが授業環境と一致しない場合は、開始前に解消します。

## 進行上の注意

### 最初に答えを定義で教えない

「認証は誰か、認可は何をしてよいか」という定義だけを暗記させず、`trace-06`のようにセッション成功と操作拒否が同時に現れる事例から責任を分けます。

### 1リクエスト1責任とは教えない

1つのリクエストでセッション検証と認可判断が連続する場合があります。問題は、事例で強調した検証または直接の拒否原因を選ばせています。この限定を説明しないと、複数の正答があるように感じられます。

### provided caseを実測と呼ばない

`trace-07`から`trace-10`を、project-appで実行したSAML、OpenID Connect、OAuthのtraceと説明してはいけません。各プロトコルの実装済み回で得るruntime evidenceと区別します。

### OAuthとOIDCの用途を混ぜない

OIDCのID Tokenを外部アイデンティティの受け入れ、OAuthのAccess Tokenを委任されたAPI権限の受け入れとして分けます。どちらもtokenであることは、用途と検証者が同じことを意味しません。

## 採点rubric

| Check | 合格 | 不合格 | フィードバック |
| --- | --- | --- | --- |
| `AA01-C1` | 10件中9件以上 | 8件以下 | 間違えた事例で、資格情報、session、policy、外部identity、Access Tokenのどれを検証したか確認する |
| `AA01-C2` | 5境界すべて正答 | 1件以上誤答 | 発行者ではなく、受け取って検証する側の責任を確認する |

重大な誤解として、次のいずれかが残る場合は点数にかかわらずdebriefを行います。

- ログイン済みなら全操作を許可してよい
- SSO導入後はアプリ内認可が不要になる
- ID TokenをResource ServerのAPI認可へそのまま使う
- Access Tokenが有効なら全resourceへアクセスできる
- provided caseを実プロトコルの成功証跡とみなす

## 復旧手順

受講者の回答を保全する必要がある場合は、`.lab/submissions/01/submission.json`だけを教材外へコピーしてから操作します。token、process control file、evidence内部ファイルは提出させません。

| 障害 | 講師の対応 |
| --- | --- |
| `doctor`失敗 | `reasonCode`ごとの`recovery`を受講者本人に実行してもらう |
| port競合 | 所有者不明のprocessを教材から停止しない。利用中アプリを受講者が特定して停止する |
| JSON破損 | まず構文を直す。回答を破棄してよい場合だけ`lesson 01 reset`を使う |
| 強制終了後の不整合 | `lesson 01 diagnose`を実行し、復旧不能なら回答を退避してcourse `purge`からやり直す |
| `purge`拒否 | `.lab`を強制削除しない。未知ファイル、symlink、管理processの所有確認結果を調べる |

15分以内に本文と診断出力だけで復帰できない場合は、教材blockerとして記録します。講師が代わりにコマンドを実行して進行した場合も、予定外介入として記録します。

## 授業後に記録するもの

- setup、分類、check、復旧、cleanupの実測時間
- 初回得点と再提出回数
- 誤答した責任境界の種類
- 15分を超えた停止、予定外介入、安全でない操作の有無
- purge結果のstatusと教材所有resource残存数

氏名、hostname、home path、IP、回答本文、tokenはpilot記録へ保存しません。集計にはpseudonymousな参加者IDと正規化した結果だけを使います。
