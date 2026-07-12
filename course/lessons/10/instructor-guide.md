# Lesson 10 instructor guide

対象は、第01回の責任境界を説明できる初学者です。第03回のsessionと第04回の認可は比較材料として推奨しますが、必須前提ではありません。過去回のruntime stateは不要です。完全コースの標準時間は140分です。

## 120分の進行

| 時間 | 内容 | 確認すること |
| ---: | --- | --- |
| 0〜15分 | 前提と四role | Resource Owner、Client、AS、Resource Serverを分けた |
| 15〜30分 | 予測、doctor、setup | state、PKCE、401/403を実行前に予測した |
| 30〜50分 | demoとobserve | 三originの実HTTPとpassword境界を確認した |
| 50〜75分 | one-fault拒否 | state、PKCE、code replay、redirect URIを比較した |
| 75〜90分 | Resource API | invalid Bearerの401とscope不足の403を比較した |
| 90〜110分 | submission、check、復旧 | AA10-C1/C2をpassし、reasonCodeから復旧できた |
| 110〜120分 | 実務転用とstop | Client登録、HTTPS、token秘匿へ対応づけた |
| 120〜140分 | 読解5問 | 4/5以上を確認し、誤答は指定見出しへ戻った |

GUI browserのfront-channel観察は任意です。required checkはrunnerのfresh scenarioで完了できるため、browser操作を受講必須条件にしません。

教材用credentialは `learner@example.test` / `course-password-for-oauth-lab` です。これはASのtraining accountにだけ入力させ、画面共有や証拠ファイルへ転記させません。

## よくある誤診

- 「PKCEがあるのでstate不要」: callback CSRF/transaction bindingとcode interceptionは別問題です。
- 「public clientにもsecretを埋める」:配布物やbrowserが保持する値は秘密として扱えません。
- 「JWTをdecodeしてAPIで使う」:このLessonのaccess tokenはopaqueです。Resource APIは認証済みintrospectionを使います。
- 「scope不足も401」:tokenはactiveで主体を認証できており、必要権限だけがないため403です。

## 合格判定

AA10-C1/C2の両方でfresh runtimeと回答が一致することが必須です。保存済みruntimeの編集、token値の提出、loopback HTTPを本番許可とする回答は不合格です。

固定portが使用中なら、別プロセスを無断停止せず、使用者を確認してから再実行します。

環境またはcheckで止まった場合は`node course.mjs lesson 10 diagnose`を実行し、`reasonCode`と`recovery`に従います。回答を破棄してよい場合だけ`reset`、通常終了は`stop`、全Lessonのstateを削除してよい場合だけcourse-wideの`purge`を使います。
