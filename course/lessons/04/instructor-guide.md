# 第04回 講師ガイド

対象は、第03回でCookie sessionからprincipalを確定する流れを説明できる初学者です。授業時間は90分を想定します。

## 到達目標

- `AA04-O1`: subject、resource、action、contextから許可・拒否を予測できる
- `AA04-O2`: challengeなしCookie APIの未認証`403`、権限不足`403`、resource秘匿`404`、challenge文脈の`401`を区別できる

## 開講可能条件

講師環境と受講者用clean copyで次を確認します。

1. `doctor → setup → demo → observe → 手編集 → check → stop`がREADMEどおり成功する
2. `AA04-C1`から`AA04-C4`を意図的な誤答で個別にfailできる
3. Cookieなしが`403`かつ`WWW-Authenticate`なしで、project-core auditが0件のままである
4. ownerだけが削除でき、viewer、outsider、別tenant、missing、repeatが期待statusで拒否される
5. principal、role、tenantの偽装headerが無視される
6. password、identifier、raw Cookie、Session ID、完全digest、control tokenがruntime、evidence、logへ残らない
7. resetとstopが別lessonの回答や所有者不明processを変更しない

1件でも未確認ならdomain modelの解説だけを行い、実習の合否は付けません。

## 時間配分

| 時間 | 内容 | 講師が確認すること |
| ---: | --- | --- |
| 0〜10分 | 登場人物と予測 | 5 requestのstatus、mutation、auditを予測した |
| 10〜22分 | 認証と認可の境界 | sessionがprincipalを作り、coreがroleを求めると説明した |
| 22〜35分 | PEPとPDP | 未認証requestがcoreへ到達しないことを確認した |
| 35〜50分 | ownerとviewer | `204`と`403`、state、auditを対応づけた |
| 50〜63分 | 秘匿とBOLA | outsider、別tenant、missing、repeatの同一`404`を確認した |
| 63〜73分 | audit | field、6 decision、bounded retentionを確認した |
| 73〜85分 | submissionとcheck | 4 checkすべてがpassした |
| 85〜90分 | 実務転用とstop | source of recordを1件特定し安全に終了した |
| 90〜105分 | 読解5問 | 4/5以上を確認し、誤答は指定見出しへ戻った |

## 教材既定値

| 項目 | 教材実装 |
| --- | --- |
| PEP / authentication boundary | `project-app` |
| PDP / resource source of record / mutation owner | `project-core` |
| resource | `p-100`、tenant `t-100` |
| owner | Alice / `user-100` |
| viewer | Bob / `user-200` |
| same-tenant outsider | Carol / `user-300` |
| cross-tenant subject | Dave / `user-400`、tenant `t-200` |
| unauthenticated response | generic `403 SESSION_UNAVAILABLE`、challengeなし |
| concealed response | generic `404 PROJECT_NOT_FOUND` |
| transaction | synchronous copy-and-commit |
| audit retention | memory内64件、古いentryから削除 |

account identifierとpasswordはscenario内部の教材値です。受講者に転記させず、runtime evidenceへ保存しません。

## 教える境界

### `401`、`403`、`404`を暗記問題にしない

この実行APIはCookie sessionを前提とし、HTTP認証schemeのchallengeを行いません。未認証をgeneric `403`にまとめ、`WWW-Authenticate`を返しません。認証済みviewerも`403`ですが、理由は権限不足です。

resource秘匿policyが適用されるoutsider、別tenant、missing、repeatは同じ`404`です。API仕様によっては別の選択もあり得るため、「利用者状態」「challenge方式」「秘匿要件」を先に確認させます。`401`とchallengeは第05回へ送ります。

### browser申告値を認可の正にしない

Bobのrequestにはowner、別tenant、別principalを示すheaderを混ぜます。それでもCookie sessionのprincipalとproject-coreのmembershipだけで判定します。hidden input、local storage、JWT claimなども、発行者・検証・用途を確認せずsource of recordと呼ばないようにします。

### BOLAをIDの難読化だけで防いだと教えない

project IDが推測困難でも、requestごとのsubject-resource-action判定は必要です。この教材は単純な`p-100`を使い、IDを知っていてもrelationがなければ操作できないことを見せます。

### auditとapplication logを混同しない

policy auditはdecisionを説明する最小fieldだけを持ちます。request dump、Cookie、password、Session ID、control headerは含めません。教材のbounded memory auditは、永続化、改ざん耐性、監視連携を実装したproduction監査ではありません。

### atomicityの意味を限定する

この実装は単一processのsynchronous copy-and-commitです。許可なら対象resourceを1件削除してallow auditを1件追加し、拒否ならresourceを変更せずdeny auditを1件追加します。database transactionや分散systemのexactly-onceを実証してはいません。

## 採点rubric

| Check | 合格条件 | 典型的な不合格 |
| --- | --- | --- |
| `AA04-C1` | 未認証403、challengeなし、audit 0、Cookie principal、server属性、header無効 | 401だけを返す、role headerを信用する |
| `AA04-C2` | owner 204 + 削除 + allow audit、viewer 403 + 無変更 + deny audit | viewer許可、decisionとmutationを別々に扱う |
| `AA04-C3` | outsider、別tenant、missing、repeatが同一404 | 存在有無をresponseで区別する |
| `AA04-C4` | 6 decision、6 field限定、secretなし、64件上限 | request全体保存、成功だけ記録、無制限保持 |

部分合格は設けません。4件すべてのruntime条件と回答が一致した場合だけ合格です。

## 誤答への問い返し

- 「そのprincipalはCookie sessionから得ましたか、request headerから得ましたか」
- 「Bobがownerと書いたheaderを送ると、source of recordのmembershipは変わりますか」
- 「拒否したrequestの後も`p-100`は存在しますか」
- 「Carolに`p-100`の存在を知らせる要件がありますか」
- 「未認証requestはproject-coreのpolicy decisionでしたか」
- 「audit entryだけからpasswordやCookieを復元できませんか」

## 復旧と安全

| 状況 | 講師の対応 |
| --- | --- |
| JSON破損 | templateとfieldを比較し、破棄合意がある場合だけresetする |
| port競合 | 所有者不明processを教材から停止しない |
| 期待外のstatus | Cookie session、principal、project relationの順に追う |
| secret露出 | 共有を止め、実credentialなら失効・変更し、教材をresetする |
| `404`の誤解 | resource秘匿policyの対象と、viewerの権限不足を分ける |

## 授業後に記録するもの

- setup、demo、observe、編集、check、stopの所要時間
- 各checkの初回pass率と再提出回数
- principalとrole、`403`と`404`、認証拒否とpolicy拒否の誤答分布
- 偽装headerを信用した人数
- raw credentialやsession露出、予定外介入、安全でないprocess操作の有無

記録にはpseudonymousな受講者IDと正規化したcheck結果だけを使い、identifier、Cookie、Session ID、hostname、home pathを保存しません。
