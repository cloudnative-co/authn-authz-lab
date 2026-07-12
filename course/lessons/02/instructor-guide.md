# 第02回 講師ガイド

対象は、第01回で認証、session、認可を区別できるようになった初学者です。授業時間は75分を想定します。

## 到達目標

- `AA02-O1`: password登録と照合の処理を、正規化、salt生成、KDF、保存、照合の順に追跡できる
- `AA02-O2`: salt、scrypt work factor、generic failure、rate limitの役割と限界を評価できる

## 開講可能条件

次の全条件を講師環境と受講者用のclean copyで確認します。

1. `doctor → setup → demo → observe → 手編集 → check → stop`がREADMEどおり成功する
2. 意図的な誤答で`AA02-C1`、`AA02-C2`、`AA02-C3`が個別にfailする
3. `reset`が第02回workspaceだけを再作成し、`stop`後に教材所有processが残らない
4. observation、evidence、logに平文password、保存表現全体、derived keyが残らない

1件でも未確認なら、講義で概念説明だけを行い、実習の合否は付けません。

## 時間配分

| 時間 | 内容 | 講師が確認すること |
| ---: | --- | --- |
| 0〜10分 | 前提と予測 | 同じpasswordの保存結果、未知identifierの応答を予測した |
| 10〜25分 | 保存処理 | NFC、random salt、N・r・p、独自形式を順に追える |
| 25〜40分 | 成功・失敗demo | generic 422とsession未発行を区別できる |
| 40〜55分 | rate limit | 3回目、Retry-After、block中の成功試行を確認した |
| 55〜65分 | submissionとcheck | 3 checkすべてがpassする |
| 65〜72分 | online・offline討議 | 制御を攻撃経路へ正しく対応づけた |
| 72〜75分 | stop | 回答を保全し、教材所有processだけを停止した |
| 75〜90分 | 読解5問 | 4/5以上を確認し、誤答は指定見出しへ戻った |

## 実装上の前提

教材既定値は次のとおりです。講師判断で値を変更した場合、その実行結果を既定教材のevidenceとして混在させません。

| 項目 | 教材実装 |
| --- | --- |
| password正規化 | Unicode NFC |
| password policy | 15〜128 Unicode code points |
| KDF | scrypt |
| profile | `N=32768, r=8, p=3`, key 32 byte |
| salt | random 16 byte |
| 保存形式 | application-defined `$course-scrypt$`; not PHC |
| failure threshold | 3回 |
| failure window | 30秒 |
| block | 30秒、per-identifier |
| session | 未発行 |

password policyとKDFのstructural input limitは別です。教材KDFは1〜1024 UTF-8 byteを受け付けますが、利用者向けpolicyは15〜128 code pointsです。「KDFが処理できる」と「登録を許可する」を混同させません。

## 授業で強調する境界

### 保存形式を標準だと呼ばない

`$course-scrypt$`はparameterを安全に再読込する教材独自形式です。PHC String Format互換、製品間portable、標準準拠と説明しません。

### saltと暗号化を混同しない

saltは秘密鍵ではなく、保存表現と一緒に保持する値です。復号用の値ではありません。passwordを暗号化して戻す処理もこの回にはありません。

### onlineとofflineを同じ表で済ませない

rate limitはサービス入口を通るonline試行へ作用します。保存表現を持ち出した攻撃者はその入口を通りません。offline側ではKDFの計算コストとpassword強度が問題になります。

### per-identifierをservice全体の容量保護と呼ばない

同じidentifierの同時requestは直列化されますが、別identifierを大量に使うKDF負荷はglobalには制限しません。教材のrate limitだけで可用性対策が完成したとは教えません。

## 採点rubric

| Check | 合格条件 | 典型的な不合格 |
| --- | --- | --- |
| `AA02-C1` | runtimeでNFC、N・r・p、平文非保存、salt差を確認し、5 fieldが正答 | PHC形式と回答、saltを同一と回答 |
| `AA02-C2` | 成功、generic 422、session未発行を確認し、3 fieldが正答 | 未知identifierだけ別応答、session発行済みと回答 |
| `AA02-C3` | 3回目の429とRetry-Afterを確認し、4 fieldが正答 | rate limitをofflineまたはglobal KDF防御と回答 |

点数の部分合格は設けません。全required checkを満たした場合だけ合格です。回答JSONを講師が代筆した場合は、runtimeが正しくても再提出にします。

## 誤答への問い返し

- 「その制御は攻撃者がサービス入口を通る場合と、保存表現を持ち出した場合のどちらに効きますか」
- 「saltが公開されても、同じpasswordの2 recordが異なるのはなぜですか」
- 「`sessionIssued: false`の後、次回requestで利用者を復元するには何がまだ必要ですか」
- 「100個の異なるidentifierを同時に試されたとき、このqueueは全KDF処理を止められますか」

## 復旧と安全

| 状況 | 講師の対応 |
| --- | --- |
| JSON破損 | templateとfieldを比較する。破棄合意がある場合だけresetする |
| 429が残る | blockの自然解除を待つ。production設定のように説明しない |
| port競合 | 所有者不明processを教材から停止しない |
| secret露出 | 出力共有を止め、実credentialなら変更手順へ移る |

実在するpasswordを入力させません。提出物にはsubmissionの選択値と正規化evidenceだけを含め、terminal履歴、hostname、home path、credential、完全な保存表現を集めません。

## 授業後に記録するもの

- setup、demo、observe、編集、check、stopの所要時間
- 各checkの初回pass率と再提出回数
- online・offlineを逆にした人数
- per-identifierをglobal防御と誤認した人数
- 予定外介入、secret露出、安全でないprocess操作の有無
