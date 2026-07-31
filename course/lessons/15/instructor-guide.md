# Lesson 15 instructor guide

第04回、第10回、第11回を完了し、それぞれのrequired checkに合格していることを必須前提にします。application認可、OAuth、ID TokenとAccess Tokenの違いを説明できるかを開始前に確認します。過去回のruntime stateは不要です。完全コースの標準時間は140分です。

## 120分の進行

| 時間 | 内容 | 確認すること |
| ---: | --- | --- |
| 0〜15分 | 前提と責任分界 | AS、Client、Resource API、project-coreを分けた |
| 15〜30分 | 予測、doctor、setup | 401/403/404/204とpolicy到達を予測した |
| 30〜50分 | Token profile | `resource`、`aud`、`typ=at+jwt`、RS256/JWKSを追った |
| 50〜75分 | Token拒否 | 401群がすべて`policyEvaluated=false`であることを確認した |
| 75〜95分 | scopeとobject認可 | scope不足、viewer、cross-tenant、ownerを比較した |
| 95〜110分 | submission、check、復旧 | AA15-C1/C2/C3をpassし、reasonCodeから復旧できた |
| 110〜120分 | 実務転用とstop | 自組織APIへ検証順序を対応づけた |
| 120〜140分 | 読解5問 | 4/5以上を確認し、誤答は指定見出しへ戻った |

## 授業前確認

- Node.js 24.xまたは26.xで`node course.mjs doctor`がpassする
- 4100、4101、4102を他processが使用していない
- `demo`、`observe`、正答を入れた`check`を一度通す
- runtime、evidence、logにToken、code、verifier、Cookie、dummy credentialがない

## 誤診への問い返し

- 「署名が正しければよい」: そのTokenの用途を何で区別し、どのAPI向けかを何で確認しますか。
- 「scopeがあるので削除できる」: `project:delete`と`p-100`のowner判定は同じデータですか。
- 「全部403でよい」: 他テナントにprojectの存在を知らせる必要がありますか。
- 「ClientもJWTを読めば便利」: ASがopaque tokenへ変更したとき、そのClientは動き続けますか。
- 「JWTなら失効確認不要」: 有効期限内の緊急失効をどう反映しますか。

## 故障注入の説明

負例はrunner所有のscenario内で1条件だけ変えます。これはResource APIの拒否能力を確かめる適合性fixtureです。ASの正しい動作や、外部利用者が指定できるToken生成APIとして説明しないでください。

## 合格判定

AA15-C1/C2/C3をすべて満たす必要があります。特に次は不合格です。

- JWTをdecodeしただけで検証済みとする
- `typ=JWT`のID Token型をAccess Tokenとして受け入れる
- scope不足を401にする
- Token不正でもproject-coreを呼ぶ
- cross-tenantを存在が分かる403にする
- loopback HTTPを本番許可とする

固定portが使用中でも、所有者を確認せず他processを停止しません。`diagnose`のreasonCodeとrecoveryに従います。
