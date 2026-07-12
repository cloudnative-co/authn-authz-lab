# Lesson 09 answer key

`submission.json`の正答は次です。raw SAMLResponse、NameID、Cookie、private keyは回答へ転記しません。

```json
{
  "schemaVersion": 1,
  "lessonId": "09",
  "answers": {
    "AA09-C1": {
      "flow": "sp-authnrequest-idp-login-post-response-acs-session",
      "bindings": "redirect-request-and-post-response",
      "trust": "metadata-certificate-pins-idp-signature-trust",
      "session": "created-only-after-complete-validation",
      "userAgentScope": "scripted-http-agent-not-gui-browser-proof"
    },
    "AA09-C2": {
      "signatures": "response-and-assertion-both-required",
      "semanticChecks": "issuer-audience-conditions-destination-inresponseto",
      "subjectConfirmation": "single-bearer-recipient-expiry-inresponseto",
      "replay": "request-response-assertion-one-time",
      "evidence": "omit-xml-nameid-cookie-private-key"
    }
  },
  "diagnosis": {
    "D1": "metadata-and-authnrequest-do-not-prove-sso-completed",
    "D2": "valid-signature-does-not-replace-recipient-and-audience-checks",
    "D3": "relaystate-and-inresponseto-bind-different-parts-of-the-flow",
    "D4": "app-session-is-local-and-created-after-saml-validation",
    "D5": "keycloak-success-does-not-generalize-to-every-idp-or-browser"
  }
}
```

## 診断の要点

- D1: メタデータとAuthnRequestは開始条件で、IdP login、Response POST、ACS検証、app sessionまで通って初めて今回のSSOが完了します。
- D2: 署名は改ざんと署名鍵の信頼を扱います。Audience、Destination、Recipientは「このSP、このendpoint向けか」を別に検証します。
- D3: RelayStateはUser Agent経由の往復をSPのlogin transactionへ結び、InResponseToはResponseとSubjectConfirmationDataをAuthnRequest IDへ結びます。
- D4: SAMLResponseはapp session Cookieではありません。SPが全検証後にlocal sessionを作ります。
- D5: Keycloakとscripted HTTP User Agentの成功範囲だけを主張します。別IdP、GUI browser、proxy、TLS終端は追加検証が必要です。
