<a id="AA02-A1"></a>
# 第02回 読解評価の解答と根拠

先にREADME.mdの5問へ回答してください。4問以上で合格です。不正解は指定見出しへ戻り、理由を言葉にしてから再回答します。

| 問題 | 正解 | 読み直す見出し |
| --- | --- | --- |
| AA02-Q1 | C | 保存側では何をしているか |
| AA02-Q2 | A | 照合側では何をしているか |
| AA02-Q3 | B | 実HTTPで成功と拒否を読む |
| AA02-Q4 | C | onlineとofflineを分ける |
| AA02-Q5 | A | onlineとofflineを分ける |

## AA02-Q1

正解は **C** です。一意なsaltを各credentialへ使うため、同じpasswordでも保存表現は一致しません。

読み直す見出し: [保存側では何をしているか](https://blog.cloudnative.co.jp/articles/authn-authz-02-password-authentication/)

## AA02-Q2

正解は **A** です。password hashは復号せず、保存済みparameterとsaltを使って候補を再計算して比較します。

読み直す見出し: [照合側では何をしているか](https://blog.cloudnative.co.jp/articles/authn-authz-02-password-authentication/)

## AA02-Q3

正解は **B** です。失敗理由の差からaccount存在を列挙されにくくするためです。timing差まで自動的に消えるわけではありません。

読み直す見出し: [実HTTPで成功と拒否を読む](https://blog.cloudnative.co.jp/articles/authn-authz-02-password-authentication/)

## AA02-Q4

正解は **C** です。rate limitはserviceへ届くonline試行を制限します。漏えい済みhashへのoffline試行にはKDF強度など別の対策が必要です。

読み直す見出し: [onlineとofflineを分ける](https://blog.cloudnative.co.jp/articles/authn-authz-02-password-authentication/)

## AA02-Q5

正解は **A** です。per-identifier制限だけでは全体KDF容量の枯渇を防げないため、globalな容量保護が必要です。

読み直す見出し: [onlineとofflineを分ける](https://blog.cloudnative.co.jp/articles/authn-authz-02-password-authentication/)
