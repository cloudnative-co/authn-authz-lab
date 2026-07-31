# 認証認可入門 サンプルアプリ

CloudNative BLOGsの連載「認証認可入門」で使う、実習・自動採点付きの教材です。ひとつのMini Project Appを題材に、認証、セッション、認可、フェデレーション、委任認可を順番に学びます。

このREADMEは、初めてcloneする受講者の開始地点です。上から順に実行してください。

講師として授業を準備する場合は[講師ガイド](docs/instructor-guide.md)、初学者検証には[無支援pilot観察票](docs/pilot-observation-template.md)、エラーから安全に復旧する場合は[共通トラブルシュート](docs/troubleshooting.md)も参照してください。

## 現在利用できる範囲

| Lesson | 内容 | 状態 | 実行証拠の範囲 |
| --- | --- | --- | --- |
| setup | 環境診断、state lifecycle、復旧 | candidate | doctor、setup、reset、purge |
| 01 | 5つの責任境界と10事例の分類 | candidate | provided caseの分類。SAML、OIDC、OAuthのruntime evidenceではありません |
| 02 | password保存、照合、rate limit | experimental | loopback上の実HTTPとfresh scenario |
| 03 | Cookie、rotation、expiry、logout、失効 | experimental | 実`Set-Cookie` / `Cookie`。browserの属性強制は未検証 |
| 04 | Cookie sessionからのproject認可 | experimental | 実HTTP、403/404、BOLA拒否、atomic audit |
| 05 | HTTP Basic challenge-response | experimental | 実401/200と`WWW-Authenticate`。TLSはtraining deviation |
| 06 | LDAP bind、search、DN、group | experimental | runner所有の実OpenLDAP、実HTTP fresh scenario、ACL拒否、lifecycle。TLSはtraining deviation |
| 07 | Kerberos V5、HTTP Negotiate | experimental | 実MIT KDC、`kinit` / `klist` / `kvno`、GSSAPI acceptor、誤SPN・clock skew・旧keytab拒否 |
| 08 | AD互換ID基盤、JML | experimental | 実Samba AD互換DC、verified LDAPS、opaque ID、role mapping、Joiner / Mover / Leaver |
| 09 | SAML 2.0 Web Browser SSO | experimental | 実Keycloak loginから署名済みPOST Response、strict ACS、app session、11件の拒否境界 |
| 10 | OAuth 2.0 Authorization Code + PKCE | experimental | 分離した三originの実HTTP、opaque token、introspection、六つの拒否境界 |
| 11 | OpenID Connect | experimental | 実Discovery/JWKS/RS256 ID Token、全条件検証後のapp session、六つの一条件拒否 |
| 12 | TOTPによるMFA | experimental | RFC 6238 TOTP、登録確認、pre-auth、replay・rate limit、single-use recovery code |
| 13 | FIDO / WebAuthn | experimental | 実Chromium `create/get`、RP検証、失敗時非保存、challenge・origin・RP ID・署名・replay・userHandle拒否 |
| 14 | Passkey lifecycle | experimental | discoverable login、RP側失効、第二credential復旧、BE/BS、account・session失効 |
| 15 | OAuth API認可 | experimental | RFC 8707 resource、RFC 9068 JWT Access Token、JWKS、scope、tenant・object認可 |
| capstone | 統合設計・運用演習 | experimental | developer / IAM operationsの2 track、7 check、重大拒否test、講師rubric |

`candidate`と`experimental`はどちらも正式releaseではありません。自動test済みでも、人間pilot、固定revision、全support profileの実機確認は未完了です。授業や公開教材として採用する前に、`curriculum/manifest.json`と`curriculum/support-matrix.json`の状態を確認してください。

`curriculum/manifest.json`で`planned`のLessonは、現時点では開始しません。個別のintegration testが成功しても、対応Lessonが完成したことにはなりません。

## 学習経路

