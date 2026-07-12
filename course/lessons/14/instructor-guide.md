# 第14回 講師ガイド

## 授業の目的

passkeyを「同期されるpasswordless credential」と一文で済ませず、discoverable credential、RP record、authenticator private credential、backup flags、account/session lifecycleへ分解させます。復旧は認証方式の外側ではなく、導入可否を決める中心設計として扱います。

学習上の前提は第03回のapp sessionと第13回のWebAuthnです。両Lessonのruntime stateは不要です。完全コースの標準時間は105分です。

## 事前準備

```bash
node --version
npm ci
npx playwright install chromium
node course.mjs doctor
node course.mjs setup
node course.mjs lesson 14 doctor
```

第13回と同じPlaywright/Chromium prerequisiteです。授業前にbrowser artifactを各環境へ用意し、一斉downloadを避けます。

## 進行例

| 時間 | 内容 | 確認する誤解 |
| ---: | --- | --- |
| 0–15分 | discoverable credentialとuserHandle | usernameがRP IDへ入る |
| 15–30分 | RP recordとprivate credential | RP失効で全端末から鍵が消える |
| 30–45分 | 予測、doctor、setup | credential 1本で復旧も十分 |
| 45–65分 | demo、runtime読解 | BE/BSはprovider同期証明 |
| 65–75分 | account/session lifecycle | signatureが有効ならdisabled accountも許可 |
| 75–85分 | 回答、check | signCount 0はclone証明 |
| 85–90分 | debrief、stop | virtual fixtureを実端末保証へ拡張 |
| 90–105分 | 読解5問 | 誤答は指定見出しへ戻り、4/5以上を確認する |

## 実習の2 authenticator構成

browser processは1つですが、contextを2つに分け、各contextへ別のCDP virtual authenticatorを追加します。同じRP account handleを使って独立credentialを登録します。

authenticator 1はBE/BS false、authenticator 2はBE/BS trueです。flagsの違いを観察するための入力であり、single-device credentialと実synced passkeyの製品比較ではありません。

## debriefで確認する順序

1. empty `allowCredentials`でもchallenge、RP ID、UVは必要
2. returned userHandleは保存済みcredential accountへ照合する
3. RP失効後もauthenticatorがassertionを作ることがある
4. RPはinactive recordとして拒否する
5. 第二credentialは事前登録されて初めて復旧に使える
6. BEとBSは異なる
7. virtual flagsは実同期を証明しない
8. account disableは既存sessionも失効する

## 採点

- `AA14-C1`: discoverable login、userHandle、RP失効、private credential残存、第二credential復旧
- `AA14-C2`: BE/BS、cloud同期非証明、account/session disable、signCount、redaction

回答だけではなくfresh runtimeが必要です。revoked assertionまたはdisabled account assertionが成功した場合、教材を続行せず実装回帰として扱います。

## 復旧と安全

| 状況 | 対応 |
| --- | --- |
| Chromiumがない | install commandを明示しdoctor再実行 |
| context/authenticator作成失敗 | Playwright versionとbrowser revisionを確認 |
| credential countが想定外 | scenarioをfreshにし、CDP raw credentialを保存・共有しない |
| account disable test失敗 | session policyを弱めず、state generationを調査 |
| submission破損 | syntax修正。回答破棄の合意がある場合だけreset |

## 授業後の記録

- 自力復帰できなかったblocker
- discoverable/username、RP/authenticator、BE/BS、flag/sync、credential/sessionの混同数
- 第二credentialと全喪失recoveryの区別ができたか
- credential、assertion、userHandle、実identityの露出有無
- 実機pilot未実施であること
