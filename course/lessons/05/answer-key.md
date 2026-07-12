# 第05回 解答と根拠

初回の`submission.json`を作成し、自分の予測、`demo`、`observe`を終えてから参照してください。

## 正答

```json
{
  "schemaVersion": 1,
  "lessonId": "05",
  "answers": {
    "AA05-C1": {
      "challenge": "401-with-basic-realm-and-utf8",
      "credentialConstruction": "base64-of-utf8-nfc-user-colon-password",
      "success": "200-without-session",
      "requestReuse": "authorization-required-on-every-request"
    },
    "AA05-C2": {
      "transport": "tls-required-loopback-http-training-only",
      "base64Security": "encoding-not-encryption",
      "logging": "omit-header-and-decoded-credentials",
      "adoption": "narrow-controlled-use-only"
    }
  }
}
```

## `AA05-C1`: HTTP交換

### challenge

資格情報がないrequestと、誤passwordのrequestは、どちらも`401`と次のchallengeを返します。

```http
WWW-Authenticate: Basic realm="lesson-05", charset="UTF-8"
```

RFC 9110では、`401`を生成するserverは対象resourceに適用できるchallengeを少なくとも1つ`WWW-Authenticate`へ入れる必要があります。教材はmissing、malformed、未知user、誤passwordの外部応答を同じにし、credentialの存在やparse失敗理由をbodyへ出しません。

### credential construction

教材はuser-idとpasswordをNFCへ正規化し、1文字のcolonで連結し、UTF-8 byte列へ変換してからBase64で表します。`Authorization`へpassword hashを入れる方式ではありません。

RFC 7617ではuser-idにcolonを使えません。最初のcolonより後ろはpasswordです。user-idとpasswordのcontrol characterは不正です。教材はcanonical Base64とfatal UTF-8 decodeも要求します。

### successとrequest reuse

正しい資格情報は`200 BASIC_AUTHENTICATED`です。`Set-Cookie`はなく、server-side sessionも発行しません。その次のrequestから`Authorization`を外すと、再び同じchallenge付き`401`になります。

clientはprotection space内で資格情報を再利用する場合がありますが、それは各requestへ`Authorization`を付ける動作です。serverが最初の成功をsessionへ変換したことにはなりません。

## `AA05-C2`: 安全境界と採否

### transport

Base64は暗号化ではありません。RFC 7617は、TLSのような外部の安全な仕組みと組み合わせない限り、Basic認証を安全な本人確認方式とみなしません。

教材のloopback HTTPはwireを観察するためのtraining deviationです。本番HTTPを承認した証拠にはなりません。

### logging

教材のobservationとevidenceは、次を保存しません。

- `Authorization` header
- user-id
- password
- decode後の`user-id:password`
- 完全なBase64 token

Basic資格情報をdebug logへ出すと、Base64 decodeだけでpasswordが露出します。proxy、APM、trace、error reportも同じ方針で除外する必要があります。

### adoption

Basic認証単体が提供する中心機能は、protection spaceごとにuser-idとpasswordでHTTP requestを認証することです。session logout、MFA、SSO、credential lifecycle、個人単位の監査を自動的に提供しません。

そのため採用は、TLS、secret管理、個別ID、rotation、限定された用途が揃い、強い認証や対話的なsession管理が要件でない範囲に限ります。browser SSOやMFAのdefaultにはしません。

## transient failureを401へ変えない理由

password backendがrate limitを返した場合は`429 RATE_LIMITED`、一時的な容量不足を返した場合は`503 AUTHENTICATION_CAPACITY_EXCEEDED`と`Retry-After`を保ちます。

`401`は新しい、または別の資格情報を提示できるchallengeです。rate limitや一時的な過負荷は資格情報の種類を変える問題ではないため、同じchallengeへ潰しません。

## 不合格にする誤解

- Base64がpasswordを暗号化すると説明する
- 1回成功するとserverがsessionを作り、以後headerなしで通ると説明する
- `401`なのに`WWW-Authenticate`が不要と説明する
- loopback HTTPの成功を本番平文HTTPの承認と説明する
- credentialをdecodeしてlogへ残すことを観察性の向上と説明する
- 共有IDでも個人単位の監査ができると説明する
- Basic認証単体でMFA、SSO、確実なlogoutを満たせると説明する
