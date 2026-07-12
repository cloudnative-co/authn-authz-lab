# 第03回 講師ガイド

対象は、第02回でpassword認証成功とsession発行を区別できる初学者です。授業時間は90分を想定します。

## 到達目標

- `AA03-O1`: Cookie、Session ID、Session Storeを保存場所と責任で区別できる
- `AA03-O2`: login時rotationと、absolute expiry、logout、server revocation後の拒否をruntime traceで確認できる

## 開講可能条件

次の全条件を講師環境と受講者用のclean copyで確認します。

1. `doctor → setup → demo → observe → 手編集 → check → stop`がREADMEどおり成功する
2. `AA03-C1`から`AA03-C4`を意図的な誤答で個別にfailできる
3. raw token、完全digest、password、subject identifierがobservation、evidence、logへ残らない
4. loopback HTTPで`Secure`を外した状態がtraining deviationとして明示される
5. `reset`と`stop`が別lessonの回答や所有者不明processを変更しない

1件でも未確認なら、図示とdomain testの解説だけを行い、実習の合否は付けません。

## 時間配分

| 時間 | 内容 | 講師が確認すること |
| ---: | --- | --- |
| 0〜10分 | 前提と予測 | rotation、logout、server失効を予測した |
| 10〜25分 | 3要素の分離 | Cookie、Session ID、Storeを説明できる |
| 25〜40分 | Cookie属性 | host-onlyとloopback逸脱を区別した |
| 40〜55分 | pre-authとrotation | 新旧tokenとrecord状態を追えた |
| 55〜70分 | expiryとlogout | absolute期限、server失効、Cookie削除を追えた |
| 70〜78分 | 管理側失効 | 有効期限前の拒否を確認した |
| 78〜87分 | submissionとcheck | 4 checkすべてがpassした |
| 87〜90分 | stop | raw tokenを記録せず終了した |
| 90〜105分 | 読解5問 | 4/5以上を確認し、誤答は指定見出しへ戻った |

## 教材既定値

| 項目 | 教材実装 |
| --- | --- |
| token | random 32 byte、unpadded base64url 43文字 |
| server lookup key | raw tokenのSHA-256 digest |
| pre-auth lifetime | 5分 |
| authenticated lifetime | login成功から30分のabsolute timeout |
| sliding timeout | 未実装 |
| max session records | 128 |
| max events | 256 |
| Cookie | `course_session`; HttpOnly; SameSite=Lax; Path=/; Domain省略 |
| production transport | HTTPS + Secure |
| 教材transport | loopback HTTPのためSecureを外すtraining deviation |

HTTP statusは、credential不一致をgeneric `422`、利用可能なsessionがない状態をgeneric `403`、online rate limitを`429`、認証状態の容量超過を`503`とします。この回はchallenge方式ではないため`401`を返しません。`401`を扱うときは`WWW-Authenticate`が必須であることを、第05回のHTTP Basic認証へ接続します。

domain unit testでは理解しやすい短い仮想時間へoverrideする場合があります。test用1000 msをproductionや教材既定30分として教えません。

## 進行上の注意

### tokenを教材資料へ転記しない

raw Session IDはcredentialです。講師のscreen共有、提出物、チャットに貼りません。traceの対応には短いdigest fingerprintとevent sequenceを使います。

### digest保存を万能化しない

server storeにraw tokenを置かないことは、store観察時の露出範囲を減らします。しかし、clientから送られたraw tokenのtransport保護、XSS、log、memory、Cookie設定、失効設計が不要になるわけではありません。

### rotationの順序を確認する

subjectとauthenticated expiryを検証し、新しいtokenを準備してから古いpre-auth recordを失効します。無効principalや時刻overflowで古いtokenだけを失う実装にはしません。

### logoutを片側処理にしない

server record失効とbrowser Cookie削除は目的が違います。盗まれたcopyの拒否にはserver失効、browserの継続送信停止にはCookie削除が必要です。

### loopback HTTPをproduction例にしない

`Secure`がないtraceを「これで十分」と見せません。training deviationとproduction postureを同じ画面で確認します。

## 採点rubric

| Check | 合格条件 | 典型的な不合格 |
| --- | --- | --- |
| `AA03-C1` | runtimeでtoken、digest store、Cookie属性、逸脱を確認し8 fieldが正答 | raw tokenをserver保存、HTTPをproduction承認と回答 |
| `AA03-C2` | new token発行とold token拒否を確認し2 fieldが正答 | pre-auth token再利用と回答 |
| `AA03-C3` | expiry、logout、Cookie削除、logout後拒否を確認し4 fieldが正答 | sliding、Cookie削除だけでserver失効と回答 |
| `AA03-C4` | subject単位失効とtoken拒否を確認し2 fieldが正答 | expiryまで利用可と回答 |

部分合格は設けません。全required checkを満たした場合だけ合格です。runtime traceなしにanswer keyを転記したsubmissionは再実行にします。

## 誤答への問い返し

- 「browserが次のrequestで送る値と、serverがMapのkeyにする値は同じ表現ですか」
- 「login前に攻撃者が知っていたtokenを、そのままauthenticatedへ変えてよいですか」
- 「Cookieを削除しても、別の場所へcopy済みのtokenはserverでどう扱われますか」
- 「最後のrequest時刻でexpiresAtが変わっていますか」
- 「Secureを外せる理由はloopback教材だからですか、それともHTTPが安全だからですか」

## 復旧と安全

| 状況 | 講師の対応 |
| --- | --- |
| JSON破損 | templateとfieldを比較し、破棄合意がある場合だけresetする |
| token取違え | raw tokenを表示せず、fingerprintとevent sequenceで新旧を照合する |
| port競合 | 所有者不明processを教材から停止しない |
| token露出 | 共有を止め、対象subjectをserver側から失効し、教材をresetする |
| `Secure`なし | loopback originを確認し、production利用を禁止する |

## 授業後に記録するもの

- setup、demo、observe、編集、check、stopの所要時間
- 各checkの初回pass率と再提出回数
- Cookie、Session ID、Storeを混同した人数
- rotation、absolute expiry、logout、server revocationの誤答分布
- raw token露出、予定外介入、安全でないprocess操作の有無

記録にはpseudonymousな受講者IDと正規化したcheck結果だけを使い、raw token、完全digest、identifier、hostname、home pathを保存しません。
