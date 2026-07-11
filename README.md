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
    directory.js      LDAP/AD/FreeIPA風のディレクトリ（Phase Bで実装差し替え予定）
    kerberos.js       Kerberos風のチケット（Phase Bで差し替え予定）
    federation.js     SAML風の外部IdP連携（Phase Bで差し替え予定）
    passkey.js        WebAuthn/Passkey風のチャレンジ認証（Phase Cで差し替え予定）
  data/
    seed.js           サンプルユーザー・プロジェクト・OAuthクライアント
  server.js           最小HTTP API
test/
  02-05-core-auth.test.js   パスワード / セッション / 認可 / Basic 認証
  10-oauth.test.js          認可コード + PKCE、Bearer 保護リソース
  11-oidc.test.js           Discovery / JWKS / ID Token / alg none 拒否
  12-totp.test.js           RFC 6238 Appendix B テストベクタ
  15-api-authorization.test.js  client_credentials / introspection / scope
  auth-flows.test.js        06-09, 13-14（概念モデル、Phase B/Cで置換予定）
  interop/                  openid-client（認定RP）/ otpauth との相互接続テスト
test-support/http.js        テスト用のHTTPヘルパー（node --test の対象外）
```

OAuth / OIDC / TOTP / JWT は追加のランタイム依存なし（`node:crypto` のみ）で実装しています。準拠性は `test/interop/` の相互接続テスト（自前 OP を OpenID Certified な openid-client で叩く、自前 TOTP と otpauth の出力一致）で担保します。openid-client と otpauth は `devDependencies`（テスト専用）です。

## 実行

```bash
npm install   # 相互接続テスト用の devDependencies を取得
npm test
npm start
```

サーバーを起動すると、ローカルで `Mini Project App` のAPIを試せます。

```bash
curl -i -X POST http://localhost:3000/login \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"password-alice"}'

# client_credentials で RFC 9068 準拠の JWT アクセストークンを取得
curl -i -X POST http://localhost:3000/oauth/token \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d 'grant_type=client_credentials&client_id=report-app&client_secret=report-app-secret&scope=project:read'
```

## 注意

**このアプリは教材専用です。本番利用は禁止します。** 実プロトコル（OAuth 2.0 / OIDC / TOTP など）のワイヤ形式を「コードで見える」ようにするための最小実装であり、認可サーバー・OP は OpenID 認定を受けていません。本番では oidc-provider や IDaaS など認定・実績のある実装を使ってください。学習の都合であえて簡略化した箇所（認可エンドポイントの同意画面省略、refresh_token 未実装、鍵ローテーション非対応など）があります。
