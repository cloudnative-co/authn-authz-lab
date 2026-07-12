# Lesson 06 講師ガイド

対象は、第01回で認証、session、認可、federation、委任認可の責任境界を区別できる初学者です。第01回のruntime stateは不要です。完全コースの標準時間は105分です。

## 授業前

1. macOS arm64、Node.js 24、Docker Desktopで`node course.mjs lesson 06 doctor`が`pass`になることを確認します。
2. cold buildを含むsetupに時間を確保します。学習者へDockerコマンドを手入力させません。
3. port 1389を使う他の環境を停止します。runnerはforeign resourceを停止しません。

## 90分の進行

| 時間 | 内容 | 確認すること |
| ---: | --- | --- |
| 0〜10分 | 前提と予測 | bind/searchの順序と拒否位置を実行前に答えた |
| 10〜25分 | bind、search、DN、attribute | service accountとuser DNの役割を分けた |
| 25〜45分 | doctor、setup、demo | Dockerを手動操作せず、実OpenLDAPをrunnerで起動した |
| 45〜60分 | 成功・拒否trace | wrong、unknown、empty、injectionの差と同一422を読んだ |
| 60〜75分 | 回答とfresh check | `AA06-C1`と`AA06-C2`をruntime根拠付きでpassした |
| 75〜85分 | production境界 | TLS、identity link、timing、ACLを教材値から分けた |
| 85〜90分 | stop | 回答を残し、教材所有resourceだけを停止した |
| 90〜105分 | 読解5問 | 4/5以上を確認し、誤答は指定見出しへ戻った |

## 観察させる順序

Alice成功traceの`bind > search > bind > search`を、service account bind、people search、user DN bind、group searchへ対応づけます。DN、attribute、groupを板書上でも別の列にします。

wrongとunknownはnetworkへ到達しますが同じ422です。emptyは同じ外部422でもnetworkへ到達しません。filter injectionはnetworkへ到達し、structured EqualityFilterでliteral valueとして検索され、no matchになります。

unknownはpeople searchで止まり、wrongはuser DN bindまで進むため、同じ422でもtiming同一性は証明しないと説明します。dummy bindの追加を正解として誘導せず、timing測定、rate limit、監視、MFAを別の対策層として扱います。

DNはtree内のentryを指しますが、renameやmoveをまたぐ長期不変IDではありません。sampleのuid投影を本番identity linkの見本にせず、directory製品の不変identifierとnamespaceを確認させます。

Lesson 05のBasic challengeと比較し、401を「login失敗一般」のstatusとして使わない理由を確認します。

## 採点

AA06-C1とAA06-C2は両方必須です。submissionだけが正しくても、fresh actual LDAP scenarioが失敗すれば不合格です。runtime/evidenceへcredentialやcontainer control値が混入した場合も不合格です。

## 障害対応

- Docker未導入、daemon停止、Compose欠落、port競合はdoctorのreasonCodeに従います。
- setup中断後は同じsetupを再実行します。install ID、Compose project、label、config digestが一致する一意のorphanだけが採用されます。
- ownership mismatchやconfig driftでは手動`docker rm`を案内せず、教材revisionと`diagnose`を確認します。
- 最終手段のpurgeもrecorded IDとexact labelsを検証し、foreign resourceを削除しません。

## production補足

実務ではTLS、証明書検証、接続数制御、directory側の監査、credential rotation、可用性設計が必要です。このLessonはloopback上のprotocol境界と最小権限に範囲を限定しています。

開講profileは現時点でmacOS arm64 / Node.js 24 / Docker Desktopだけです。human pilotと固定releaseは未完了です。Debian mirrorから固定packageが消える可能性があるため、長期運用する授業ではsnapshot repositoryまたは事前build image digestが固定されるまで、学期途中の再buildを前提にしません。
