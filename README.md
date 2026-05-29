# auth-authz-sample-app

「認証認可入門」連載で使う小さなサンプルアプリです。

このリポジトリでは、ひとつの `Mini Project App` を少しずつ育てながら、認証、セッション、認可、SSO、OAuth、Passkey などの位置づけを確認します。

## 目的

- ログインできることと、操作してよいことを分けて考える
- 認証方式が変わっても、アプリ内認可が残ることを確認する
- OAuth や OIDC を「なんとなくログイン」ではなく、役割ごとに分解して見る

## 構成

```text
src/
  auth/
    password.js       IDとパスワード、パスワードハッシュ
    session.js        Cookieで使うSession ID
    authorization.js  プロジェクト単位の認可
    basic.js          Basic認証
    directory.js      LDAP/AD/FreeIPA風のディレクトリ
    kerberos.js       Kerberos風のチケット
    federation.js     SAML/OIDC風の外部IdP連携
    oauth.js          OAuthの認可コードとアクセストークン
    passkey.js        WebAuthn/Passkey風のチャレンジ認証
  data/
    seed.js           サンプルユーザーとプロジェクト
  server.js           最小HTTP API
test/
  auth-flows.test.js  連載の各回に対応する動作確認
```

## 実行

```bash
npm test
npm start
```

サーバーを起動すると、ローカルで `Mini Project App` のAPIを試せます。

```bash
curl -i -X POST http://localhost:3000/login \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"password-alice"}'
```

## 注意

このアプリは学習用です。概念を理解しやすくするため、あえて単純化した実装を含みます。本番利用のためのセキュリティ実装ではありません。
