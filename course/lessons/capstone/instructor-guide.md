# Capstone instructor guide

学習上の前提はLesson 04、08、09、11、14、15です。これらのruntime stateは不要です。標準時間は240分です。

## このguideの役割

Runnerは構造化controlとsimulator結果だけを意味的に採点する。risk配列やJSON keyの掲載順を正解例と一致させるのではなく、必要な値、severity間の優先関係、runbookの必須stepと安全な依存順を判定する。講師は、受講者が理由、tradeoff、残存riskを説明できるかを別rubricで評価する。runnerのpassをそのまま研修修了にしない。

## 事前calibration

講師間で次を揃える。

1. IdPが認証したことと、SP/application/Resource Serverの検証責任を分ける。
2. account disableとsession/token/authenticator revokeを同義にしない。
3. scopeとtenant/object authorizationを分ける。
4. Passkeyを単一端末の所有証明と一般化しない。
5. 自由記述の長さや用語数ではなく、因果と検証可能性を採点する。

開始前に2件のsample explanationを全講師で採点し、カテゴリごとの点差が4点を超える場合は根拠を再調整する。

## 4時間の進行

| 時間 | 講師の役割 | 介入基準 |
| --- | --- | --- |
| 0〜60分 | caseとtrackを説明し、予測を聞く | ownerを製品名だけで答える場合に責務へ戻す |
| 60〜120分 | 共通controlのレビュー | CriticalをUI改善や監視だけで閉じる場合に止める |
| 120〜180分 | track別の机間支援 | developerがscopeだけ、operationsが手順列挙だけならnegative testへ戻す |
| 180〜240分 | check、口頭/文書rubric、再提出判定 | runner passだけで終了しない |

## 自由記述rubric

各カテゴリ20点、合計100点。80点以上で講師rubric合格とする。Criticalな誤理解が残る場合は点数にかかわらず再提出にする。

### 1. 責任分界 20点

- 16〜20: authoritative source、IAM、IdP、SP、application、Resource Serverのownerと受け渡しを説明し、失敗時の修正場所を特定できる。
- 8〜15: 主なownerは合うが、sessionまたはfederation/API境界が曖昧。
- 0〜7: IdPまたはvendorがすべて安全にするという説明。

### 2. Credential/JML lifecycle 20点

- 16〜20: joiner/mover/leaver/emergencyでaccount、membership、session、token、authenticator、evidenceを順序付きで扱う。
- 8〜15: account disableと一部revokeはあるが、deny確認またはmoverが弱い。
- 0〜7: directory disableだけで完了とする。

### 3. Federation/API boundary 20点

- 16〜20: SAML署名とsemantic validation、API token/scope/tenant/objectを別段階で説明し、statusと情報concealmentの理由を述べる。
- 8〜15: 項目は列挙できるが、順序またはfailure境界が弱い。
- 0〜7: 署名、valid token、scopeのいずれかだけでallowする。

### 4. MFA/Passkey lifecycle 20点

- 16〜20: enrollment、recovery、lost device、同期境界、session revokeを一連のcredential lifecycleとして説明する。
- 8〜15: recoveryはあるが、旧credential/session revokeまたはPasskey同期境界が弱い。
- 0〜7: MFAならすべてphishing-resistant、Passkeyなら端末固定と断定する。

### 5. 優先riskとtradeoff 20点

- 16〜20: 3 Criticalを先に閉じ、owner、検証、残存risk、90日計画、代替案のtradeoffを示す。
- 8〜15: 優先順は妥当だが、owner、完了条件、残存riskのいずれかが弱い。
- 0〜7: 実装容易性だけで優先し、Criticalを未解決にする。

Highの`mitigated`と`resolved`はどちらも機械判定を通る。講師は語句ではなく、`resolved`ならriskを閉じる検証根拠、`mitigated`なら残存risk、owner、継続確認が説明されているかを採点する。

## Track別に見るもの

### Developer

- policyがdeny-by-defaultである。
- token→scope→tenant→objectの順序が実装判断へ落ちている。
- invalid token、SAML replay、cross-tenant、leaver session、weak recoveryをnegative testとして説明できる。
- local session revoke hookとfederation adapterのownerが明確である。

### IAM operations

- JML runbookがauthoritative event確認からdeny検証まで続く。
- emergency runbookは4つのcontainment操作の相互順ではなく、それらがdeny検証とaudit保存より前かを見る。
- recovery runbookがstrong reproof、旧authenticator/session revokeを含み、旧authenticator失効より後にreplacementを登録する。
- change control、two-person review、redacted evidenceの保管責任が明確である。

安全な部分順序を受講者が正答例と異なる並びで提出しても減点しない。重複、必要step欠落、調査待ち、未承認provision、旧access保持、knowledge questionだけの復旧は、安全な代替順ではないためrunnerの不合格を維持する。

## 介入してよい範囲

- command、JSON syntax、fieldの意味、runtimeの読み方は教えてよい。
- secureな許可値をそのまま読み上げる前に、失敗caseを一緒に追う。
- 1回目のcheck後は、failしたcheckとcritical reason codeまで示してよい。
- 自由記述の結論を講師が代筆しない。

## 再提出

1. runner failの場合、受講者は`runtime.json`のcheck、metrics、criticalRejectionsから1つの根本原因を特定する。
2. 自由記述rubric failの場合、講師はカテゴリと不足した因果だけを返す。
3. 受講者は修正差分と、なぜ再発を防ぐかを説明する。
4. 同じtrackでfresh `check`を再実行する。track変更は`reset`後に最初から行う。
5. runner全7件と講師80点を別々に記録する。

## 講師記録へ残さないもの

実credential、実在個人の識別子、raw token、Cookie、private key、端末の絶対pathは残さない。case ID、check ID、reason code、抽象化した判断だけを記録する。
