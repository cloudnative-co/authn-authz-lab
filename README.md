# auth-authz-sample-app

「認証認可入門」連載で使う小さなサンプルアプリです。

このリポジトリでは、ひとつの `Mini Project App` を少しずつ育てながら、認証、セッション、認可、SSO、多要素認証、OAuth、Passkey などの位置づけを確認します。

## 目的

- ログインできることと、操作してよいことを分けて考える
- 認証方式が変わっても、アプリ内認可が残ることを確認する
- OAuth や OIDC を「なんとなくログイン」ではなく、役割ごとに分解して見る

## 構成

```text
src/
  auth/
    password.js       IDとパスワード、パスワードハッシュ（PBKDF2）
    session.js        Cookieで使うSession ID
    authorization.js  プロジェクト単位の認可
    basic.js          Basic認証（RFC 7617）
    base32.js         Base32エンコード/デコード（RFC 4648 §6）
    totp.js           TOTP / HOTP（RFC 6238 / 4226）
    jwt.js            RS256 JWT の署名・検証（RFC 7519、node:crypto のみ）
    oauth.js          OAuth 2.0 認可サーバー（RFC 6749 / 7636 / 6750 / 9068 / 7662）
    oidc.js           OpenID Connect OP（OIDC Core / Discovery、RS256 ID Token）
    ldap.js           LDAP bind/search 認証（RFC 4511、ldapts）
    spnego.js         Kerberos/SPNEGO acceptor（RFC 4559、kerberos npm・遅延読込）
    saml.js           SAML 2.0 SP（@node-saml/node-saml、XML-DSig 検証はライブラリ委譲）
    passkey.js        WebAuthn/Passkey風のチャレンジ認証（Phase Cで差し替え予定）
  data/
    seed.js           サンプルユーザー・プロジェクト・OAuthクライアント
  server.js           最小HTTP API
docker/
  ldap/               OpenLDAP slapd（debian bookworm、seed.ldif）
  kdc/                MIT Kerberos KDC（debian trixie、EXAMPLE.TEST）
  kdc-client/         kinit + curl --negotiate 演習用クライアント
  app/                Node アプリ（libkrb5 + ネイティブ kerberos モジュール）
  keycloak/           Keycloak 26.7.0 realm（SAML IdP）
  samba-ad/           Samba AD DC（08 演習用・profile "ad"）
docker-compose.yml
test/                 コンテナ不要（npm test）
  02-05-core-auth / 10-oauth / 11-oidc / 12-totp / 13-14-legacy / 15-api-authorization
  interop/            openid-client（認定RP）/ otpauth との相互接続テスト
test-integration/     docker compose 前提（npm run test:integration）
  06-ldap / 07-kerberos / 09-saml
test-support/http.js  テスト用のHTTPヘルパー（node --test の対象外）
```

OAuth / OIDC / TOTP / JWT は追加のランタイム依存なし（`node:crypto` のみ）で実装しています。LDAP / Kerberos / SAML は「バグ＝脆弱性」に直結するワイヤ処理（BER/ASN.1・GSSAPI・XML-DSig）を実務標準ライブラリ（`ldapts` / `kerberos` / `@node-saml/node-saml`）に委譲します。準拠性は相互接続テスト（自前 OP ⇔ OpenID Certified な openid-client、自前 TOTP ⇔ otpauth、SP ⇔ Keycloak）で担保します。

## 必要環境

| 章 | 必要環境 |
|---|---|
| 01–05, 10–12, 15（パスワード〜OAuth/OIDC/TOTP/API認可） | **Node 24 のみ**（`npm test`） |
| 06 LDAP / 07 Kerberos / 09 SAML | **+ Docker**（`npm run compose:up` → `npm run test:integration`） |
| 08 Active Directory（Samba AD DC） | **+ Docker**（`docker compose --profile ad up`、演習のみ） |
| 13–14 WebAuthn / Passkey | Phase C（ブラウザ）で置換予定 |

## 実行（コンテナ不要）

