# 第13回 解答と根拠

先に`demo`と`observe`を実行し、自分の予測と`runtime.json`を照合してから読んでください。

## AA13-C1 登録

| Field | 正答 | 根拠 |
| --- | --- | --- |
| `userHandle` | `random-64-byte-account-opaque-value` | W3Cはuser handleをPIIにせず、64 random bytesを推奨する。runtimeのbyteLengthは64 |
| `registrationPersistence` | `store-only-after-verification` | challenge不一致の`create()`後もRP credential countは0 |
| `ceremonyAPI` | `create-for-registration-get-for-authentication` | client data typeも`webauthn.create`と`webauthn.get`で分かれる |
| `attestation` | `none-has-no-device-attestation-signature` | `none` formatにdevice attestation signatureはないが、challenge、origin、RP ID hash、UV等は検証する |

## AA13-C2 認証境界

| Field | 正答 | 根拠 |
| --- | --- | --- |
| `challengeOrigin` | `both-bound-and-server-verified` | browserがclient dataへ入れ、RPが保存済み期待値と比較する |
| `rpID` | `browser-scope-and-rp-hash-server-verification` | browserはoriginとの関係を制約し、RPはauthenticator dataのRP ID hashを検証する |
| `assertionSignature` | `verify-with-stored-public-key` | credential IDの存在だけでは認証にならない |
| `transactionReplay` | `single-use-and-expiring` | 成否にかかわらずfinish時に消費し、TTL後も拒否する |

## AA13-C3 解釈と証拠

| Field | 正答 | 根拠 |
| --- | --- | --- |
| `signCount` | `risk-signal-not-clone-proof` | counterの非増加にはclone以外の原因もあり得る |
| `userHandleCheck` | `compare-to-credential-account` | clientが返したuserHandleだけでaccountを決めない |
| `failureSurface` | `generic-client-fixed-internal-reason` | 外部は同じ422、内部はsecretを含まない固定reason |
| `virtualAuthenticator` | `protocol-test-not-hardware-or-user-gesture-proof` | CDPは自動化fixtureであり、実端末の性質を証明しない |

## 登録と認証で検証対象が違う

登録はcredential public keyを取得し、指定したaccountと結びつけるceremonyです。`attestation: none`ではdevice attestation signatureを期待しません。認証ではauthenticator dataとclient data hashへ付いたassertion signatureを、登録済みpublic keyで検証します。

「WebAuthnだから署名を検証する」という一文だけでは、どのceremonyの何の署名か分かりません。実務の設計書ではregistration verificationとauthentication assertion verificationを分けて書きます。

## 実務へ移すときの確認

- productionのRP IDと許可originを固定し、環境ごとに列挙する
- user handleをaccount作成時にrandom生成し、PIIや推測可能なhashを使わない
- registration/authentication transactionにTTLと一回限りの消費を持たせる
- credential recordへaccount ID、public key、counter、transport、backup state、active/revoked stateを持たせる
- genericな外部failureと、秘密を含まない監査reasonを分ける
- browser自動試験に加え、対象OS、browser、authenticator、accessibility、recoveryを人が検証する

