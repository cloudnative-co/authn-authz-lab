# Lesson 11 instructor guide

対象は、第03回のapp sessionと第10回のOAuth Authorization Code Flowを説明できる初学者です。両Lessonのruntime stateは不要です。完全コースの標準時間は120分です。

## 105分の進行

| 時間 | 内容 | 確認すること |
| ---: | --- | --- |
| 0〜10分 | 前提とOAuth/OIDC比較 | API認可と認証を分けた |
| 10〜20分 | 予測、doctor、setup | delivery、issuer/audience、token用途を予測した |
| 20〜40分 | 正常flow | discovery、JWKS、back-channel、session発行を追った |
| 40〜65分 | one-fault拒否 | 六つの不正ID Tokenとsession未発行を比較した |
| 65〜75分 | identity model | `sub`とemailの役割を分けた |
| 75〜95分 | submission、check、復旧 | AA11-C1/C2をpassし、reasonCodeから復旧できた |
| 95〜105分 | 実務転用とstop | issuer、key、session、HTTPSへ対応づけた |
| 105〜120分 | 読解5問 | 4/5以上を確認し、誤答は指定見出しへ戻った |

GUI browserのfront-channel観察は任意です。required checkはrunnerのfresh scenarioで完了できるため、browser操作を受講必須条件にしません。

教材用credentialはLesson 10と同じですが、OP以外へ入力させません。

## よくある誤診

- 「JWTの三部分が読めたのでログイン成功」:decodeは署名・claim検証ではありません。
- 「署名が正しければissuer/audienceは不要」:別issuerまたは別RP向けの正規tokenを誤受理します。
- 「emailまたは`sub`単体を複数issuerの主キーにする」: emailは変更・再割当の可能性があります。`sub`のlocally unique / never reassignedはissuer contractであり、RPが1回のloginで証明する性質ではありません。複数issuerでは`(iss, sub)`を組にします。
- 「access tokenでログインする」:access tokenのaudienceと目的はResource APIです。
- 「Cookieが二つなら先頭を使う」:曖昧なsession cookieはgeneric 403で拒否します。

## 合格判定

AA11-C1/C2の両方、六拒否、duplicate cookie拒否、secret-free evidenceが必須です。HTTPはloopback観察専用で、本番はHTTPSと`Secure` cookieが必要です。

環境またはcheckで止まった場合は`node course.mjs lesson 11 diagnose`を実行し、`reasonCode`と`recovery`に従います。回答を破棄してよい場合だけ`reset`、通常終了は`stop`、全Lessonのstateを削除してよい場合だけcourse-wideの`purge`を使います。
