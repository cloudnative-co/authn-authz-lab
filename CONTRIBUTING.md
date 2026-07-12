# Contributing

このrepositoryは、認証認可の説明と実行結果が一致することを最優先します。正常系が動くだけの変更ではなく、一条件だけ不正な拒否系、証跡の秘匿、初心者の復旧導線まで同じ変更で扱います。

## 開発環境

```bash
node --version
npm ci
npx playwright install chromium
npm test
```

Node.jsは24.xです。依存関係はdirect dependencyもexact version、installは`package-lock.json`を使う`npm ci`を前提にします。

Docker protocol testを変更した場合はDocker DesktopまたはDocker EngineとCompose v2を準備し、次も実行します。

```bash
npm run test:integration
```

## Lesson変更の契約

実行可能なLessonには最低限、次が必要です。

- `README.md`: 前提、予測、実行、観察、回答、check、復旧、限界
- `answer-key.md`: 許可値と根拠。受講前には開かないことを明記
- `instructor-guide.md`: 時間配分、介入ルール、採点、pilot観点
- `assessment.mjs`: required checkを実際のscenarioと回答へ結び付ける
- `scenario.mjs`: 正常系と一条件だけ不正な拒否系
- `runner.mjs`: 共通lifecycleと所有resource管理
- unit / integration / isolated runner E2E

`artifactStatus=implemented`へ変える前に、教材、採点、解答、講師資料、自動検証、手順の参照先がすべて存在することを確認します。正本は`articles/series/auth-authz/curriculum.json`、sample側の生成物は次で同期します。

```bash
node scripts/sync-course-contract.mjs
node scripts/sync-course-contract.mjs --check
```

## Protocol fidelity

- 実protocolを独自JSON、HMAC、関数呼び出しで代用しない
- 発行者、運搬者、検証者、message、署名対象、寿命を一次仕様と照合する
- 負例は一度に一条件だけ変え、どこで拒否したかを固定reasonで確認する
- browserやauthenticatorが必要な境界をNode.jsの関数testだけで実証済みにしない
- training deviationと、本番で追加するTLS、鍵管理、可用性、監視、復旧を明記する
- vendor fixtureの成功を、同じstandardを使う全製品へ一般化しない

## Evidence safety

runtime、journal、evidence、test failureへ、password、Cookie、Token、code、private key、raw assertion、user handle、完全digest、絶対home pathを保存しません。必要なのは固定scenario IDではなく、status、検証boolean、redacted reason、到達段階です。

実在する組織、個人、account、credentialをfixtureへ使わないでください。

## Pull request前

```bash
npm ci
npm test
npm run test:integration
node scripts/sync-course-contract.mjs --check
git diff --check
```

Dockerを使わない変更でintegration testを省略した場合は、未実行理由と影響しない根拠をPull requestへ書きます。human pilotを実施していない変更を「初心者が迷わず完走できる」と表現しません。
