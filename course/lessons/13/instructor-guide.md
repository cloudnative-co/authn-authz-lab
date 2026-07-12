# 第13回 講師ガイド

## 授業の目的

受講者がWebAuthnを「passwordを消す便利機能」ではなく、RP、browser、authenticatorの検証境界として説明できる状態を目指します。actual browser APIと暗号検証を使いますが、virtual authenticatorの結果を実端末保証へ広げないことも同じ重さで扱います。

学習上の前提は第12回のMFAです。第12回のruntime stateは不要です。完全コースの標準時間は140分です。

## 事前準備

講師環境と受講者環境で、授業前に次を確認します。

```bash
node --version
npm ci
npx playwright install chromium
node course.mjs doctor
node course.mjs setup
node course.mjs lesson 13 doctor
```

- Node.js 24.x
- Playwright 1.61.1と対応Chromiumを起動できる
- repositoryと`.lab`がnative filesystem上にある
- portを占有する未管理processがない
- proxy/TLS inspection環境ではbrowser artifactを事前配布済み

browserのdownloadを授業開始後に全員同時実行しないでください。教材は暗黙installを行いません。

## 進行例

| 時間 | 内容 | 確認する誤解 |
| ---: | --- | --- |
| 0–15分 | RP/browser/authenticatorと2 ceremony | browserだけが検証する |
| 15–30分 | user handleとregistration transaction | email hashなら常に匿名 |
| 30–50分 | 予測、doctor、setup | npm ciだけでbrowserも入る |
| 50–75分 | demo、runtime読解 | failed createなら端末にも何も残らない |
| 75–95分 | 6拒否境界 | credential IDの存在で認証できる |
| 95–110分 | 回答、check | signCountはclone証明 |
| 110–120分 | debrief、stop | virtual testは実生体認証の証明 |
| 120–140分 | 読解5問 | 誤答は指定見出しへ戻り、4/5以上を確認する |

## protocol上の重要な補足

`attestation: none`にはdevice attestation signatureがありません。登録responseを無検証で保存する意味でもありません。challenge、origin、RP ID hash、UP/UV、attestation objectの構造を検証し、後続authentication assertionのsignatureを登録済みpublic keyで検証します。

第13回のRP ID negativeはbrowserがforeign RP IDをassertion生成前に拒否する境界です。通常の成功・失敗assertionはRPでも`expectedRPID`を指定して検証します。browser-sideとserver-sideを混同させないでください。

origin negativeは別localhost portで生成した正しいsignatureです。challengeとRP IDを維持したままoriginだけが許可listと異なるため、単なるJSON改変より強いtest fixtureです。

## 採点

- `AA13-C1`: actual API、random user handle、検証後保存、attestation none
- `AA13-C2`: username-bound成功、challenge/origin/RP ID/signature/replay/userHandle
- `AA13-C3`: signCount、mapping、generic failure、virtual試験の限界、redaction

回答だけ合っていてruntimeが失敗した場合は不合格です。`check`はfresh browser scenarioを再実行します。

## 復旧

| 状況 | 対応 |
| --- | --- |
| Chromium未導入 | `npx playwright install chromium`を明示し、doctor再実行 |
| Linux共有library不足 | 管理者承認済みのPlaywright公式install-deps経路を使う |
| proxy download失敗 | 組織artifact mirrorまたは事前配布へ切り替える |
| project-app不整合 | `diagnose`で所有権を確認し、手動killしない |
| JSON破損 | syntaxを直す。回答破棄に同意した場合だけreset |
| browser process残存 | まずcommand終了を待ち、diagnose。広いprocess killを避ける |

## 授業後の記録

- doctor、demo、check、stopの時間
- 予定外の講師介入と自力復帰時間
- registration/authentication、origin/RP ID、user handle/username、signCount/cloneの混同数
- secret、assertion、credential ID、実identifierの露出有無
- OS、architecture、browser profileとhuman pilot実施有無

氏名、hostname、home path、IP、token、credentialは記録しません。
