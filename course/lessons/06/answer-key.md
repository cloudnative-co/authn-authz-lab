# Lesson 06 解答と根拠

正解JSONは`README.md`の手順4にあります。重要なのは値の暗記ではなく、実traceとの対応です。

- `service-search-then-user-dn-bind`: service account bindは検索権限を得る操作です。user passwordを確認するのは、検索結果のuser DNで行う別のsimple bindです。
- `distinguished-name-identifies-entry`: DNはdirectory tree内のentryを一意に指す名前です。表示名ではありません。
- `named-values-on-entry`: `mail`、`cn`、`member`はentryが持つattributeです。
- `member-equals-user-dn-search`: groupOfNamesの`member` attributeとuser DNをEqualityFilterで照合します。
- `reject-before-network`: 空passwordをsimple bindへ渡すとunauthenticated/anonymous bindとの混同を招くため、client生成前に拒否します。
- `structured-equality-filter`: raw inputをLDAP filter文字列へ連結せず、ldaptsのEqualityFilterへvalueとして渡します。
- `generic-422-without-http-challenge`: wrong、unknown、empty、injectionからaccount存在や失敗理由を外部へ分けません。HTTP schemeのchallengeではないので`WWW-Authenticate`も付けません。
- `least-privilege-read-only-not-admin`: applicationはpeople/group searchだけを許可したservice accountを使います。user bindは本人確認だけに使い、password modify権限も与えません。
- `StartTLS-or-LDAPS-with-certificate-validation`: cleartext LDAPはloopback trainingだけです。

`runtime.json`にはraw identifier、password、service bind password、container ID、Compose project名、install IDを保存しません。

generic 422はtiming side-channelまで同じにする証明ではありません。unknown userはuser bindを行わず、wrong passwordは行います。またDNはrenameやmoveで変わり得るため、長期不変IDという回答にはしません。
