# Lesson 07 Kerberos V5 / HTTP Negotiate technical design

## 目的

第07回は[RFC 4120](https://www.rfc-editor.org/rfc/rfc4120.html)のKerberos V5を実装するMIT KDC、client、GSSAPI acceptorを実際に動かし、TGTとHTTP service ticketを区別する。ticketをHMACやJSONで模倣せず、AS、TGS、APの各境界で実protocolの成功と拒否を観察する。HTTP challengeの範囲は[RFC 4559](https://www.rfc-editor.org/rfc/rfc4559.html)と照合する。

## 実行構成

Lesson 07専用Compose fileは次の3 serviceだけを定義する。

| Service | 責務 | 保持するもの |
| --- | --- | --- |
| `kdc` | `EXAMPLE.TEST` realm、AS/TGS、principalとservice keyのprovisioning | KDC database、現行/旧kvno keytab |
| `app` | `HTTP/app.example.test@EXAMPLE.TEST`のGSSAPI acceptor | read-onlyの現行keytab |
| `client` | `kdestroy`、`kinit`、`klist`、`kvno`、`curl --negotiate` | scenarioごとのcredential cache |

Docker baseはdigest、直接導入するDebian packageとnpm packageはversionを固定する。ただしBookwormの通常repositoryは更新されるため、source buildだけで将来の長期再現性まで保証したとは扱わない。固定revisionの継続配布には、検証済みimage digestの配布、またはDebian snapshot repositoryの日時固定を追加のrelease境界とする。

host portは公開せず、clientからCompose内の`http://app.example.test:3000`へ到達する。平文HTTPは隔離network内のtraining deviationであり、productionではTLSを必須とする。

## Principalとsecret

- user principal: `alice@EXAMPLE.TEST`
- TGT service: `krbtgt/EXAMPLE.TEST@EXAMPLE.TEST`
- HTTP service principal: `HTTP/app.example.test@EXAMPLE.TEST`
- GSSAPI libraryへ渡すservice name: `HTTP@app.example.test`

教材passwordはcourse state内の0600 fileからKDCへCompose secretとして渡す。clientの`kinit`にはDocker execのstdinで渡す。passwordをargv、environment、image layer、runtime evidence、logへ置かない。

[MIT Kerberosのkeytab定義](https://web.mit.edu/kerberos/krb5-latest/doc/basic/keytab_def.html)に基づき、service keyは現行kvnoと旧kvnoを別keytabへexportする。appにはactive keytabだけをread-only mountし、file modeは0400とする。旧keytabは不一致の実験時だけKDC側の固定control commandでactiveへ選択し、`finally`で現行へ戻す。

## 正常系の観察

1. `kdestroy -A`で既存cacheを消す。
2. passwordをstdinへ渡して`kinit alice@EXAMPLE.TEST`を実行する。
3. `klist`でTGTを確認する。この時点ではHTTP service ticketは存在しない。
4. Authorizationなしで保護resourceへ到達し、`401`と`WWW-Authenticate: Negotiate`を確認する。
5. `curl --negotiate -u :`でSPNEGO経由のKerberos mechanismを開始する。
6. clientがTGSからHTTP service ticketを取得し、appがkeytabでticketを検証する。
7. `200`と`alice@EXAMPLE.TEST`を確認する。
8. `klist`でHTTP service ticketが追加されたことを確認する。

RFC 4559のexchangeは複数legになり得て、serverは途中の401または最終responseでtokenを返し得る。本lessonが実装するのは、curlが作るKerberos client tokenをGSSAPI acceptorが1 server stepで完了し、必要なfinal acceptor tokenを200へ返す経路だけである。`contextComplete=false`になった場合はcontextを捨てたまま継続を装わず、generic 401で拒否する。boundedなcontinuation context storeは実装しない。NTLMなど他mechanism、複数の401を要する一般的SPNEGO、browser固有の自動送信を実証したとは扱わない。

## 拒否系

各caseでは1条件だけを不正にする。

| Case | 変更する条件 | 拒否位置 | 外部response/evidence | 内部reason |
| --- | --- | --- | --- | --- |
| 未認証 | Authorizationなし | HTTP challenge | `401` + `Negotiate` | `NEGOTIATE_REQUIRED` |
| 誤SPN | `HTTP/missing.example.test` | TGS | HTTP未到達、固定分類 | `SERVICE_PRINCIPAL_UNKNOWN` |
| 時刻ずれ | service ticket取得後のclient processだけ+10分 | AP/GSS accept | generic `401` + `Negotiate` | `CLOCK_SKEW_REJECTED` |
| stale keytab | acceptorだけ旧kvno | AP/GSS accept | generic `401` + `Negotiate` | `GSS_ACCEPT_FAILED` |

host clockは変更しない。時刻ずれは有効なservice ticketを得た後、libfaketimeを付けた`curl` processだけを10分進めてAP exchangeで再現する。commandのraw stderrはclassifier内でのみ照合し、runtime evidenceには固定reason、exit分類、protocol stageだけを残す。

## Negotiate headerとGSSAPI境界

- Authorization headerは12 KiB以下に制限する。
- schemeはcase-insensitive `Negotiate`で、1文字以上のSP/HTABとcanonical Base64 tokenを要求する。
- 空token、不正文字、不正padding、非canonical Base64、末尾余白、oversizeをGSSAPIへ渡さない。
- parser拒否、GSSAPI拒否、keytab不一致は同じgeneric `401` bodyとchallengeを返す。
- token、native error message、keytab path、credential cacheはresponseとdiagnosticsへ出さない。
- このKerberos経路はactual testで1 server step完了を確認する。contextが未完了ならgeneric 401へ閉じ、継続対応を装わない。完了時にserver tokenがあれば200の`WWW-Authenticate`へ返し、final acceptor tokenを捨てない。

## 実行安全性

lesson固有adapterは実行fileとargv配列を分離し、shellを使わない。全commandにtimeout、stdout/stderr合計byte上限、AbortSignalを適用する。`kinit` passwordだけはstdinへ渡し、command result、例外、diagnosticsから除く。

Compose lifecycle、unique project名、ownership label、container IDとconfig digestのrecord、foreign container非制御、stop/reset/purgeはshared runner層へ委ねる。Lesson 07は`kdc`、`app`、`client`が同一managed resourceに属するcontractとservice名だけを宣言する。

## Runtime evidence

保存してよいのは次だけである。

- TGT/service ticketの存在booleanとservice principal種別
- HTTP status、challenge scheme、principalの教材用canonical値
- protocol stageと固定diagnostic reason
- keytabのcurrent/staleという役割とkvno比較boolean
- transport deviation、TLS requirement、redaction boolean

password、Authorization token、server response token、raw keytab、keytab内容、credential cache、raw command output、container ID、Compose project名、install ID、full digestは保存しない。

## 採点

- `AA07-C1`: TGTとHTTP service ticket、401 challenge、200 principal、Kerberos mechanism限定、TLS requirementを確認する。
- `AA07-C2`: 未認証、誤SPN、時刻ずれ、stale keytabの実拒否、generic外部面、固定内部reason、secret非保存を確認する。
- 診断問題は5件中4件以上を必須とし、runtime条件と回答が一致した場合だけ合格する。

## 検証

- unit: header size/grammar/canonical Base64、submission schema、diagnosis scoring、redaction。
- fake Docker: argv、stdin、timeout、output上限、abort、command classifier、service contract。
- actual Docker: build/up後に正常系と4拒否系、keytab復旧、token/password非露出を確認する。
- runner E2E: shared Compose API統合後、doctor→setup→demo→observe→check→diagnose→stop→setup→reset→purgeを確認する。
