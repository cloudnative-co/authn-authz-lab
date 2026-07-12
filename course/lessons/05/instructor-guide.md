# 第05回 講師ガイド

対象は、第01回で認証、session、認可の責任境界を区別できるようになった初学者です。授業時間は60分を想定します。

## 到達目標

- `AA05-O1`: Basic challengeと`Authorization` headerを実HTTP結果から読み取れる
- `AA05-O2`: TLS、log、共有ID、rotation、MFA、SSOの要件からBasic認証の適用範囲を判断できる

## 開講可能条件

講師環境と受講者用clean copyの両方で、次を確認します。

1. `doctor → setup → demo → observe → 手編集 → check → stop`がREADMEどおり成功する
2. `AA05-C1`だけの誤答と`AA05-C2`だけの誤答が、対応するcheckだけをfailさせる
3. successに`Set-Cookie`がなく、次のheaderなしrequestが同じchallenge付き`401`になる
4. missing、malformed、未知user、誤passwordの外部failureが同じである
5. `429`と`503`が`Retry-After`を保ち、`401`へ変換されない
6. observation、evidence、logに`Authorization`、user-id、password、decode値、完全tokenが残らない
7. `reset`後に第05回workspaceを再作成でき、`purge --yes --json`後に教材resourceが0件になる

1件でも未確認なら、概念説明だけを行い、この実習の合否は付けません。

## 時間配分

| 時間 | 内容 | 講師が確認すること |
| ---: | --- | --- |
| 0〜8分 | 前提と予測 | success後のheaderなしrequestと`Set-Cookie`を予測した |
| 8〜18分 | 401 challenge | statusと`WWW-Authenticate`を一組で読める |
| 18〜28分 | credential construction | NFC、UTF-8、colon、Base64を正しい順に並べられる |
| 28〜38分 | demoとobserve | 401、401、200、401とsecret非表示を確認した |
| 38〜48分 | submissionとcheck | `AA05-C1`と`AA05-C2`がpassする |
| 48〜57分 | 採否演習 | TLS、log、ID lifecycle、MFA/SSOを別々に評価した |
| 57〜60分 | stop | 回答を残し、教材所有processだけを停止した |
| 60〜70分 | 読解5問 | 4/5以上を確認し、誤答は指定見出しへ戻った |

## 教材実装の固定条件

| 項目 | 教材実装 |
| --- | --- |
| endpoint | `GET /api/lessons/05/basic/me` |
| challenge | `Basic realm="lesson-05", charset="UTF-8"` |
| credential | canonical Base64 of UTF-8 NFC `user-id:password` |
| success | `200 BASIC_AUTHENTICATED` |
| authentication | requestごとに実行 |
| session | 発行しない、`Set-Cookie`なし |
| normal failure | missing、malformed、未知user、誤passwordを同じ401へまとめる |
| transient failure | 429または503、`Retry-After`を保持 |
| transport | loopback HTTPは教材上の差異、本番はTLS必須 |
| evidence | header、user-id、password、decode値を除外 |

値を変更した授業は、既定教材のruntime evidenceと混在させません。

## 授業で強調する境界

### 401を単なる「ログイン失敗」にしない

`401`はHTTP authentication challengeの一部です。`WWW-Authenticate`を伴って初めて、clientがどのschemeとparameterで資格情報を出し直せるか分かります。JSON form loginのgeneric failureと混同させません。

### Base64とTLSを役割分担させる

Base64はbyte列の表現です。機密性、server認証、改ざん検知を提供しません。受講者が「Base64だから読めない」と答えたら、鍵を使っている箇所があるかを問い返します。

### RFCの要件と教材hardeningを分ける

RFC 7617が定めるUTF-8/NFC、control character、user-idのcolon制約と、教材が追加するheader長、field長、canonical Base64の強制を分けて説明します。教材の上限値をBasic認証全体の規格値にしません。

### credential reuseとsessionを混同させない

clientがprotection space内で`Authorization`を自動再送することはあります。これはserver-side sessionの発行ではありません。success後の`Set-Cookie`不在と、headerなしrequestの401を証拠にします。

### logoutをclient非依存で約束しない

Basic認証自体にsession破棄APIはありません。credentialの保持期間や再利用はclientと利用者設定にも依存します。「browserを閉じれば必ず消える」「閉じても必ず残る」のどちらも一般化しません。

### 共有IDを「内部用途」で正当化しない

共有IDでは、HTTP認証が成功しても操作者個人を監査できません。Basic認証の採否と、ID lifecycle・監査要件を別の問いにします。

## 採点rubric

| Check | 合格条件 | 典型的な不合格 |
| --- | --- | --- |
| `AA05-C1` | runtimeでchallenge、200、sessionなし、毎request認証を確認し、4 fieldが正答 | challengeなし401、hash送信、session発行と回答 |
| `AA05-C2` | runtimeでtransport差異とredactionを確認し、4 fieldが正答 | 平文HTTP承認、Base64暗号化、credential log、SSO defaultと回答 |

部分合格は設けません。runtimeと回答の両方が一致し、2 required checkがpassした場合だけ合格です。講師が回答JSONを代筆した場合は再提出にします。

## 誤答への問い返し

- 「その401には、clientが次に使うschemeを示すheaderがありますか」
- 「Base64化の前後で、鍵はどこに登場しますか」
- 「success後のresponseに`Set-Cookie`はありますか」
- 「clientの自動再送と、server-side session recordは同じものですか」
- 「loopback HTTPは、どの信頼境界だけを狭めていますか」
- 「共有IDのlogから、操作した個人を特定できますか」
- 「MFAまたはSSOが必須なら、Basic単体のどこで実現しますか」

## 採否討議の進め方

次の仮想ケースを1つ選び、6項目を「満たす」「満たさない」「未確認」で評価させます。

1. 公開前preview環境を2週間だけ保護する
2. 定期batchが固定APIへ接続する
3. 全社員が使うbrowser業務アプリへログインする

評価項目はTLS、credential log、個別ID、rotation、明示的logout、MFA/SSOです。用途名だけで結論を出さず、要件が揃った場合だけ限定採用とします。「未確認」を不合格にせず、確認行動を言えない場合を不合格にします。

## 安全と復旧

| 状況 | 講師の対応 |
| --- | --- |
| JSON破損 | templateと8 fieldを比較する。破棄合意がある場合だけresetする |
| port競合 | diagnoseで所有情報を確認し、所有者不明processは停止しない |
| credential露出 | 共有を止める。実credentialならrotation手順へ移る |
| HTTPを本番へ転用 | `transportContext`とTLS要件を再確認させる |
| browser挙動が環境差を示す | course scenarioの機械契約と、client固有挙動を分けて記録する |
| checkが保存runtimeと違う | checkはfresh scenarioを使うことを説明し、diagnoseする |

実在するpassword、組織のendpoint、個人情報を課題へ入力させません。画面共有、提出物、質問用screenshotにも`Authorization` headerを含めません。

## 授業後に記録するもの

- doctor、setup、demo、observe、編集、check、stopの所要時間
- 401とchallengeを分離して読んだ人数
- Base64を暗号化と回答した人数
- credential reuseをsessionと誤認した人数
- loopback HTTPを本番承認と誤認した人数
- 共有ID、rotation、MFA/SSOを採否へ使えた人数
- secret露出、所有者不明process操作、予定外の講師介入
