---
description: "跟踪日志尾部并按关键字过滤：只回显命中行数与脱敏样本，避免刷屏占用对话"
argument-hint: <日志文件路径> [--last N] [--grep 关键字]
---

# /log-tail — 过滤式尾部查看

<!-- TAIL-RULES-START -->
```json
{
  "default": { "last": 100, "grep": null },
  "read": "只读文件末尾 N 行（默认 100，上限 1000）；--grep 不区分大小写子串匹配",
  "echo": "命中 ≤ 20 行时逐行展示（脱敏）；超过只给计数 + 首 5 行样本 + 建议用 /log-analyze",
  "mask": "同 /log-analyze 的脱敏规则",
  "no_follow": "一次性快照，不做长驻 tail -f；需要持续观察时建议 /cron 定期调用"
}
```
<!-- TAIL-RULES-END -->

## 流程

1. 读文件末尾 N 行；文件小于 N 行时读全量并说明。
2. `--grep` 过滤后按 TAIL-RULES 决定逐行展示还是汇总。
3. 展示时每行截断到 300 字符，超长标注 `…(截断)`。

## 输出格式

命中计数 → 样本行或首 5 行 → 后续建议。文件不存在直接说明并停止。
