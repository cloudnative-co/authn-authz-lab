# Lesson 08 Samba AD互換ID基盤 technical design

## 実装範囲

Samba 4.17.12のAD互換Domain ControllerでLDAP/LDAPSとKerberos KDCを実行する。Microsoft AD DSとFreeIPAはruntimeに含めず、GPO、Windows join、FreeIPA固有機能を実証しない。

Docker DesktopのfilesystemはSambaがSYSVOLへ要求するPOSIX ACLを提供しない。このlabはSambaの既存`skip_sysvolacl` pathを使うため、LDAP/Kerberos/JMLの教材であり、SYSVOL/GPOの適合性試験ではない。release前にこのdeviationをruntime evidence、README、記事で同じ表現にする。

## 実行構成

| Service | 責務 | 権限と保存 |
| --- | --- | --- |
| `dc` | domain provision、LDAPS、JML管理、Kerberos KDC | privilegedなし、database/CA/TLS volumeはrunner所有 |
| `app` | LDAPS認証、opaque stable ID、role mapping、in-memory session | non-root、read-only root filesystem、public CAだけread-only mount |
| `client` | `kinit/klist` | non-root、ccacheはtmpfs |

networkは`internal: true`で、host publishは0件である。Docker build時のpackage取得はruntime networkとは別である。

## LDAPSとquery

DC起動時に30日有効のruntime CAと`dc.ad.example.test` SAN付きserver certificateを生成する。appの`ldapts` Clientは`ldaps://dc.ad.example.test:636`へ次を指定する。

- runtime CAを明示trust
- `servername=dc.ad.example.test`
- `rejectUnauthorized=true`
- TLS 1.2以上
- connect timeout 3秒、operation timeout 5秒

authenticationはread-only service principalでbindし、`AndFilter`と`EqualityFilter`によるUPN search、別接続でのresolved user DN simple bind、元のservice接続でのstructured group searchの順で行う。wrong password、unknown principal、空入力ではgroup searchへ進まない。searchはscope、size limit、time limit、attribute listを有界にする。service accountによるAlice属性modifyが`InsufficientAccessError`になるactual probeを持つ。

## stable identity

ADの`objectGUID`をbinary Bufferで取得し、runtime stable-ID keyによるHMAC-SHA-256を`usr_` prefix付きopaque IDへ変換する。session内部では再検索用にbinary GUIDを保持するが、HTTP response、runtime evidence、assessment evidenceへraw GUIDまたはDNを出さない。

MoverはAliceを`OU=People`から`OU=Contractors`へmoveする。このときDNは変わるがobjectGUID由来IDは同じであることをactual revalidationとnew loginで確認する。

## group-to-role mapping

mappingはapplication code内の明示tableである。

| Directory group | Application role |
| --- | --- |
| `CourseAppViewer` | `viewer` |
| `CourseAppEditor` | `editor` |

`Engineering`は組織所属groupでありmapping対象外にする。directory group名をrole文字列として直接採用しない。

## JMLとsession

1. Joiner: Alice作成、Engineering/Viewer追加、LDAPS login、viewer session発行
2. Mover: OU move、Viewer削除、Editor追加
3. Mover直後: 既存sessionはviewerのまま
4. revalidation: objectGUIDで再検索し、location/role差分を検出して旧session失効
5. new login: editor session発行、stable ID一致
6. Leaver: directory account disable、新規LDAPS user bindはgeneric 422
7. Leaver直後: 既存editor sessionは利用可能
8. revalidation: disabled flagを検出して旧session失効

このsequenceはdirectory accountとapplication sessionの責任分界を観察するためのもので、即時event deliveryを実装したとは扱わない。

## Kerberos

clientは同じSamba DCへ`kinit alice@AD.EXAMPLE.TEST`し、`klist`でcanonical principalとTGTの存在をbooleanへ正規化する。ticket、credential cache、password、raw command outputは保存しない。application loginはKerberosではなくLDAPSであり、同じID基盤に複数protocolが束ねられることだけを示す。

## runnerと安全性

shared managed-compose runnerがunique project名、所有label、config digest、container/network/volume record、source/config drift、crash retry、foreign resource非制御を担う。lesson adapterが実行できるservice名、command、exit code、timeout、output上限をallowlistする。passwordはDocker exec stdin、他secretはCompose secretで渡す。

`stop`は所有containerを停止して回答を保持し、`reset`は所有container/network/volumeとworkspaceを再生成する。`purge`は所有確認後だけ削除する。

## 検証範囲

- unit: submission schema、misconception選択、runtime gate、secret非保存、Compose contract
- actual Docker: build、verified LDAPS、read-only write拒否、Joiner/Mover/Leaver、stable ID、session失効、`kinit/klist`
- runner E2E: doctor→setup→demo→observe→check→diagnose→stop→setup→reset→purge
- 未検証: Microsoft AD DS、FreeIPA、GPO、Windows join、複数DC replication、複数OS、human pilot、長期Debian mirror再現性
