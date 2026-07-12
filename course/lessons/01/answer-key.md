# 第01回 解答と根拠

このファイルは採点者と復習者向けです。初回の回答を提出してから参照してください。

## 採点基準

- `AA01-C1`: 10事例中9件以上を正しく分類する
- `AA01-C2`: 5つの責任境界をすべて正しい検証者へ対応づける

片方だけを満たしても合格にはなりません。事例分類は1件の読み違いを許容しますが、検証責任の対応は全件を必須にします。

## 事例分類

| 事例 | 正答 | 根拠 |
| --- | --- | --- |
| `trace-01` | `authentication` | 保存済みハッシュとの照合に成功し、利用者アイデンティティを確定している |
| `trace-02` | `authentication` | 主体を確定する前の資格情報検証で拒否している |
| `trace-03` | `session` | 資格情報を再検証せず、Session IDに対応する状態と失効を検証している |
| `trace-04` | `session` | ログアウトで無効化されたセッションを拒否している |
| `trace-05` | `authorization` | 確定済みの主体、対象、操作、ロールを使って削除を許可している |
| `trace-06` | `authorization` | セッションは有効だが、viewerの削除操作をポリシーが拒否している |
| `trace-07` | `federation` | SPが外部IdP由来のSAML ResponseとAssertionを検証してアイデンティティを受け入れている |
| `trace-08` | `federation` | RPがOpenID Connectの応答とID Tokenを検証して外部アイデンティティを受け入れている |
| `trace-09` | `delegated-authorization` | Resource ServerがJWT Access Tokenとscopeを検証している。対象projectのアプリ内認可は別に残る |
| `trace-10` | `delegated-authorization` | Access Token自体は有効だが、必要なscopeがないためアプリ内認可へ進む前に拒否している |

`trace-07`から`trace-10`は実行時に採取したプロトコル証跡ではありません。分類用に用意された事例の説明であり、project-appがSAML、OpenID Connect、OAuthを実装済みであることを示しません。

## 検証者の対応

| 責任境界 | 正答 | 根拠 |
| --- | --- | --- |
| `authentication` | `credential-verifier` | パスワードなどの資格情報を検証して主体を確定する |
| `session` | `session-middleware` | Session ID、期限、失効、サーバー側状態を照合する |
| `authorization` | `policy-decision-point` | 主体、対象、操作、属性やロールからallowまたはdenyを決める |
| `federation` | `relying-party` | 外部発行者から受け取った応答とtokenまたはassertionを検証する |
| `delegated-authorization` | `resource-server` | Access Tokenの有効性、対象、期限、scopeを検証する |

## 誤答の見方

### 認証とセッションを混同した

パスワードなどの資格情報を確認して主体を確定する処理が認証です。認証後のリクエストでSession IDを照合する処理はセッションです。Session IDが無効でも、元のパスワードが誤っていたとは限りません。

### セッションと認可を混同した

セッションが有効であることは、利用者を復元できたことを示します。対象projectの削除が許可されるかは別の認可判断です。`trace-06`ではセッション成功後に認可で拒否しています。

### フェデレーションと委任認可を混同した

ID TokenやSAML Assertionは、アプリが外部の認証結果を受け入れる場面で使います。Access Tokenは、Clientへ委任されたAPIアクセス権をResource Serverが受け入れる場面で使います。発行者、用途、受信者、検証者を分けて確認します。

### IdPがアプリ内認可も決めると考えた

IdPがgroupなどの属性を渡すことはありますが、特定のprojectに対する操作可否は、アプリの業務データとポリシーを持つ認可側で判断します。外部identityを受け入れたことだけで、全resourceへの操作を許可しません。
