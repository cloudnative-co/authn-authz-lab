# 無支援pilot観察票

このテンプレートは、教材を初めて使う人がREADMEだけで進められるかを確認するための記録票です。参加者へ口頭で手順を補わず、詰まった箇所と自力復帰の可否を教材改善へ戻します。

氏名、メールアドレス、hostname、home path、IPアドレス、password、token、cookie、`.lab`の内容は記録しません。必要な環境情報はversionと対応profileだけに限定します。

## 実施条件

| 項目 | 記録 |
| --- | --- |
| 匿名participant ID |  |
| pilot実施日 |  |
| 配布tagまたは完全commit SHA |  |
| 学習経路 | 読解 / 実習 / 両方 |
| OS / CPU |  |
| Node.js / npm |  |
| Docker / Docker Compose | 不使用の場合は「不使用」 |
| browser | 不使用の場合は「不使用」 |
| network制約 | proxy / VPN / registry制限 / なし |
| 事前に伝えた内容 | README記載事項だけであることを確認 |

## Lesson別記録

Lessonごとに次の表を複製します。`reasonCode`が出なかった項目は「なし」、講師が介入しなかった項目は`0`と記録します。

### Lesson ID: 

| 観察項目 | 記録 |
| --- | --- |
| `doctor`開始時刻 |  |
| `stop`または`purge`完了時刻 |  |
| 予測を実行前に書けたか | yes / no |
| 最初に止まったcommand | 止まらなければ「なし」 |
| `reasonCode` | なし / 表示値 |
| `recovery`を読んで自力復帰できたか | yes / no / 該当なし |
| 自力復帰までの時間 | 分。該当しなければ`0` |
| 予定外の講師介入 | 回数と内容。なければ`0` |
| required check | pass数 / required数 |
| evidence ID | 有 / 無 |
| 読み違えた説明・図・手順 | ファイルと見出し、何に迷ったか |
| training deviationを説明できたか | yes / no / 該当なし |
| 実務へ転用するときの限界を説明できたか | yes / no |

## 終了時の安全確認

| 項目 | 記録 |
| --- | --- |
| 実行した終了command | `stop` / `purge --yes --json` |
| `diagnostics[]`の`id: "resources.remaining"`要素にある`actual` |  |
| 教材外resourceへの操作 | なし / あり（あればblocker） |
| secretや個人情報を記録していない | yes / no |

## 判定

次のいずれかが1件でもあればblockerです。

- READMEだけでは進行不能だった
- 安全でない回避を必要とした
- 教材外のdataまたはresourceを変更・削除した
- 1か所の自力復帰に15分を超えた
- required checkまたはcleanupが完了しなかった
- 図または本文が実際のprotocolや教材実装と矛盾した

| 最終項目 | 記録 |
| --- | --- |
| 判定 | pass / blockerあり |
| blocker ID | 例: `PILOT-01-L09-001`。なければ「なし」 |
| 再現手順 | secretを除く最小手順 |
| 修正対象 | README / 記事 / 図 / runner / support matrix |
| 修正後の再pilot | 未実施 / pass / blockerあり |

この1票だけで教材全体を正式対応へ昇格させません。初学者3名以上、対応予定のOS 2種類以上を満たし、全blockerの修正後に同じ初期条件から再確認します。
