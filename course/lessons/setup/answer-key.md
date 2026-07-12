# 準備ラボ 合格条件

準備ラボは、次の3つのrequired checkと、最後のterminal purgeで判定します。

| Check | 確認対象 | 合格条件 |
| --- | --- | --- |
| `AA-SETUP-C1` | 実行環境 | Node.js 24、候補OS/CPU、依存lock、書込権限、空き容量、repository配置が診断を通る |
| `AA-SETUP-C2` | 初期化 | 教材所有markerとstateが同じsourceへ結びつき、setup履歴がある |
| `AA-SETUP-C3` | resetと削除 | reset前後に診断が成功し、実行世代が進み、terminal purgeで所有resourceが0件になる |

`lesson setup check`の`pass`だけでは完了しません。checkはevidenceを書き込むため、続く`purge --yes --json`が`pass`し、JSONの`diagnostics[]`内で`id: "resources.remaining"`である要素の`actual`が文字列`"0"`になるところまでが評価手順です。

## 期待する順序

```text
doctor    pass
setup     pass
diagnose  pass
reset     pass
diagnose  pass
check     pass + evidenceId
purge     pass + diagnostics[]のid="resources.remaining"要素でactual="0"
```

初回の`setup`が`safe-noop`だった場合、同じstateで過去にsetup済みです。fresh environmentからの準備ラボを評価する場合は、受講開始前のstateがないことを確認してから実施します。

`purge`が`safe-noop`になるのは、削除対象stateが最初から存在しない場合です。check後のterminal purgeでは内部evidenceが存在するため、通常は`pass`を期待します。
