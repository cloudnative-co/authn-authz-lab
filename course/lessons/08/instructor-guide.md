# 第08回 講師ガイド

第06回のdirectory bind/searchと第07回のKerberosを区別できる受講者を対象に、90分で実施します。両Lessonのruntime stateは不要です。

## 開講可能条件

clean copyで次を確認します。

1. Node 24、Docker CLI、daemon、Compose v2のdoctorがpassする
2. setupが`dc`、`app`、`client`だけを所有し、host portを公開しない
3. LDAPS healthがruntime CAと`dc.ad.example.test`のhostname検証を通る
4. read-only service accountのwrite probeが`INSUFFICIENT_ACCESS`になる
5. Joiner、Mover、Leaverの全sequenceと`kinit/klist`が再現する
6. runtimeとevidenceにpassword、bind secret、session token、raw objectGUID、DN、container IDがない
7. stop/reset/purgeがforeign resourceへ触れず、purge後のcontainer/network/volumeが0になる

未確認の条件があれば概念演習だけを行い、実習の合否を付けません。

## 時間配分

| 時間 | 内容 | 確認すること |
| ---: | --- | --- |
| 0〜10分 | runtime境界と予測 | Samba、Microsoft AD DS、FreeIPAを同一視しない |
| 10〜20分 | setupとLDAPS | CA、hostname、service accountを説明できる |
| 20〜32分 | Joiner | user、group、login、sessionの順を追う |
| 32〜48分 | Mover | directory変更と既存sessionの時差を説明する |
| 48〜60分 | Leaver | 新規認証拒否と既存session失効を分ける |
| 60〜68分 | Kerberos | 同じ基盤、別のapplication auth経路と説明する |
| 68〜82分 | 回答とfresh check | AA08-C1/C2、診断3/4を満たす |
| 82〜90分 | 実務転用とstop | mapping ownerと失効SLOを特定する |
| 90〜110分 | 読解5問 | 4/5以上を確認し、誤答は指定見出しへ戻る |

## 教える境界

### 製品名から能力を一般化しない

このlabはSambaのAD互換LDAP/Kerberosを動かします。Microsoft AD DS、FreeIPA、GPO、Windows client joinを検証していません。Docker DesktopのPOSIX ACL制約によりSYSVOL ACL provisioningもskipしています。

### objectGUIDを生のままapplicationや証跡へ出さない

directory内のbinary objectGUIDを安定性の根拠にし、applicationではruntime keyによるopaque IDへ変換します。DNとmailはmoveやrenameで変わり得ます。raw GUIDとDNは提出物へコピーしません。

### groupとroleを同一視しない

group membershipはpolicyのinputです。`Engineering`のような組織groupを権限へ直結すると、組織変更が意図しない権限変更になります。明示mappingにはowner、review、change controlが必要です。

### user Bind成功前にgroupを読まない

正常系はservice Bind、structured UPN Search、別接続user Bind、元のservice接続でgroup Searchの順です。wrong password、unknown principal、空入力がgroup Searchへ進まないことを確認します。Search自体をpassword確認と説明しません。

### disableとsession revokeを同一イベントと説明しない

directory disableは新規LDAP bindを止めます。すでにapplicationが発行したsessionはapplicationが管理するため、再検証、event-driven revoke、短いTTL、緊急失効のどれかが必要です。

## 採点

| Check | 合格条件 | 典型的な不合格 |
| --- | --- | --- |
| `AA08-C1` | runtime境界、verified LDAPS、objectGUID由来ID、Kerberos別経路 | 製品一般化、cleartext LDAP、DN/mail key、`kinit`をapp loginと誤認 |
| `AA08-C2` | 明示mapping、read-only service、Mover/Leaver session境界、診断3/4 | group=role、disable=全session即時失効、admin bindが必要と誤認 |

## 誤答への問い返し

- 「その変更はdirectory entryとapplication sessionのどちらへ書かれましたか」
- 「OU moveでDNが変わった後も同じ値だったのは何ですか」
- 「Engineering groupのownerはapplication permissionを意図していますか」
- 「422を返した時点でapplicationのsession storeを確認しましたか」
- 「`kinit`したprocessとLDAPS bindしたprocessは同じですか」

## 授業後の記録

doctor、setup、demo、check、reset、stopの所要時間、誤答分類、Docker platform、予定外の手動介入を記録します。secret、raw identifier、container identityは記録しません。
