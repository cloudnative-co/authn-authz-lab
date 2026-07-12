# Lesson 06 実OpenLDAP vertical slice設計

## 目的

学習者は手動で `docker compose` を操作せず、course runnerだけで実OpenLDAPを起動し、service account search、検索結果DNでのuser bind、group searchを実行する。採点は毎回fresh HTTP scenarioから実LDAPへ接続した結果だけを使う。

## 信頼境界と所有権

- Docker CLI、daemon、Compose、TCP 1389をLesson 06 doctorで個別診断し、利用不能時はreasonCodeと復旧手順を返す。
- Compose project名はcourse stateの128-bit install IDだけから決定する。
- containerはcourse ID、install ID、resource ID、Compose project、serviceのlabelで識別する。container ID、選択label、正規化Compose config digestをstateへ原子的に記録し、制御直前に全項目を再検証する。
- 記録前にCLIが中断しても、同一label集合のcontainerが一意でconfig digestが一致するときだけorphanとして採用する。曖昧、drift、不一致はfail closedとする。
- portを占有するだけのprocessや、labelが一致しないcontainerは停止・削除しない。

## Composeとsecret

- Lesson 06専用Compose fileは`ldap` serviceだけを定義する。runnerは常にservice名を引数で指定し、`build ldap`と`up --no-deps --wait ldap`だけを実行する。
- Dockerfileのbase imageはmulti-architecture digestで固定する。管理者、検索用service account、教材userのpasswordはimage layerへCOPYせず、course stateに0600で作るruntime secretからcontainer起動時にhash化する。
- containerのrootfsはread-onlyとし、実行時に設定、directory database、socket、password hashを置く`/etc/ldap/slapd.d`、`/var/lib/ldap`、`/run/slapd`、`/tmp`だけをtmpfsにする。Lesson 06では永続化しないため、stop後にcontainerを削除すればruntime hashも残さない。
- slapd log levelは通常運用相当に抑え、password、bind password、LDIFの平文値をstdout/stderrへ出さない。
- `ldap://`は127.0.0.1だけにpublishするtraining deviationである。production判断はStartTLSまたはLDAPSを必須とする。
- Docker Desktopのinternal networkではhostからpublishしたLDAP portへ到達できないことを実機で確認したため、Compose networkはinternalにしない。外部interfaceへの公開は127.0.0.1 bindで防ぎ、network隔離を実現したものとは扱わない。

## Directory認証

1. NFC正規化とbyte上限を検査し、空passwordはclient生成前にgeneric failureとする。
2. read-only service accountでpeople subtreeを`objectClass`と`mail`のstructured EqualityFilterにより検索する。size/time limitを設定する。
3. 一意に得たuser DNで別connectionをsimple bindする。ここがpassword authenticationである。
4. service account connectionでgroups subtreeを`member = user DN`として検索する。
5. wrong password、unknown user、filter injection、空passwordは同じ外部status/bodyとする。directory障害だけはgeneric 503へ分離する。

generic 422はユーザー列挙耐性の一要素であり、timing side-channelまで同一であることは示さない。unknown userではuser bindへ進まず、wrong passwordではuser bindを行うため、LDAP応答時間やnetwork latencyを含む差は別途評価が必要である。教材の範囲では不自然なdummy bindを追加しない。

## 観察と採点

- traceにはoperation種別、actor role、DNの役割、attribute名、limit、成功/拒否だけを残す。raw input、password、bind password、container ID、Compose project名、install IDは残さない。
- scenarioはAlice成功とgroups、wrong、unknown、empty、injectionを実行する。emptyはnetwork未到達、injectionはstructured filterかつno matchを確認する。
- AA06-C1はbind/search/DN/attribute/groupの区別と実LDAP成功を、AA06-C2は入力拒否、generic failure、least privilege、transport deviation、redactionを採点する。

## lifecycle

- `setup`: secret準備、orphan復旧、LDAP build/up、project-app起動、workspace作成。
- `stop`: project-appを所有確認して停止後、LDAP containerを検証して停止。回答とsecretは保持。
- `reset`: project-app停止、LDAP container削除、secret再生成、LDAP再作成、project-app再起動、workspace再生成、epoch更新。
- `purge`: course-wide cleanupで所有containerを検証・削除してからstateを隔離削除する。
- Lesson 01〜05だけを使ったstateにはcontainer管理directoryが存在しないため、Docker未導入でも従来のlifecycleを維持する。

## 検証

- pure/unit: input bound、空password、EqualityFilter、generic failure、trace redaction、assessment。
- fake Docker: CLI/daemon/Compose/port失敗、timeout、output上限、abort、orphan adoption、config drift、foreign container非制御。
- actual Docker: runner doctor→setup→demo→observe→check→stop→setup→reset→purgeをtemp repositoryで実行し、Alice groupsと拒否経路、container所有権、秘密非永続化を確認する。
- regression: Node 24で既存full testを実行し、Lesson 01〜05のnon-Docker flowを確認する。

## release blocker: 長期再現性

2026-07-12にmacOS arm64 / Docker Desktopで`docker build --no-cache`を実行し、固定base digestからDebian Bookwormの`slapd=2.5.13+dfsg-5`と`ldap-utils=2.5.13+dfsg-5`を取得してbuildできることを確認した。ただしbase image layer自体はlocal cacheから取得されており、Debian mirrorが将来もこの旧versionを配布し続ける保証にはならない。

したがって、digestとapt version pinだけで無期限に再現可能とは扱わない。固定releaseではDebian snapshot repositoryを使うか、CIで事前buildしたmulti-architecture imageをdigestで配布し、SBOMとprovenanceを添える必要がある。この配布経路、amd64 build、offline bundleが未検証の間はLesson 06をsupportedへ昇格しない。
