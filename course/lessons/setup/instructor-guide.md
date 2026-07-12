# 準備ラボ 講師ガイド

準備ラボの目的は、環境構築を講師の手作業で通過させることではありません。受講者が診断結果を読み、教材stateを安全に初期化・削除できることを確認します。

## 60分の進行例

| 時間 | 内容 |
| ---: | --- |
| 0〜10分 | Node.js 24、取得方法、作業ディレクトリの確認 |
| 10〜20分 | `npm ci`と`doctor` |
| 20〜30分 | `setup`とstate所有権の説明 |
| 30〜40分 | `diagnose`、`reset`、再診断 |
| 40〜50分 | setup checkとevidence ID確認 |
| 50〜60分 | terminal purgeと残存resource 0件確認 |

## 授業前の検証

- 受講者へ配るrevisionを固定する
- 匿名取得経路が利用できることを、未ログイン環境で確認する
- 授業で使うOSとCPU architectureの組み合わせがsupport matrixにあることを確認する
- Node.js 24の導入経路とproxy制約を事前案内する
- clone先がWSL2のLinux filesystem、またはmacOS/Linuxのnative filesystemであることを確認する
- 教室でportやfilesystemを監視するsecurity製品がある場合、教材のloopback processと`.lab/`作成が妨げられないか確認する

support matrixが`candidate`の組み合わせを「対応済み」と説明しません。自動検証、人間pilot、固定revisionが揃った組み合わせだけを授業の正式対象にします。

## 介入ルール

受講者が止まった場合、最初に`reasonCode`と`recovery`を読んでもらいます。講師が代わりにコマンドを実行した場合は予定外介入として記録します。

次の操作で進行させてはいけません。

- 所有確認なしに`.lab/`を再帰削除する
- port番号だけを根拠にprocessをkillする
- lockやmarkerを手作業で書き換える
- Node.jsのversion条件を一時的に無効化する
- `npm install`でlockとの差分を作る

## pilot記録

- `doctor`開始からterminal purgeまでの所要時間
- `reasonCode`の種類と自力復帰時間
- 予定外介入の回数と内容
- checkのstatusとevidence IDの有無
- purgeのstatusと残存resource数

15分以内に自力復帰できない状態、教材外データの削除、安全でない回避操作はblockerです。修正後、同じ初期条件から再pilotします。

氏名、hostname、home path、IP、token、`.lab`内部ファイルはpilot記録へ保存しません。
