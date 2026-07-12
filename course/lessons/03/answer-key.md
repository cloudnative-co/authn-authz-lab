# 第03回 解答と根拠

初回のsubmissionを作成してから参照してください。

## 正答

```json
{
  "schemaVersion": 1,
  "lessonId": "03",
  "answers": {
    "AA03-C1": {
      "browserValue": "raw-opaque-session-token-in-cookie",
      "tokenSize": "256-bit-32-byte",
      "serverStoredValue": "sha-256-token-digest-only",
      "cookieHttpOnly": "enabled",
      "cookieSameSite": "Lax",
      "cookiePath": "/",
      "cookieDomain": "omitted-host-only",
      "loopbackTransport": "secure-disabled-training-deviation-not-production"
    },
    "AA03-C2": {
      "loginRotation": "mandatory-new-token",
      "oldPreAuthToken": "rejected"
    },
    "AA03-C3": {
      "expiration": "absolute-not-sliding",
      "logoutServerEffect": "record-revoked",
      "logoutCookieEffect": "max-age-zero",
      "loggedOutToken": "rejected"
    },
    "AA03-C4": {
      "serverRevocation": "all-authenticated-sessions-for-subject",
      "revokedToken": "rejected"
    }
  }
}
```

## `AA03-C1`: Cookie、Session ID、Store

browserがCookie値として持つのは、32 byteのrandom値をunpadded base64urlにした43文字のopaque Session IDです。serverはraw tokenを保存せず、そのSHA-256 digestをrecordのlookup keyにします。recordにはsubject、status、timestampsが付きます。

Cookieは`HttpOnly; SameSite=Lax; Path=/; Max-Age=...`を持ち、`Domain`を省略してhost-onlyにします。通常は`Secure`も必須です。loopback HTTP demoでだけ`Secure`を外す設定はtraining deviationであり、production承認ではありません。

`HttpOnly`はJavaScriptからの読取りを制限しますが、XSS、CSRF、transport、server側失効を単独ですべて解決しません。`SameSite=Lax`もCSRF対策全体の代わりではありません。

## `AA03-C2`: login rotation

pre-auth recordはsubjectを持ちません。正しいcredentialで主体を確定した後、新しいtokenを生成して、古いpre-auth recordを`revoked`にし、新しいdigestでauthenticated recordを作ります。

この順序により、login前に固定されたtokenをauthenticated sessionへ昇格させません。rotation後の古いtokenは`SESSION_UNAVAILABLE`です。同じpre-auth tokenを使った同時loginは1件だけ成功します。

HTTPではcredential不一致をgeneric `422`、古いtokenを含む利用不能sessionをgeneric `403`として返します。このCookie session APIはHTTP認証方式のchallengeではないため、`WWW-Authenticate`なしの`401`は使いません。

## `AA03-C3`: expiryとlogout

authenticated sessionの期限はlogin成功時刻からのabsolute lifetimeで、requestのたびに延長しません。期限境界に到達するとrecordは`expired`になり、tokenを拒否します。

logoutはserver recordを`revoked`にし、その後のtokenを拒否します。HTTP層では`Max-Age=0`のSet-Cookieでbrowser側Cookieも削除します。server失効は盗まれたcopyを拒否するため、Cookie削除は利用browserが古いtokenを送り続けないために必要です。

logoutは未知、malformed、繰返しtokenに同じ結果を返し、tokenの状態を外部へ区別して開示しません。

## `AA03-C4`: server-side revocation

`revokeSubject`は指定subjectのauthenticated sessionをserver storeで失効します。browserがまだCookieを持ち、有効期限前でも、そのtokenは拒否されます。同時または繰返し実行しても、各active recordを1回だけ失効します。

## 不合格にする誤解

- Cookie、Session ID、Session Storeを同じデータだと説明する
- digest fingerprintをbrowserが送るSession IDだと説明する
- login成功後もpre-auth tokenを使い続けると説明する
- `currentUser`呼出しで期限が延びると説明する
- Cookie削除だけで盗まれたtokenも失効すると説明する
- loopback HTTP設定をproductionで安全と説明する
- `HttpOnly`または`SameSite=Lax`だけでsession保護が完成すると説明する
