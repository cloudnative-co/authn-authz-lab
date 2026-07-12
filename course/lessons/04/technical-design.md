# Lesson 04 project-core technical design

## 目的

第01回の `trace-05` と `trace-06` を、提供ケースではなく実際に状態が変わるdomainとして実装する。第04回の境界は次のとおり固定する。

- `project-app` はPEPであり、Cookie sessionからprincipalを確定し、利用可能なsessionがなければgeneric 403で止める
- `project-core` はproject resource、policy binding、認可判断、mutationの唯一のSoR/PDPである
- PEPからroleやtenantを受け取って認可せず、確定済みprincipalの `id` だけを入力に使う
- ownerのdeleteだけを許可し、policy判断、実delete、監査追記を1つの同期transactionで確定する

この文書の実装範囲はdomain/store/auditに加え、Cookie sessionから入力を縮退するHTTP PEPとlesson runnerへの接続までを含む。外部database、分散transaction、browser UIは扱わない。

## 継続データ

| Tenant | Subject | 名前 | `p-100` との関係 |
| --- | --- | --- | --- |
| `t-100` | `user-100` | Alice | owner |
| `t-100` | `user-200` | Bob | viewer |
| `t-100` | `user-300` | Carol | same-tenant outsider |
| `t-200` | `user-400` | Dave | other-tenant user |

`p-100` は `t-100` のprojectである。project-coreが保持するpolicy bindingを正とし、呼び出し側が提示した `tenantId` や `role` は判断に使わない。

## Domain API

factoryは `createLesson04ProjectCore({ maxAuditEntries?, seed? })` である。通常の教材では既定seedを使う。

### `deleteProject(input)`

同期APIであり、Promiseを返さない。

```js
core.deleteProject({
  principal: { id: 'user-100' },
  resourceId: 'p-100',
})
```

- `principal.id` はPEPが認証済みsessionから確定したcanonical subject IDでなければならない
- `resourceId` はcanonical project IDでなければならない
- principalに付随するidentifier、tenant、role、credential、session情報は認可入力や監査へコピーしない
- principalがない呼び出しは契約違反として `TypeError` にする。project-coreはHTTP statusを製造せず、PEPだけが外部responseを決める

### `observe()` と `readAudit()`

教材のcontrol面だけが使う観察APIである。`observe()` はprojectと実装境界、`readAudit()` はbounded auditのcopyを返す。返却値を変更してもSoRは変わらない。PEPの通常responseには含めない。

### `reset()`

既定seedへ戻し、auditも空にするcontrol操作である。業務上のdelete判断ではないため、reset自体はpolicy auditへ記録しない。

## HTTPとPolicyのstatus contract

このlessonのJSON APIは、第03回から継続するCookie sessionを使い、HTTP認証方式のchallengeは使わない。Cookieがない、壊れている、期限切れ、失効済みの場合、PEPは`403 SESSION_UNAVAILABLE`を返し、project-coreを呼ばない。`WWW-Authenticate`は返さない。

有効なsessionを持つviewerは、対象の存在を知っているmemberなので`403 PROJECT_DELETE_FORBIDDEN`とする。same-tenant outsider、other-tenant、未知subject、存在しないproject、削除済みprojectは、resourceの存在を隠すため同じ`404 PROJECT_NOT_FOUND`とする。`401`は`WWW-Authenticate`を伴うHTTP認証challengeのstatusであり、第05回のHTTP Basic認証で実行する。browser向けの対話的な画面ならlogin画面へのredirectも設計候補だが、このJSON APIのresponseとは混ぜない。

## Policy contract

actionは `project:delete` に固定する。effective contextであるsubject tenantとproject membershipはproject-core内のSoRから組み立てる。

| 条件 | status | mutation | 公開response | audit reason |
| --- | ---: | --- | --- | --- |
| Alice ownerが `p-100` を削除 | 204 | delete | `PROJECT_DELETED` | `project-owner` |
| Bob viewerが `p-100` を削除 | 403 | なし | `PROJECT_DELETE_FORBIDDEN` | `insufficient-project-role` |
| Carol outsiderが `p-100` を削除 | 404 | なし | `PROJECT_NOT_FOUND` | `resource-concealed` |
| Daveが `p-100` を削除 | 404 | なし | `PROJECT_NOT_FOUND` | `resource-concealed` |
| 存在しないproject、未知subject、削除済みproject | 404 | なし | `PROJECT_NOT_FOUND` | `resource-concealed` |

存在秘匿対象はstatus、code、message、audit reasonを同一にする。通常responseから「存在するが別tenant」「同じtenantだが非member」「存在しない」を区別できない。

## 原子性

storeはcopy-and-commit transactionを使う。

1. 現在のproject mapとaudit stateからdraftを作る
2. draft内でsubject/resourceを取得し、policyを判定する
3. allowの場合だけdraftのprojectを削除する
4. 同じdraftへ監査を1件追記する
5. callbackが同期完了し、監査が正確に1件であることを確認した後、root stateを1回だけ差し替える

監査のvalidation失敗、callback例外、Promise返却、監査未記録ではcommitしない。したがって「削除済みだが監査なし」と「監査はallowだが未削除」の中間状態を外部から観察できない。

## Audit contract

各policy判断は次の6項目だけをentryへ残す。

- `subject`
- `resource`
- `action`
- `decision`
- `status`
- `reason`

credential、password、session token、cookie、identifier、control secret、呼び出し側が提示したtenant/roleは残さない。entryは最大件数を必須設定とするring相当のFIFOで、上限超過時は最古のentryを落とし、件数だけを `droppedEntryCount` に残す。

## ファイル責務

- `services/project-core/domain.mjs`: 継続seed、ID制約、policy評価
- `services/project-core/audit-log.mjs`: audit entry validation、redaction境界、bounded retention
- `services/project-core/store.mjs`: 同期transaction、実mutation、reset、detached snapshot
- `services/project-core/service.mjs`: domain APIと公開responseの組み立て
- `services/project-core/index.mjs`: 後続integrationが使うexport境界
- `apps/project-app/lessons/04/http-handler.mjs`: Cookie sessionを確定し、`principal.id`と`resourceId`だけへ縮退してproject-coreを呼ぶPEP
- `test/lesson-04/pep-boundary.test.js`: identifier、role、tenant、認証contextがPEP境界を越えないことを固定する契約test

## 検証範囲

unit/adversarial testでowner/viewer/outsider/other-tenant、二重delete、tenant/role spoof、resource enumeration、監査redaction、transaction rollback、bounded audit、reset、複数instanceの分離、観察copyの改変耐性を確認する。PEP境界testはrich principalを持つsession serviceとspy project-coreを実HTTP handlerへ注入し、coreへ渡る値が`principal.id`と`resourceId`だけであることを確認する。HTTP統合testはCookieなしの403、実Set-Cookie/Cookie、response bodyを、runner E2Eはprocess lifecycleを確認する。browserによるCookie属性の強制動作、外部database、分散transactionは検証範囲外である。