```bash
npm install
npm test        # 02-05 / 10-12 / 15 / 13-14 legacy / interop（コンテナ不要）
npm start

curl -i -X POST http://localhost:3000/login \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"password-alice"}'

# client_credentials で RFC 9068 準拠の JWT アクセストークンを取得
curl -i -X POST http://localhost:3000/oauth/token \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d 'grant_type=client_credentials&client_id=report-app&client_secret=report-app-secret&scope=project:read'
```

## 実行（コンテナが必要な章：06 / 07 / 09）

```bash
npm run compose:up          # docker compose up -d --build --wait（ldap/kdc/app/kdc-client/keycloak）
npm run test:integration    # 06 LDAP / 07 Kerberos / 09 SAML
npm run compose:down        # docker compose down -v
```

### 06 LDAP（OpenLDAP・実 bind/search）

```bash
# 実 slapd への bind と属性検索（ホストの ldapts から）
LDAP_URL=ldap://localhost:1389 node -e "import('./src/auth/ldap.js').then(m=>m.authenticateWithDirectory({url:'ldap://localhost:1389',baseDn:'dc=example,dc=test',bindDn:'cn=admin,dc=example,dc=test',bindPassword:'admin-password',email:'alice@example.com',password:'password-alice'})).then(console.log)"
```

### 07 Kerberos（MIT krb5 KDC + SPNEGO）

```bash
docker compose exec kdc-client sh -c \
  'echo password-alice | kinit alice@EXAMPLE.TEST && curl --negotiate -u : http://app.example.test:3000/kerberos/me'
# => {"principal":"alice@EXAMPLE.TEST"}
# AS/TGS 交換の観察: KRB5_TRACE=/dev/stdout kinit alice@EXAMPLE.TEST
```

### 09 SAML（Keycloak IdP、SP-initiated）

- Keycloak 管理コンソール: <http://localhost:8085/admin/>（admin / admin、realm `example`）
- IdP メタデータ: <http://localhost:8085/realms/example/protocol/saml/descriptor>
- SP-initiated ログイン: アプリを SAML 設定付きで起動し `GET /login/saml`（302 → Keycloak）。`DEBUG_SAML=1` で ACS 受信時に SAMLResponse XML をログ出力。フル SSO はブラウザ演習。

### 08 Active Directory（Samba AD DC・演習のみ）

```bash
docker compose --profile ad up -d --build samba-ad
docker compose exec samba-ad samba-tool user list
docker compose exec samba-ad samba-tool user create dave 'Passw0rd!'
docker compose exec samba-ad bash -c 'echo Passw0rd! | kinit Administrator@AD.EXAMPLE.TEST && klist'
docker compose exec samba-ad ldbsearch -H /var/lib/samba/private/sam.ldb '(sAMAccountName=alice)' dn
```

FreeIPA は Docker Desktop での動作要件（systemd / cgroup v2）が未検証のため compose に含めません。公式手順は [freeipa-container](https://github.com/freeipa/freeipa-container) を参照してください。

## 注意

**このアプリは教材専用です。本番利用は禁止します。** 実プロトコル（OAuth 2.0 / OIDC / TOTP など）のワイヤ形式を「コードで見える」ようにするための最小実装であり、認可サーバー・OP は OpenID 認定を受けていません。本番では oidc-provider や IDaaS など認定・実績のある実装を使ってください。学習の都合であえて簡略化した箇所（認可エンドポイントの同意画面省略、refresh_token 未実装、鍵ローテーション非対応など）があります。

XML-DSig（SAML）・GSSAPI（Kerberos）・BER/ASN.1（LDAP）は自作すると「バグ＝認証バイパス脆弱性」に直結するため（xml-crypto CVE-2025-29775 / samlify CVE-2025-47949 が実例）、実務標準ライブラリに委譲しています。コンテナ（Keycloak `start-dev` / Samba AD DC / slapd / KDC）はいずれも **学習用構成**で、認証情報も固定のサンプル値です。本番運用は不可です。
