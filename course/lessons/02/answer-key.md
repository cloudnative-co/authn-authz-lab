# 第02回 解答と根拠

初回のsubmissionを作成してから参照してください。

## 正答

```json
{
  "schemaVersion": 1,
  "lessonId": "02",
  "answers": {
    "AA02-C1": {
      "storedFormat": "application-defined-not-phc",
      "passwordNormalization": "NFC",
      "scryptProfile": "N=32768,r=8,p=3",
      "plaintextStorage": "absent",
      "samePasswordSalts": "different"
    },
    "AA02-C2": {
      "successfulResult": "authenticated-without-session",
      "wrongAndUnknownFailure": "same-generic-422",
      "sessionIssuance": "not-implemented"
    },
    "AA02-C3": {
      "thresholdResponse": "third-failure-429-with-retry-after",
      "offlineGuessingControl": "scrypt-work-factor-and-salt",
      "onlineGuessingControl": "per-identifier-rate-limit",
      "rateLimitScope": "per-identifier-not-global-kdf-defense"
    }
  }
}
```

## `AA02-C1`: 保存と照合

passwordはNFCへ正規化してから、16 byteのrandom saltと`scrypt N=32768, r=8, p=3`でderived keyを作ります。`$course-scrypt$`形式は教材が定義したversion付き保存形式で、PHC String Formatではありません。

同じpasswordでもsaltを毎回生成するため、2件の`saltFingerprint`と保存表現は異なります。observationへ出すのはparameter、salt長、短いfingerprintです。平文、保存表現全体、derived keyは出しません。

## `AA02-C2`: 認証応答

正しいcredentialは`200 AUTHENTICATED`ですが、この回は`sessionIssued: false`です。session管理は第03回の責任です。

誤passwordと未知identifierはいずれも、同じ`422 INVALID_CREDENTIALS`と同じ外部messageを返します。未知identifierではdummy credentialを照合します。これはidentifier存在の直接的な応答差を減らしますが、あらゆるtiming差を消す保証ではありません。`401`はHTTP認証方式のchallengeに使うため、このJSONログイン機能では使いません。

## `AA02-C3`: onlineとoffline

同じcanonical identifierで3回目の失敗に達すると、そのrequestから`429 RATE_LIMITED`と`Retry-After`を返します。block中は正しいpasswordでも照合前に429です。同じidentifierの認証処理を直列化し、同時requestで閾値をすり抜けないようにしています。

この制御はper-identifierのonline rate limitです。次は実装していません。

- 複数identifierを横断するglobal KDF concurrency limit
- 送信元またはdevice単位の制限
- 分散攻撃の集約
- 漏えいした保存表現に対するoffline試行回数制限

offline推測の1回あたりのコストを上げるのはscryptのwork factorで、saltはprecomputationや同一passwordの一括照合を難しくします。どちらもpassword自体の弱さを消しません。

## 不合格にする誤解

- `course-scrypt`をPHC標準形式だと説明する
- rate limitが保存表現漏えい後のoffline推測を止めると説明する
- per-identifier queueがservice全体のKDF容量を保護すると説明する
- 認証成功と同時にsessionが発行されたと説明する
- saltを秘密情報またはpasswordの代わりと説明する
