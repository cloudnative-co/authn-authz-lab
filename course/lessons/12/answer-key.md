# 第12回 解答と根拠

予測、`demo`、`runtime.json`の確認を終えてから参照してください。

## 正答

```json
{
  "schemaVersion": 1,
  "lessonId": "12",
  "answers": {
    "AA12-C1": {
      "enrollmentGate": "password-before-secret-provisioning",
      "provisioning": "otpauth-ecosystem-uri-with-rfc6238-parameters",
      "confirmation": "current-code-required-and-counter-consumed",
      "applicationSession": "issued-only-after-second-factor"
    },
    "AA12-C2": {
      "replay": "accepted-counter-rejected-on-reuse",
      "invalidSurface": "wrong-expired-and-replayed-are-generic",
      "throttling": "account-level-rate-limit-with-retry-after",
      "evidence": "passwords-secrets-codes-and-tokens-omitted"
    },
    "AA12-C3": {
      "factorClassification": "totp-is-possession-of-a-shared-secret",
      "phishingResistance": "totp-is-not-phishing-resistant",
      "recoveryCode": "single-display-high-entropy-hash-and-single-use",
      "strongerChoice": "prefer-webauthn-when-phishing-resistance-is-required"
    }
  }
}
```

## AA12-C1: 登録とsession gate

secretを匿名で配ると、どのaccountへ誰がfactorを追加したのか保証できません。教材はpasswordを再確認し、短命なenrollment transactionを作ってからsecretを表示します。

`otpauth://`はauthenticator連携で使われるURI conventionです。TOTP計算のRFC 6238がQR URIを標準化したわけではありません。教材はURIのsecret、issuer、algorithm、digits、periodを実際にparseし、RFC 6238実装へ渡します。

secretを表示しただけでは登録完了にしません。現在のTOTPが一致して初めて、利用者が同じsecretを持つことを確認できます。確認に使ったcounterは成功済みとして保存するため、同じ30秒内のcodeを直後のloginへ再利用できません。

password成功時に発行するのはpre-auth transactionです。`passwordStepSessionIssued=false`であり、TOTPまたはrecovery code成功後だけapplication sessionを発行します。

## AA12-C2: replay、generic response、rate limit、redaction

短時間有効と一回限りは別です。RFC 6238は、成功したOTPの2回目を受け入れないよう求めています。教材はfactorごとの最後の成功counterを保持し、同じcounter以下を拒否します。

誤値、期限切れ、replayは内部原因が異なりますが、外部は同じ`422 INVALID_SECOND_FACTOR`です。利用者へfactor stateやclock driftを細かく漏らさず、運用側はsecretを含まない固定event typeで診断します。

6桁のonline guessingを時間切れだけへ任せません。subject単位で失敗を数え、threshold到達時は`429 SECOND_FACTOR_RATE_LIMITED`と`Retry-After`を返します。pre-authを取り直してもaccount単位のcountは残ります。

保存証跡にはpassword、secret、provisioning URI、TOTP、recovery code、cookie/token、digest、full counterを入れません。これらをdebug用に残すと、教材の観察資料が認証突破用のcredentialになります。

## AA12-C3: factor強度とrecovery

TOTPは、authenticatorが共有秘密を保持していることを示す所持factorです。生体factorではありません。また、利用者がsiteへ値を入力するため、偽siteによるreal-time relayをprotocol自身では防ぎません。したがってphishing-resistantとは評価しません。

recovery codeは通常loginと同じ強度でaccount accessへ到達し得ます。教材は十分にrandomなcodeを一度だけ表示し、salt付きdigestだけを保存し、成功後は使用済みにします。実務ではこれに加えて本人確認、承認、通知、既存session失効、factor reset監査が必要です。

phishing耐性が要件ならWebAuthnを優先します。ただしTOTP利用者の移行、device loss、accessibility、support、例外期限も同時に設計します。

## runtime fieldとの対応

| 回答 | 主な根拠 |
| --- | --- |
| enrollment gate | `enrollment.passwordGateStatus`、`passwordGateSessionIssued` |
| provisioning | `enrollment.provisioningUri` |
| confirmation | `confirmationStatus`、`replayedConfirmationStatus` |
| application session | `passwordStepSessionIssued`、`applicationSessionStatus` |
| replay | `replayedConfirmationStatus`、`state.replayStateStored` |
| generic failure | `expiredStatus`、`wrongStatus`、`genericBodiesEqual` |
| throttling | `rateLimitStatus`、`retryAfterSeconds` |
| evidence | `redaction` |
| recovery | `recoveryFirstStatus`、`recoveryReplayStatus`、`recoveryCodesUsed` |
| phishing resistance | `limitations.phishingResistant` |