| 経路 | 順序 | 標準時間 | 修了範囲 |
| --- | --- | ---: | --- |
| **完全コース（推奨）** | 準備ラボ→各記事を上から読みながら記事内実習を1回→読了後に5問で4問以上→Capstone | **1935分** | 読解と実行の両方 |
| 読解のみ | 記事01〜15→各回5問で4問以上 | 695分 | 概念理解。実行技能は認定しない |
| 実習のみ | 準備ラボ→Lesson 01〜15→Capstone | 1240分 | lab submissionとrequired checkで確認する実行技能 |

完全コースと実習のみの経路では、60分の[準備ラボ](course/lessons/setup/README.md)と`AA-SETUP-C1`〜`AA-SETUP-C3`を省略できません。完全コースでは各記事を上から読み、記事内の予測、lab lifecycle、required checkを一度だけ実行します。記事を読み終えた後に読解5問で4問以上を確認し、最後にCapstoneを完了します。Lesson guideは同じ実習の詳細版であり、完全コースで記事とguideを二重実行しません。発展課題765分はどの標準時間にも含めません。

完全コース1935分は、準備60分、記事455分、読解5問240分、実習700分、実習採点240分、Capstone 240分の合計です。実習のみ1240分は、準備とCapstoneを含みます。各活動を一度だけ数えた人間pilot前の設計見積もりであり、pilot後に補正します。授業配布前に完全commit SHAまたはrelease tagへ固定し、`course-lock.json`の`sourceRevision`が未設定のまま配布しません。

## コードを動かさず読解だけで進める

[読解評価の一覧](course/reading/README.md)から第01回の記事を読み、各回5問へ回答します。4問以上でその回は合格です。不正解は指定された記事見出しへ戻ります。この経路は概念理解の形成的評価であり、実習checkや実行技能の修了を認定しません。

学校・社内研修では公開済みの解答だけを修了試験にせず、講師が解答を開く時刻を決め、説明と実習checkを併用します。

## 1. 必要な環境を確認する

共通で必要なものはGit、Node.js 24.xまたは26.x、約1 GiB以上の空き容量です。Lesson 01〜05、10〜12、15にDockerは不要です。Lesson 06〜09はDocker DesktopまたはDocker EngineとCompose v2、初回image build用のnetwork、Docker用に少なくとも8 GiBの空き容量を用意してください。Lesson 09はscripted HTTP User Agentをcontainer内で動かすためGUI browserは不要です。Lesson 10、11、15は手動flowを追う場合だけbrowserを使います。Lesson 13、14はPlaywright用Chromiumが必要です。

対応候補は次の環境です。

- macOS arm64 / x64
- Linux arm64 / x64
- WSL2 x64のLinux filesystem

Node.js 26をcandidateとしているのは、非Docker LessonのmacOS arm64とLinux x64です。macOS x64、Linux arm64、WSL2のNode.js 26 profileと、Docker Lesson 06〜09のNode.js 26 profileはexperimentalであり、runnerはfail closedで拒否します。これらの環境ではNode.js 24を使います。

Windows nativeは安全なprocess所有確認が未完成なので使いません。support matrixには検出対象として記録しますが、各lessonの`profileIds`からは除外し、runnerもfail closedで拒否します。WSL2では`/mnt/c/...`ではなく、`~/...`のようなLinux側のhome directoryへcloneします。

Lessonごとの検証済みprofileは`curriculum/support-matrix.json`を確認してください。共通doctorがpassしても、個別Lessonや未記載profileの対応を意味しません。

まずversionを確認します。

```bash
git --version
```

Gitのversionが表示されたことを確認してから、Node.jsを確認します。見つからない場合は次へ進まず、下記の公式手順で導入します。

```bash
node --version
```

`v24.`または`v26.`で始まることを確認してから、同梱されたnpmを確認します。Node.js 25や27以降では教材を実行しません。

```bash
npm --version
```

期待する結果は、3コマンドがすべてversionを表示し、`node --version`が`v24.`または`v26.`から始まることです。

