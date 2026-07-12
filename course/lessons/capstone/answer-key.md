# Capstone answer key

このanswer keyは、機械判定を通る構造化値の完成例です。JSON全体の完全一致を要求する唯一解ではありません。自由記述の模範解答を機械採点へ流用しません。

## 共通control

### Responsibility

| Field | Value |
| --- | --- |
| identitySource | `hr-source-authoritative` |
| directoryAndCredentialLifecycle | `iam-operations` |
| federationAssertionValidation | `service-provider` |
| apiObjectAuthorization | `resource-server` |
| localSessionLifecycle | `application` |

### Credential lifecycle

| Field | Value |
| --- | --- |
| accountModel | `unique-human-and-workload-identities` |
| joiner | `approved-source-before-provisioning` |
| mover | `recalculate-access-and-revoke-stale-sessions` |
| leaver | `disable-and-revoke-sessions-tokens-authenticators` |
| emergency | `deny-first-then-investigate-with-redacted-evidence` |

### Federation

| Field | Value |
| --- | --- |
| signature | `response-and-assertion` |
| issuer | `exact-entity-id` |
| audience | `exact-sp-entity-id` |
| destinationRecipient | `exact-acs-url` |
| inResponseTo | `response-and-subject-confirmation` |
| time | `conditions-and-subject-expiry` |
| replay | `response-assertion-request-one-time` |

### API authorization

```json
{
  "order": ["token", "scope", "tenant", "object"],
  "invalidToken": "401-invalid-token",
  "insufficientScope": "403-insufficient-scope",
  "crossTenant": "404-concealed",
  "unknownObject": "404-concealed",
  "idToken": "reject-id-token"
}
```

### MFA / Passkey

| Field | Value |
| --- | --- |
| enrollment | `identity-proofed-user-bound` |
| recovery | `strong-reproof-revoke-old-credential` |
| lostDevice | `revoke-credential-and-active-sessions` |
| syncBoundary | `provider-account-not-single-device-proof` |
| factorBoundary | `passkey-origin-bound-totp-not-phishing-resistant` |

### Risk register

次の表は合格する並びの1例です。`risks`配列自体の順序は問いません。`priorityOrder`はCritical 3件をHigh 2件より前に置けば、同じseverity内の順序を入れ替えられます。Highの`disposition`は、riskを閉じられる根拠がある場合の`resolved`と、残存riskをownerが管理する`mitigated`のどちらも合格です。

| Priority | Risk | Severity | Owner | Disposition |
| ---: | --- | --- | --- | --- |
| 1 | R-LEAVER-ACCESS | critical | iam-operations | resolved |
| 2 | R-FEDERATION-SEMANTICS | critical | application | resolved |
| 3 | R-API-OBJECT | critical | application | resolved |
| 4 | R-RECOVERY | high | iam-operations | mitigated |
| 5 | R-SHARED-ADMIN | high | iam-operations | mitigated |

## Developer track

`track`を`developer`、`artifacts.iamOperations`を`not-selected`にします。

```json
{
  "policyMode": "deny-by-default",
  "sessionRevocationHook": "disable-event-revokes-local-sessions",
  "federationAdapter": "strict-sp-initiated-acs",
  "apiPolicy": "token-scope-tenant-object",
  "negativeTests": {
    "invalidToken": "run",
    "samlReplay": "run",
    "crossTenant": "run",
    "leaverSession": "run",
    "weakRecovery": "run"
  }
}
```

JSON objectと`negativeTests`のkey掲載順は採点しません。各設定値と、5 testがすべて`run`であることを個別に判定します。

## IAM operations track

`track`を`iam-operations`、`artifacts.developer`を`not-selected`にします。

```json
{
  "changeControl": "approved-source-event-and-two-person-review",
  "jmlRunbook": [
    "validate-authoritative-event",
    "apply-directory-change",
    "recalculate-access",
    "revoke-stale-sessions-and-tokens",
    "verify-deny-or-required-access",
    "record-redacted-evidence"
  ],
  "emergencyRunbook": [
    "disable-account",
    "revoke-sessions-and-tokens",
    "revoke-authenticators",
    "block-federation-access",
    "verify-deny",
    "preserve-redacted-audit"
  ],
  "recoveryRunbook": [
    "verify-identity-with-strong-channel",
    "revoke-lost-authenticator",
    "enroll-replacement",
    "revoke-active-sessions",
    "notify-and-monitor"
  ],
  "validationProfile": "federation-api-and-session-boundaries",
  "simulations": {
    "invalidToken": "run",
    "samlReplay": "run",
    "crossTenant": "run",
    "leaverSession": "run",
    "weakRecovery": "run"
  }
}
```

上記は合格する順序の1例です。必要stepは各1回だけ含めます。安全な別順として、JMLではauthoritative event確認後の失効をdirectory変更より先にでき、緊急失効では4つのcontainment操作を任意順にできます。Recoveryでは本人確認後、旧authenticator失効とactive session失効の順を入れ替えられます。deny検証より後のcontainment、旧authenticator失効より前のreplacement登録、重複、危険step、必要stepの欠落は不合格です。

完全なJSONは実装から安全に生成できます。

```bash
node --input-type=module -e "import { capstoneAnswerKey } from './course/lessons/capstone/assessment.mjs'; console.log(JSON.stringify(capstoneAnswerKey('developer'), null, 2));"

node --input-type=module -e "import { capstoneAnswerKey } from './course/lessons/capstone/assessment.mjs'; console.log(JSON.stringify(capstoneAnswerKey('iam-operations'), null, 2));"
```

## 合格時のmachine metrics

- scorePercent: 100
- requiredScorePercent: 80
- criticalSkipCount: 0
- criticalFailureCount: 0
- unresolvedCritical: 0
- AA-CAP-C1〜C7: all pass

講師rubricは別採点です。責任分界、tradeoff、残存risk、90日計画の説明を`instructor-guide.md`で確認します。
