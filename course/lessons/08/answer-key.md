# 第08回 解答と根拠

予測、`demo`、`runtime.json`の確認後に参照します。

```json
{
  "schemaVersion": 1,
  "lessonId": "08",
  "answers": {
    "AA08-C1": {
      "platform": "samba-ad-compatible-not-microsoft-ad-ds-or-freeipa",
      "directory": "verified-ldaps-service-search-user-bind-group-search",
      "identity": "objectguid-derived-opaque-stable-id",
      "kerberos": "same-samba-platform-separate-from-ldaps-app-auth",
      "scope": "no-gpo-windows-join-or-product-generalization"
    },
    "AA08-C2": {
      "mapping": "explicit-group-to-role-policy",
      "organization": "engineering-group-is-not-an-app-role",
      "mover": "existing-session-stale-until-revalidation-then-new-login",
      "leaver": "disable-blocks-new-auth-existing-session-needs-revalidation",
      "serviceAccount": "read-only-write-rejected"
    }
  },
  "diagnosis": {
    "D1": "directory-state-and-app-session-state-have-different-lifecycles",
    "D2": "dn-and-email-can-change-objectguid-derived-key-remains-stable",
    "D3": "group-membership-is-input-to-explicit-app-policy-not-the-role-itself",
    "D4": "generic-login-rejection-does-not-revoke-existing-app-sessions"
  }
}
```

## 根拠

- runtimeはSamba AD互換DCであり、Microsoft AD DSまたはFreeIPA runtimeではない。GPOとWindows joinも検証対象外である。
- applicationはruntime CAをtrustし、`dc.ad.example.test`のhostnameを検証するLDAPSでservice bind、structured user search、resolved-user bind、group searchを行う。
- application keyはbinary `objectGUID`をruntime keyでHMACしたopaque IDである。DNを別OUへmoveしても同じIDになる。
- `CourseAppViewer`と`CourseAppEditor`は明示mappingで`viewer`と`editor`へ変換する。`Engineering`は組織所属を表すだけでroleを与えない。
- Mover直後の既存sessionは古い`viewer`を保持する。再検証がdirectory差分を見つけて旧sessionを失効させ、新規loginが`editor`を得る。
- Leaverでdirectory accountをdisableすると新規bindはgeneric 422で失敗するが、既存application sessionは再検証まで残る。緊急失効にはapplication側の仕組みが必要である。
- `kinit/klist`は同じSamba DCのKerberos KDCを確認するが、このapplication loginはLDAPS経路である。