- Gitが見つからない場合は、OSに対応するGit公式手順（[macOS](https://git-scm.com/install/mac)、[Linux](https://git-scm.com/install/linux)、[Windows](https://git-scm.com/install/windows)）で導入し、terminalを開き直して`git --version`を再実行します。Windows nativeは教材対象外ですが、WSL2でcloneするためにWindows側Gitを使う必要はありません。
- Node.jsがない、またはmajor versionが違う場合は、[Node.js公式ダウンロードページ](https://nodejs.org/en/download)でv24.x LTSまたはv26.xを導入し、terminalを開き直して`node --version`と`npm --version`を再実行します。安定性を優先する場合はv24.x LTSを選びます。npmはこのNode.js配布物に含まれるものを使い、別途導入しません。

Node.js 24と26を切り替えるときは、先に現在のrevisionとNode.jsで教材所有stateを削除します。その後にNode.jsを切り替え、依存関係を作り直します。

```bash
node course.mjs purge --yes --json
```

Node.jsを切り替えた後、依存関係を作り直します。

```bash
npm ci
```

新しい実行環境を診断します。

```bash
node course.mjs doctor
```

`doctor`が`pass`で成功したことを確認してから、stateを初期化します。

```bash
node course.mjs setup
```

切替先のNode.jsでrunnerが起動しない場合は、元の対応majorへ戻して`purge`を実行してから切り替えます。この変更より前のrevisionへ戻す場合も、checkout前に`purge`します。先に旧revisionへ戻してstate markerを読めなくなった場合は、Node.js 26対応を含むrevisionを一時的にcheckoutして`purge`し、その後に旧revisionへ戻します。

Lesson 06〜09を行うmacOS利用者は、CPUに合う[Docker Desktop for Mac公式手順](https://docs.docker.com/desktop/setup/install/mac-install/)で導入し、Docker Desktopを起動してから次を1つずつ確認します。

```bash
docker --version
```

```bash
docker compose version
```

```bash
docker info
```

3コマンドが成功するまでDocker回へ進みません。Linuxは[Docker Engine公式のOS別手順](https://docs.docker.com/engine/install/)、WSL2は[Docker Desktop WSL 2公式手順](https://docs.docker.com/desktop/features/wsl/)を入口にします。candidateとexperimentalの区分は`curriculum/support-matrix.json`で確認し、授業では講師が対象profileを事前検証して受講者へ導入済み環境を渡します。

## 2. 教材を取得する

```bash
git clone https://github.com/cloudnative-co/auth-authz-sample-app.git
```

cloneが終了code 0で完了したことを確認してから、取得したrepositoryへ移動します。失敗した場合は、同名directoryの有無、network、Gitのerrorを解消してから再実行します。

```bash
cd auth-authz-sample-app
```

`package-lock.json`と`course.mjs`が見えるrepository rootへ移動できたことを確認してから、依存関係を入れます。

```bash
npm ci
```

`npm ci`はchecked-inの`package-lock.json`どおりに依存関係を入れます。`npm install`へ置き換えません。失敗した場合は、最初のerrorまで戻り、Node.js version、network、書込権限、空き容量を確認します。

## 3. 共通診断とsetupを実行する

```bash
node course.mjs doctor
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs setup
```

該当する成功結果（終了code 0、`[PASS]`、`safe-noop`）を確認してから次へ進みます。失敗時はerrorを解消し、同じcommandを再実行します。

```bash
node course.mjs diagnose
```

各コマンドの先頭行が`[PASS]`なら次へ進めます。`[BLOCKED]`または`[FAIL]`なら、表示された`reasonCode`と`recovery`を読み、原因を直して同じコマンドを再実行します。

教材はrepository直下の`.lab/`だけを学習stateとして使います。`.lab/`を手作業で作成・削除したり、自分のメモを置いたりしません。

完全コースまたは実習のみの経路では、ここで必ず[準備ラボの受講者ガイド](course/lessons/setup/README.md)の「2. stateの変化を予測する」から進みます。repository取得と`npm ci`はこのREADMEで完了しているため、準備ラボ内でcloneし直しません。`AA-SETUP-C1`〜`AA-SETUP-C3`、安全な`purge`、Lesson開始用の再`setup`まで完了します。これは任意の診断ではありません。読解のみの経路では実行しません。

## 4. Lessonを進める

完全コースでは記事を主教材として各lessonを同じ順序で進めます。実習のみの経路では記事を開かず、Lesson guideを主教材にします。

1. 対応する連載記事を上から読む
2. 記事の実習節で、正常系と拒否系のstatus、検証者、state変化を予測する
3. 記事の指示どおり`doctor`、`setup`、`demo`、`observe`を1回だけ進める
4. `submission.json`の`TODO`を許可値へ置き換え、`check`へ合格する
5. 合格後だけ`stop`し、記事を最後まで読む
6. 読解5問へ回答し、4問以上正解してから次の回へ進む

以下はLesson別ガイドの索引です。完全コースでは記事内の同じ実習を一度だけ行い、実習のみではリンク先のガイドを上から進めます。このREADMEには二重管理になるcommand列を置きません。

標準実習はsetup、全15回、Capstoneを含む1240分です。Lesson 02〜15には、標準check合格後だけ進む任意の`extension.yaml`があります。発展課題は計765分で標準時間と修了条件には含めません。各受講者ガイドの「任意の発展課題」から進み、実環境のsecret、hostname、個人情報は提出しません。

### Lesson 01

10事例を5つの責任境界へ分類します。[Lesson 01受講者ガイド](course/lessons/01/README.md)

### Lesson 02

保存形式、salt差、generic 422、rate limitを確認します。[Lesson 02受講者ガイド](course/lessons/02/README.md)

### Lesson 03

Cookie、Session ID、server-side record、rotation、失効を分けます。[Lesson 03受講者ガイド](course/lessons/03/README.md)

### Lesson 04

403、秘匿404、204とatomic auditを区別します。[Lesson 04受講者ガイド](course/lessons/04/README.md)

### Lesson 05

401 challenge、Authorization header、毎requestの再認証を追います。[Lesson 05受講者ガイド](course/lessons/05/README.md)

### Lesson 06

実OpenLDAPでbind、search、user bind、group searchを分けます。[Lesson 06受講者ガイド](course/lessons/06/README.md)

### Lesson 07

実MIT KerberosでTGT、service ticket、GSSAPI拒否位置を追います。[Lesson 07受講者ガイド](course/lessons/07/README.md)

### Lesson 08

Samba AD互換DCでverified LDAPS、opaque ID、JMLを確認します。[Lesson 08受講者ガイド](course/lessons/08/README.md)

### Lesson 09

実KeycloakでAuthnRequestからstrict ACS、app sessionまで追います。[Lesson 09受講者ガイド](course/lessons/09/README.md)

### Lesson 10

Authorization Code + PKCE、opaque token、introspectionを追います。[Lesson 10受講者ガイド](course/lessons/10/README.md)

### Lesson 11

Discovery、JWKS、ID Token検証後だけのapp sessionを確認します。[Lesson 11受講者ガイド](course/lessons/11/README.md)

### Lesson 12

TOTP登録、pre-auth、replay、rate limit、recoveryを追います。[Lesson 12受講者ガイド](course/lessons/12/README.md)

### Lesson 13

実browser APIと仮想認証器でWebAuthnのRP検証を追います。[Lesson 13受講者ガイド](course/lessons/13/README.md)

### Lesson 14

discoverable login、RP失効、第二credential、BE / BSを確認します。[Lesson 14受講者ガイド](course/lessons/14/README.md)

### Lesson 15

必須前提04、10、11の後、JWT Access Tokenと3段階のAPI gateを追います。[Lesson 15受講者ガイド](course/lessons/15/README.md)

### Capstone

架空組織を`developer`または`iam-operations`のtrackで立て直します。自動7 checkに加えて講師rubricも使います。[Capstone受講者ガイド](course/lessons/capstone/README.md)

## checkがfailしたとき

`check`の`checks`欄でfailしたIDを確認し、`observe`と受講者ガイドの該当箇所へ戻ります。回答ファイルでは、field名、階層、lesson IDを変えず、`TODO`だけを`exercise.json`またはガイドに記載された許可値へ置き換えます。全required checkが`pass`になるまでは教材processを保持し、`observe`→回答修正→`check`を繰り返します。`stop`は全required checkの`pass`を確認した後だけ実行します。

自習では、予測、`observe`、自分での再回答を終えても根拠を説明できない場合に限り、`course/lessons/<id>/answer-key.md`で正答と根拠を確認します。講師付き研修では、講師が指定した時刻までanswer keyを開きません。

JSONが壊れた場合は、まずカンマ、二重引用符、`TODO`、未知の値を確認します。回答を破棄してよい場合だけresetします。

```bash
node course.mjs lesson 02 reset
```

上の`02`は対象lesson IDへ置き換えます。resetはそのlessonの回答を初期状態へ戻し、processを新しい実行世代で起動し直します。

原因が分からない場合は、手作業でstateやprocessを消さずに診断します。

```bash
node course.mjs lesson 02 diagnose
```

lesson診断に表示された`reasonCode`と`recovery`を先に確認します。lesson外のcourse stateも調べる必要がある場合だけ、次のcourse全体診断を追加で実行します。どちらもstateやprocessを変更しません。

```bash
node course.mjs diagnose
```

## 終了、reset、purgeの違い

| Command | 何をするか | 回答・evidence |
| --- | --- | --- |
| `node course.mjs lesson <id> stop` | 所有確認できた教材processだけ止める | 残す |
| `node course.mjs lesson <id> reset` | 対象lessonを初期状態へ戻す | 対象回答は破棄、既存evidenceは保持 |
| `node course.mjs reset` | course全体の実行世代を進める | evidenceは保持 |
| `node course.mjs purge --yes --json` | 教材が所有する全stateを削除する | 削除する |

purgeは取り消せません。実行前に回答とevidenceを削除してよいか確認します。

```bash
node course.mjs purge --yes --json
```

成功時はJSONの`diagnostics[]`内で、`id: "resources.remaining"`である要素の`actual`が文字列`"0"`です。未知のfile、symlink、所有者を確認できないprocessがある場合は、安全のため削除を拒否します。

## 安全境界

- 実在する組織、個人、ほかのserviceで使うpassword、Cookie、tokenを入力しない
- project-appは`127.0.0.1:3000`だけで待ち受ける
- Lesson 06のOpenLDAPは`127.0.0.1:1389`だけへpublishし、平文LDAPをproduction承認しない
- Lesson 07〜09の認証基盤は教材所有の隔離Docker network内だけで動かし、host portを公開しない
- Lesson 10、11、15の三originは`127.0.0.1:4100`〜`:4102`だけで待ち受け、loopback HTTPをproduction承認しない
- Lesson 12のTOTP secret、code、recovery code、transaction / session tokenをevidenceや質問文へ貼り付けない
- Lesson 13、14の仮想認証器を、実hardware、OS統合、cloud同期、実user gestureの検証結果として扱わない
- 未知のport利用processや、所有確認できないprocessを教材から停止しない
- raw password、Cookie、Session ID、control handle、完全なdigestをruntime、journal、evidence、logへ保存しない
- `check`は保存済みruntimeを信用せず、毎回fresh scenarioで再実行する
- このrepositoryの実装、固定credential、parameterを本番へ転用しない

Lesson 01のSAML、OpenID Connect、OAuthは分類用provided caseです。Lesson 02以降の実HTTPや実LDAPも、それぞれの受講者ガイドに書かれた未検証境界を超えて「安全性を証明した」と解釈しません。

## 機械処理と終了code

機械処理では`--json`を付けます。現行runnerは入力待ちしませんが、`--non-interactive`でその前提を明示できます。

| Exit code | 意味 |
| ---: | --- |
| 0 | 成功、または安全な変更なし |
| 2 | commandの使い方が不正 |
| 10 | check不合格 |
| 20 | 前提不足・未対応環境 |
| 21 | lock競合 |
| 30 | state、process、基盤の異常 |
| 31 | timeout |

schema、course contract、support matrixの正は`curriculum/`、固定hashのindexは`course-lock.json`です。
