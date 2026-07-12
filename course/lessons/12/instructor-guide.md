# 第12回 講師ガイド

対象は、第02回のpassword認証を説明できる初学者です。第03回のsession境界は比較材料として授業内で復習できますが、必須前提ではありません。過去回のruntime stateは不要です。授業時間は90分、extensionは45分を想定します。

## 到達目標

- `AA12-O1`: 知識、所持、生体のfactorを分類し、TOTPの強さと限界を説明できる
- `AA12-O2`: TOTP登録と二段階loginを完了し、replay、fallback、復旧を評価できる

## 開講可能条件

講師環境と受講者用clean copyで次を確認します。

1. Node 24とcourse doctorがpassする
2. lesson setup、demo、observe、check、stopが手作業のstate削除なしで完了する
3. RFC 6238 Appendix BのSHA-1、SHA-256、SHA-512 test vectorが全件passする
4. password成功後にapplication sessionが発行されない
5. enrollment確認codeの同一counter再利用がgeneric 422になる
6. 次のcounterのTOTPが成功し、sessionで`/me`へ到達する
7. 誤値と期限切れのstatus/bodyが等しく、3回目が429とRetry-Afterになる
8. recovery codeが初回成功、再利用拒否になる
9. runtime、evidence、logにpassword、secret、URI、TOTP、recovery code、cookie/tokenがない
10. stop/reset/purgeが教材所有resourceだけを扱う

1件でも未確認なら概念解説だけを行い、実習の合否は付けません。

## 時間配分

| 時間 | 内容 | 講師が確認すること |
| ---: | --- | --- |
| 0〜10分 | factor分類と予測 | 画面数とfactor数を区別した |
| 10〜22分 | RFC 6238 | secret、HOTP、counter、30秒を関係づけた |
| 22〜32分 | enrollment | password gate、URI、確認codeを追跡した |
| 32〜45分 | pre-authとsession | passwordだけでsessionを出さない理由を説明した |
| 45〜58分 | replayとwindow | 短命と一回限りを区別した |
| 58〜68分 | rate limitと秘匿 | 6桁guessと証跡漏えいを説明した |
| 68〜78分 | recovery | single-useと本人確認の不足を説明した |
| 78〜87分 | 回答とcheck | 3 checkをruntime根拠付きでpassした |
| 87〜90分 | 実務転用とstop | WebAuthnへ移す条件を1つ書いた |
| 90〜105分 | 読解5問 | 4/5以上を確認し、誤答は指定見出しへ戻った |

## 教える境界

### 「MFA画面が2枚」をfactor分類にしない

同じ種類の知識を2回聞いても、独立したfactorにはなりません。TOTPではpasswordという知識と、共有秘密を持つauthenticatorという所持を組み合わせます。device unlockの生体は、serverが生体情報を直接検証することと同義ではありません。

### URIをRFC 6238の一部と説明しない

RFC 6238はTOTP計算を定め、provisioning flowは範囲外です。`otpauth://`は実用上広い相互運用慣行ですが、RFC 6238標準のQR formatではありません。受講者が`rfc6238-standardized-qr-uri`を選んだら、algorithmとprovisioningを分けて問い返します。

### secret表示と登録完了を同一視しない

secret表示後、利用者のauthenticatorへ正しく入ったかを現在codeで確認します。確認前にfactorをactiveにすると、誤scanや中断でaccountをlockoutさせます。逆に確認codeをloginへ再利用できると、一回限りの条件を破ります。

### pre-authをapplication sessionと呼ばない

password成功後のcookieは第二要素を続ける短命transactionです。`/me`へ使えるapplication sessionではありません。講師はcookieの名前だけでなく、到達可能endpointとserver-side stateを確認させます。

### time windowを大きくして失敗を隠さない

教材は現在と一つ前後を検査しますが、成功済みcounter以下を拒否します。RFC 6238はnetwork delayとして高々1 stepを推奨します。clock問題が出たら、無制限windowではなく時刻同期、drift policy、再登録、supportを検討します。

