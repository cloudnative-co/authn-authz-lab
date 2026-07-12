# 旧プロトコルfixtureの開発者向け案内

この文書は、教材runnerとは別に残している旧実装を回帰確認する開発者向けです。受講者の開始手順ではありません。

`src/`、`test/02-05-core-auth.test.js`、`test/10-oauth.test.js`以降の旧fixtureは、各プロトコルの回帰testを保持しています。これらは実装済みlessonの代替ではなく、連載の実行証拠、本文図解のruntime evidence、修了判定には使いません。教材としての正は`course/lessons/<id>/`と、そこから実行されるrunnerです。

## Node.jsだけで動く回帰test

```bash
npm ci
npm test
```

旧HTTP serverを手動確認する場合だけ、次を使います。

```bash
npm run start:legacy
```

`src/server.js`は教材runnerが管理する`apps/project-app`とは別物です。同じport 3000を使うため、教材lessonと同時に起動しません。

## Container integration

教材runnerへ統合済みのLDAP、Kerberos、Samba AD、SAMLの統合testにはDocker Composeが必要です。各testが固有のCompose projectを起動して終了時に削除するため、事前の`compose:up`は不要です。

```bash
npm run test:integration
```

rootの`docker-compose.yml`と`test-integration/07-kerberos.test.js`は旧Kerberos fixtureの手動回帰確認用です。これも実行する場合だけ次を使います。root ComposeのLDAPは現在のsecret contractと一致しない旧配線のため`legacy-ldap` profileへ隔離しており、検証には上のLesson 06統合testを使います。

```bash
npm run compose:up
COURSE_TEST_LEGACY=1 npm run test:integration
npm run compose:down
```

`compose:down`は旧fixtureのvolumeも削除します。業務データや既存environmentを流用せず、このrepository専用の検証環境だけで実行してください。

主な構成は次のとおりです。

| Path | 用途 |
| --- | --- |
| `docker/ldap/` | OpenLDAP fixture |
| `docker/kdc/` | MIT Kerberos KDC fixture |
| `docker/kdc-client/` | `kinit`とSPNEGO client fixture |
| `docker/keycloak/` | SAML IdP fixture |
| `docker/samba-ad/` | 任意profileのSamba AD DC fixture |
| `test-integration/` | Container前提の回帰test |

## Browser E2E

WebAuthnとPasskeyの旧E2EにはChromiumが必要です。

```bash
npx playwright install chromium
npm run test:e2e
```

これは教材runnerのsupport matrixとは別の開発者用経路です。browser version、OS、virtual authenticatorの検証結果を教材の対応環境へ自動的に昇格させません。

## 実装方針

- OAuth、OIDC、TOTP、JWTの旧fixtureは主に`node:crypto`を利用する
- LDAP、Kerberos、SAML、WebAuthnのwire処理は`ldapts`、`kerberos`、`@node-saml/node-saml`、`@simplewebauthn/server`などのlibraryへ委ねる
- Container内の固定credential、development mode、簡略化したflowは学習・test専用であり、本番利用しない
- 正式なlessonへ統合するときは、正常系と1条件だけ不正な拒否系、runner lifecycle、evidence redaction、受講者ガイド、解答、講師ガイドを追加する

教材として利用可能な範囲の正は、repository rootの`README.md`、`curriculum/manifest.json`、各`course/lessons/<id>/assessment.yaml`です。
