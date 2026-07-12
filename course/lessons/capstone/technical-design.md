# Capstone technical design

## 目的

Capstoneは、過去Lessonのruntimeを再利用せず、架空組織の一貫caseへ認証認可の境界を統合する。developerとiam-operationsは異なる成果物を作るが、同じ7 checkと重大拒否gateを通す。

## 証拠境界

- runtimeはdeterministic policy simulatorの結果であり、live SAML/OAuth/WebAuthn wire evidenceではない。
- live protocolの達成条件は各Lessonで検証する。capstoneは責任分界、設定の組合せ、deny順序、lifecycleを統合評価する。
- `demo`は脆弱な初期caseを実行し、`check`は現在のsubmissionをfreshに再実行する。
- 保存済みruntimeを採点根拠にしない。

## Case

`model.mjs`の`CAPSTONE_CASE`を正とする。実在組織や個人は使わず、次の5 observationを固定する。

1. leaver access残存。
2. SAML semantic validation不足。
3. API tenant/object認可不足。
4. authenticator recovery再確認不足。
5. shared administrator credential。

## Workspace

- Resource: `data:capstone-workspace`
- Locator: `.lab/submissions/capstone`
- Files: `submission.json`、`runtime.json`
- setup: submission templateをexclusive createする。
- reset: workspaceを検証後に再作成しepochを進める。
- purge: course markerとresource ownershipを照合して教材stateだけを削除する。

過去Lessonのworkspace、process、container、portは参照しない。

## Track contract

Submissionは共通controlとtrack artifactから成る。

- developer: deny-by-default policy、session revocation hook、strict ACS adapter、API policy、negative test plan。
- iam-operations: change control、JML、emergency、recovery runbook、validation profile、simulation plan。
- 未選択trackは文字列`not-selected`にする。両trackの同時提出や部分混在を拒否する。

## Simulator

`runCapstoneScenario`はsubmissionを受けたときに次を計算する。

- C1〜C7 control一致。
- API owner/viewer/cross-tenant、SAML valid/replayのdecision。
- joiner、mover、leaver、emergencyのlifecycle。
- 5 critical rejection testのexecuted/skipped/passed。
- weighted score、skip数、failure数、未解決Critical数。

ScenarioはI/O、network、clock、乱数を使わない。入力から同じ結果を返す。

## Scoring

| Check | Points | Machine boundary |
| --- | ---: | --- |
| AA-CAP-C1 | 14 | responsibility owner |
| AA-CAP-C2 | 14 | credential/JML/session lifecycle |
| AA-CAP-C3 | 14 | federation receiving validation |
| AA-CAP-C4 | 14 | API validation and authorization order |
| AA-CAP-C5 | 14 | MFA/Passkey lifecycle |
| AA-CAP-C6 | 15 | risk severity/owner/disposition/priority |
| AA-CAP-C7 | 15 | selected track artifact and global gates |

Global gateは80%以上、critical skip 0、critical failure 0、unresolved Critical 0である。加えてrequired checkは全7件passを要求する。

## Human rubric separation

自由記述はruntime、check data、evidenceへ渡さない。自動判定は自由記述を理解したと主張しない。講師は`instructor-guide.md`の100点rubricを使い、80点未満を再提出とする。

## Evidence allowlist

各checkのevidence dataはpointsだけを基本とし、C7だけ次を追加する。

- scorePercent / requiredScorePercent
- criticalSkipCount / criticalFailureCount
- unresolvedCritical
- instructorRubricRequired
- machineInterpretsFreeText

Runtimeはcase ID、抽象化したreason code、boolean、countだけを保存する。credential、PII、raw token、filesystem pathを保存しない。

## 制限

- 製品固有設定、browser UI、実network、実directory同期を検証しない。
- simulatorのpassをproduction readinessや規格適合証明に使わない。
- human pilotと複数OS実機検証が完了するまではsupport statusをexperimentalとする。
