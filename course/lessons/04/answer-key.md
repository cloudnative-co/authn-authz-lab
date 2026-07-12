# 第04回 解答と根拠

初回のsubmissionを作成し、自分の予測と`runtime.json`を確認してから参照してください。

## 正答

```json
{
  "schemaVersion": 1,
  "lessonId": "04",
  "answers": {
    "AA04-C1": {
      "sessionFailure": "generic-403-without-challenge",
      "principalSource": "cookie-session-only",
      "authorizationAttributes": "project-core-source-of-record",
      "callerClaims": "ignored",
      "unauthenticatedAudit": "absent"
    },
    "AA04-C2": {
      "ownerDelete": "allowed-204-and-resource-removed",
      "viewerDelete": "denied-403-and-resource-preserved",
      "decisionMutationAudit": "atomic-single-transaction"
    },
    "AA04-C3": {
      "concealmentPolicy": "outsider-cross-tenant-missing-repeat-same-404",
      "bolaDefense": "project-core-rechecks-subject-resource-relation"
    },
    "AA04-C4": {
      "auditFields": "subject-resource-action-decision-status-reason-only",
      "auditSecrets": "absent",
      "retention": "bounded-64",
      "decisionCoverage": "six-policy-decisions"
    }
  }
}
```

## `AA04-C1`: PEPと信頼する入力

`project-app`はCookie sessionを解決し、成功時だけprincipalを`project-core`へ渡します。Cookieがない、壊れている、期限切れ、失効済みという内部差は、同じ`403 SESSION_UNAVAILABLE`にまとめます。このAPIはHTTP認証challengeを使わないため`WWW-Authenticate`を返しません。

未認証requestはPEPで止まり、`project-core`へ到達しないためpolicy auditも増えません。`x-principal-id`、`x-project-role`、`x-tenant-id`は無視します。tenantとroleは`project-core`のsubject、project、membershipから求めます。

## `AA04-C2`: ownerとviewer

Aliceは`p-100`のownerなので削除を許可し、bodyなしの`204`を返します。project削除と`allow/204` auditは同じsynchronous transactionでcommitされます。

Bobは同じtenantのviewerなのでprojectの存在は認識できますが、削除actionは許可されません。`403`を返し、projectを残し、`deny/403` auditだけをcommitします。偽装したowner headerは結果を変えません。

許可なのに削除されない、拒否なのに削除される、decisionだけ記録されない、という中間状態はcommitできません。

## `AA04-C3`: resource秘匿とBOLA

Carolは同じtenantでも`p-100`のmemberではなく、Daveは別tenantです。どちらにもprojectの存在を開示せず、存在しない`p-999`、削除済み`p-100`と同じ`404 PROJECT_NOT_FOUND`を返します。

IDが推測できることと、resourceを操作できることは別です。`project-core`はrequestごとにprincipalとresourceの関係をsource of recordで再確認するため、URLのproject IDやbrowser申告roleだけでは操作できません。

## `AA04-C4`: auditの最小化と上限

runtime scenarioでは、認証後にviewer、outsider、missing、cross-tenant、owner、repeatの6 policy decisionが記録されます。未認証拒否は含みません。

各entryは`subject`、`resource`、`action`、`decision`、`status`、`reason`の6 fieldだけです。password、identifier、Cookie、Session ID、control token、request header全体は保存しません。保持上限は64件で、超過時は古いentryから落とします。

auditをboundedかつredactedにしても、アクセス制御、保存先暗号化、保持期間、監視、改ざん対策が不要になるわけではありません。このmemory実装は永続監査基盤ではありません。

## 不合格にする誤解

- `401`を`WWW-Authenticate`なしで返すと回答する
- callerが送ったprincipal、role、tenantをsource of recordより優先する
- viewerの削除を許可する、または拒否時にもprojectを消す
- outsider、別tenant、missingへ異なるresponseを返す
- URLのIDが分かればresource操作を許可できると説明する
- password、Cookie、Session ID、request header全体をauditへ残す
- auditを無制限にmemoryへ保持する
- この教材の`403`と`404`の選択を、すべてのAPIへ無条件に適用する