### rate limitをpre-auth cookieだけへ結び付けない

攻撃者がpasswordを持つ、またはpre-authを繰り返し取得できる場合、transaction単位のcountは回避されます。教材はsubject単位で数えます。本番ではIP、device、risk signalも使えますが、共有networkやDoSを考えずIPだけでlockoutしません。

### recovery codeだけで復旧設計が完了したとしない

教材はcode生成、digest保存、single-useだけを実装します。codeもdeviceも失った場合の本人確認、support承認、通知、factor reset、session失効は受講者の設計課題です。support担当者が自由にfactorを外せる設計を合格にしません。

### TOTPをphishing-resistantと評価しない

expiryとone-time propertyはreal-time relayを防ぎません。偽siteが入力値を正規siteへ即時転送できます。phishing耐性が必要ならWebAuthnを検討し、例外と移行を含めて判断します。

## 採点rubric

| Check | 合格条件 | 典型的な不合格 |
| --- | --- | --- |
| `AA12-C1` | password gate、URIの位置づけ、登録確認、pre-auth、第二要素後のsession | 匿名登録、URIをRFC標準と誤認、password後にsession発行 |
| `AA12-C2` | counter replay拒否、generic 422、subject rate limit、secret非保存 | 30秒内replay許可、原因を外部表示、codeをlog保存 |
| `AA12-C3` | 所持factor、非phishing-resistant、single-use recovery、WebAuthn選択 | 生体と誤認、expiryだけで耐phishing、plaintext reusable recovery |

3 checkすべてについてruntimeと回答が一致した場合だけ合格です。概念回答だけ、または保存済みruntimeだけでは合格にしません。`check`がfresh scenarioを再実行した結果を使います。

## 誤答への問い返し

- 「その時点のcookieで`/me`へ到達できますか」
- 「secretを表示しただけで、authenticatorへ正しく登録されたと確認できますか」
- 「30秒有効と一回限りは同じ条件ですか」
- 「新しいpre-authを取ると試行回数をresetできませんか」
- 「そのevidenceからfactorを複製できませんか」
- 「偽siteがcodeを即時転送したらprotocolは何を検証しますか」
- 「recovery codeも失った利用者を誰が何で本人確認しますか」

## failure drill

通常授業ではrunnerが自動で拒否系を実行します。追加drillを行う場合も、source codeや`.lab`を直接書き換えず、次の観察を使います。

| 状況 | 観察するfield | 期待する判断 |
| --- | --- | --- |
| enrollment code再利用 | `replayedConfirmationStatus=422` | counterを消費済みとして扱う |
| 2 step前のcode | `expiredStatus=422` | window外。window無制限化はしない |
| 誤6桁 | `wrongStatus=422` | expiryと同じ外部body |
| 3回連続失敗 | `rateLimitStatus=429` | Retry-Afterに従う |
| recovery再利用 | `recoveryReplayStatus=422` | 使用済みdigestを拒否 |
| secret共有 | `redaction` | 証跡を破棄し、実factorなら再登録 |

## 復旧と安全

| 状況 | 講師の対応 |
| --- | --- |
| project-appが起動しない | `diagnose`でownerとportを確認し、手動killを避ける |
| JSONを壊した | syntaxを直す。回答破棄の合意がある場合だけresetする |
| rate limitから進めない | fresh `demo`または`check`を使い、production thresholdを弱めない |
| secret/codeが露出した | 共有を止め、実credentialならfactor失効・再登録、session失効を行う |
| clock問題 | OS時刻同期を確認し、windowを安易に広げない |
| phishing-resistantとの誤解 | 第13回のorigin/RP ID検証と比較する |

## 授業後に記録するもの

- doctor、demo、check、stopの所要時間
- 初回checkの誤答fieldと、根拠へ戻って自己修正できたか
- factor/step、pre-auth/session、expiry/replayの混同数
- secret、code、token、実identifierの露出有無
- recoveryとWebAuthn移行で未決定になった項目

記録にはpseudonymousな受講者ID、固定reason、所要時間だけを使います。
