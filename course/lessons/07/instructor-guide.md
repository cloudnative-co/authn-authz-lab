# 第07回 講師ガイド

対象は、第01回の責任境界を説明できる初学者です。第05回のHTTP challengeと第06回のdirectory認証境界は比較材料として使いますが、必須前提ではありません。過去回のruntime stateは不要です。授業時間は90分を想定します。

## 到達目標

- `AA07-O1`: AS、TGS、service、TGT、service ticket、SPN、keytabを役割で区別できる
- `AA07-O2`: 正常系と誤SPN、時刻ずれ、keytab不一致をprotocol stageへ対応づけ、安全な運用条件を説明できる

## 開講可能条件

講師環境と受講者用clean copyで次を確認します。

1. Node 24、Docker CLI、daemon、Compose v2のdoctorがpassする
2. setupがhost portを公開せず、KDC/app/clientの3 serviceだけを所有label付きで起動する
3. `kinit`後はTGTだけ、Negotiate成功後はHTTP service ticketも存在する
4. 未認証401、誤SPNのTGS拒否、10分skewのAP拒否、旧kvno keytabのacceptor拒否が再現する
5. 旧keytab case後に現行keytabへ戻り、200を再確認できる
6. final acceptor tokenをtoken自体を保存せず存在だけで確認し、incomplete contextが0である
7. runtime、evidence、logにpassword、token、keytab、native error、container ID、project名がない
8. stop/reset/purgeが所有resourceだけを扱い、networkとvolumeも残さない

1件でも未確認なら概念解説だけを行い、実習の合否は付けません。

## 時間配分

| 時間 | 内容 | 講師が確認すること |
| ---: | --- | --- |
| 0〜10分 | 登場人物と予測 | AS/TGS/appを混同せず、5 caseを予測した |
| 10〜20分 | setupとdoctor | Dockerを手動操作せずrunnerを使った |
| 20〜30分 | TGT | `kinit`後にHTTP ticketがない理由を説明した |
| 30〜40分 | HTTP Negotiate | 401 challenge、TGS、GSSAPI、200を順に説明した |
| 40〜50分 | 誤SPN | HTTP前のTGS拒否を確認した |
| 50〜60分 | 時刻ずれ | host clockを変えずAP拒否を確認した |
| 60〜70分 | stale keytab | kvno不一致と復旧を確認した |
| 70〜82分 | 提出とfresh check | AA07-C1/C2を満たした |
| 82〜90分 | 実務転用とstop | SPN、TLS、keytab rotationの担当を特定した |
| 90〜105分 | 読解5問 | 4/5以上を確認し、誤答は指定見出しへ戻った |

## 教える境界

### TGTを万能ticketと呼ばない

TGTはTGSへservice ticketを要求するために使います。HTTP serviceは`HTTP/app.example.test`用ticketを受け取ります。`klist`のbefore/afterを並べ、ticket principalの違いを読ませます。

### 401だけで成功を判断しない

401 challengeは開始条件です。clientがtokenを送ったか、TGSがservice ticketを発行したか、acceptorが完了したか、200とprincipalを得たかを分けます。

### 一般的multi-leg SPNEGOを実装したと説明しない

このfixtureはKerberos client tokenを1 server stepでacceptする経路だけです。成功時のfinal acceptor tokenは返しますが、incomplete contextをrequest間で保持しません。NTLMなど別mechanismや複数401のcontinuation、browser自動設定は範囲外です。

### 3拒否系で複数条件を壊さない

- 誤SPN: principal名だけを変える
- 時刻ずれ: ticket取得後のclient process時刻だけを10分進める
- stale keytab: appが読むkeytabだけを旧kvnoへ変える

password、KDC、SPN、時刻、keytabを同時に変えると、どの境界を観察したか判断できません。

### native errorを利用者responseへ出さない

外部はgeneric 401とNegotiate challengeです。運用用diagnosticsは固定reasonだけを残します。token、principal以外のnative message、keytab pathを証跡へコピーしません。

## 採点rubric

| Check | 合格条件 | 典型的な不合格 |
| --- | --- | --- |
| `AA07-C1` | TGT→service ticket、401→200、GSSAPI/keytab、Kerberos限定scope | TGTとHTTP ticketを同一視、JSON ticketと説明、全browser対応を主張 |
| `AA07-C2` | TGS/AP拒否、kvno、復旧、generic response、TLS、redaction、診断4/5 | host clock変更、複数条件破壊、token保存、平文HTTPをproduction承認 |

## 誤答への問い返し

- 「そのticketのservice principalは`krbtgt`ですか、`HTTP/app`ですか」
- 「その失敗requestはHTTP appへ到達しましたか」
- 「passwordと時刻のどちらを変更しましたか」
- 「clientのticket kvnoとappのkeytabは一致していますか」
- 「401 challengeと200 acceptのどちらまで確認しましたか」
- 「その証跡からAuthorization tokenを復元できませんか」

## 復旧と安全

| 状況 | 講師の対応 |
| --- | --- |
| Docker unavailable | doctor reasonを確認し、概念演習へ切り替える |
| service unhealthy | `diagnose`で所有serviceを確認し、手動container削除を避ける |
| stale keytab後も401 | 現行keytab復旧reasonを確認し、resetする |
| secret/token露出 | 共有を止め、実credentialなら失効し、教材stateをpurgeする |
| host時刻を変更した | 直ちに元へ戻し、OS時刻同期を確認してから教材をresetする |

## 授業後に記録するもの

- doctor、build、demo、check、reset、stopの所要時間
- 初回診断得点と誤答したstage
- TGT/service ticket、SPN/hostname、keytab/credential cacheの混同数
- Docker platformとarchitecture、予定外の手動介入
- secret、token、host path、container identityの露出有無

記録にはpseudonymousな受講者ID、固定reason、所要時間だけを使います。
