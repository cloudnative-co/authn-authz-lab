<a id="AA09-A1"></a>
# 第09回 読解評価の解答と根拠

先にREADME.mdの5問へ回答してください。4問以上で合格です。不正解は指定見出しへ戻り、理由を言葉にしてから再回答します。

| 問題 | 正解 | 読み直す見出し |
| --- | --- | --- |
| AA09-Q1 | B | 実KeycloakのSSOを最後まで通す |
| AA09-Q2 | C | SAMLResponseとapp sessionは別物 |
| AA09-Q3 | A | actual正常系と拒否fixtureを混ぜない |
| AA09-Q4 | B | 署名だけでは足りない |
| AA09-Q5 | C | 署名だけでは足りない |

## AA09-Q1

正解は **B** です。IdPはbrowserを介してSAMLResponseをSPのACSへPOSTします。

読み直す見出し: [実KeycloakのSSOを最後まで通す](https://blog.cloudnative.co.jp/articles/authn-authz-09-saml-sso/)

## AA09-Q2

正解は **C** です。SAMLResponseは一回のfederation結果であり、SPは検証後に自分のapplication sessionを発行します。

読み直す見出し: [SAMLResponseとapp sessionは別物](https://blog.cloudnative.co.jp/articles/authn-authz-09-saml-sso/)

## AA09-Q3

正解は **A** です。何を実プロトコルで得て何をfixtureで変えたかを分けないと、証拠範囲を誤認します。

読み直す見出し: [actual正常系と拒否fixtureを混ぜない](https://blog.cloudnative.co.jp/articles/authn-authz-09-saml-sso/)

## AA09-Q4

正解は **B** です。署名は改ざん検知の一部で、誰が誰向けにいつ発行した応答かを別に検証します。

読み直す見出し: [署名だけでは足りない](https://blog.cloudnative.co.jp/articles/authn-authz-09-saml-sso/)

## AA09-Q5

正解は **C** です。応答・Assertionの一回性を記録し、同じ内容の再利用を拒否します。

読み直す見出し: [署名だけでは足りない](https://blog.cloudnative.co.jp/articles/authn-authz-09-saml-sso/)
