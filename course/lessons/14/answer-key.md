# 第14回 解答と根拠

先に`demo`と`observe`を実行し、自分の予測を`runtime.json`で検算してから読んでください。

## AA14-C1 usernameなし認証、失効、復旧

| Field | 正答 | 根拠 |
| --- | --- | --- |
| `discoverableCredential` | `empty-allowcredentials-and-returned-userhandle` | RPが先にcredentialを列挙せず、authenticatorの選択結果からmappingする |
| `usernameTiming` | `not-required-before-credential-selection` | browser ceremony開始前のusername入力は不要 |
| `rpRevocation` | `disable-rp-record-private-credential-remains` | RP失効前後でauthenticator credential countは同じ、assertionはRPが拒否 |
| `recovery` | `second-independent-credential-restores-access` | 先に登録した第二credentialでsessionを再発行できる |

## AA14-C2 flagsとaccount lifecycle

| Field | 正答 | 根拠 |
| --- | --- | --- |
| `backupFlags` | `be-is-eligibility-bs-is-current-backup-state` | BEはcredential property、BSは現在state |
| `cloudSyncEvidence` | `virtual-flags-do-not-prove-real-sync` | CDPへ設定したfixture flagであり、providerや端末間同期を実行していない |
| `accountDisable` | `invalidate-sessions-and-reject-new-assertions` | disable後の既存sessionは401、新assertionは422、session countは0 |
| `signCount` | `risk-signal-not-clone-proof` | 0や非増加だけでcloneと断定しない |

## RP失効後に端末へcredentialが残る意味

authenticatorがassertionを生成できることと、RPがaccount accessを許可することは別です。RPはcredential recordのactive state、account state、userHandle mapping、signature、session policyをすべて評価します。

端末側に残ったcredentialは、RPがinactive recordまたはtombstoneを忘れると再登録や監査で混乱を生む可能性があります。削除UI、失効通知、再登録、unknown credential signalingは対象browser/platformの仕様と運用を別途確認します。

## 「同期済み」と言うために足りないもの

BE/BSだけでは次を確認できません。

- どのproviderが管理しているか
- private key materialがどの方式で保護されるか
- どのaccountと端末へ同期したか
- 別端末で実際に認証できるか
- provider account recoveryや退職時にどうなるか
- managed accountとpersonal accountの境界

virtual authenticatorのflagsはparseとpolicy branchの自動試験に限定します。

## productionへ移すときの最低項目

- 2本目を登録する時期と利用者への促し
- credential一覧、名前、最終利用、失効、通知
- account disable時の全session・refresh token・関連credential処理
- 全credential喪失時のidentity proofing、複数承認、待機時間、監査
- 共有端末、端末返却、退職、managed account、BYODのpolicy
- 対象platformごとの同期、cross-device、accessibility、offline failureの実機test

