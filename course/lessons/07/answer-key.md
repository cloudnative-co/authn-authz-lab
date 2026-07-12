# 第07回 解答と根拠

予測、`demo`、`runtime.json`の確認を終えてから参照してください。

## 正答

```json
{
  "schemaVersion": 1,
  "lessonId": "07",
  "answers": {
    "AA07-C1": {
      "tgt": "present-after-kinit-before-http-service-ticket",
      "serviceTicket": "obtained-from-tgs-for-http-service",
      "challenge": "401-with-www-authenticate-negotiate",
      "acceptor": "gssapi-validates-service-ticket-with-read-only-keytab",
      "scope": "kerberos-mechanism-not-general-spnego-or-browser"
    },
    "AA07-C2": {
      "wrongSpn": "tgs-rejects-unknown-service-before-http",
      "clockSkew": "ap-rejects-offset-client-process-with-host-clock-unchanged",
      "staleKeytab": "acceptor-rejects-kvno-mismatch-with-generic-401",
      "transport": "tls-required-private-http-training-only",
      "evidence": "omit-password-tokens-keytab-native-error"
    }
  },
  "diagnosis": {
    "D1": "tgt-does-not-authorize-the-http-service",
    "D2": "wrong-spn-fails-at-tgs-before-http",
    "D3": "clock-skew-is-ap-time-validation-not-password-failure",
    "D4": "keytab-kvno-mismatch-fails-at-the-acceptor",
    "D5": "negotiate-challenge-does-not-prove-browser-sent-kerberos"
  }
}
```

## AA07-C1: TGTからservice ticketへ

`kinit`後のcacheにはTGTがありますが、HTTP service ticketはまだありません。TGTは、後でTGSへservice ticketを要求するためのticketです。appへ直接提示するHTTP service ticketと同一ではありません。

Authorizationなしのrequestへappは`401`と`WWW-Authenticate: Negotiate`を返します。`curl --negotiate`はKDCのTGSから`HTTP/app.example.test@EXAMPLE.TEST`用ticketを取得し、GSSAPIがkeytabで検証します。成功responseは`200`と`alice@EXAMPLE.TEST`です。

このfixtureのKerberos acceptは1 server stepで完了します。final acceptor tokenがあれば200の`WWW-Authenticate`へ返します。一方、continuation contextを保存しないため、`contextComplete=false`ならgeneric 401で拒否します。一般的なmulti-leg SPNEGOや全browserを実装したとは扱いません。

## AA07-C2: 3つの拒否位置

誤SPNは、存在しないservice principalをTGSへ要求するためHTTPへ到達する前に拒否されます。これはappのpassword不一致ではありません。

時刻ずれは、有効なTGTとservice ticketを得た後、`curl` processだけを10分進めます。host clockもpasswordも変えず、AP authenticatorの時刻検証で拒否されます。

stale keytabではclient側のTGT取得は成功しますが、appのkeytabにservice ticketのkvnoに合う鍵がないためGSSAPI acceptorが拒否します。外部responseは未認証や時刻ずれと同じgeneric 401です。内部diagnosticsだけが`ACCEPTOR_KEY_MISMATCH`へ分類し、その後に現行keytabへ戻して200を再確認します。

## 5件の診断

1. TGTはTGSへservice ticketを要求する根拠であり、HTTP serviceの認証完了そのものではありません。
2. 誤SPNはTGS段階なのでHTTP handlerへ到達しません。
3. この時刻ずれcaseはAPの時刻検証であり、password hash比較ではありません。
4. keytabの旧kvnoでは現行service ticketを復号・検証できません。
5. challengeを見ただけでは、browser設定、選択mechanism、token送信、accept完了を証明できません。

## 秘匿とtransport

runtimeとevidenceにはpassword、Authorization token、final acceptor token、keytab、native errorを残しません。diagnostic reasonは固定分類だけです。

隔離Compose networkの平文HTTPはprotocol観察用のdeviationです。productionではTLS、時刻同期、SPN一意性、keytabの最小権限とrotation、browser/client設定を別途保証します。

