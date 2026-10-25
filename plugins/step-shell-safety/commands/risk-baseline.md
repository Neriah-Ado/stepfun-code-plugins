---
description: "维护项目级命令风险白名单：查看/新增/移除 config/risk-baseline.json 条目，让团队已知的安全模式不再重复告警"
argument-hint: [--list | --add "<命令模式> <理由>" | --remove <序号>]
---

# /risk-baseline — 风险白名单

白名单文件为项目内 `config/risk-baseline.json`，随仓库分发、可评审；**默认不存在**，首次使用时经用户确认后创建。

<!-- BASELINE-RULES-START -->
```json
{
  "file": "config/risk-baseline.json",
  "entry": { "pattern": "前缀或完整命令字面量，不支持通配符", "reason": "一句话理由（评审用）", "added_by": "作者", "date": "YYYY-MM-DD" },
  "write": "所有写操作（--add/--remove）先展示 diff 再执行；文件已存在时保留原有条目，不覆盖",
  "scope": "白名单只降级（block→warn、warn→note），永不把任何命令升为安全免检"
}
```
<!-- BASELINE-RULES-END -->

## 流程

1. `--list`：读取并表格展示全部条目（pattern / reason / added_by / date）；文件不存在时说明现状并停止。
2. `--add`：先跑一次 `/shell-check` 确认该命令当前等级，理由栏必须写明「为什么这个风险在本项目可接受」；拒绝添加 block 级命令。
3. `--remove`：按序号移除，展示被删条目确认后写盘。
4. 提醒：白名单应随代码评审合入，避免个人本地改动导致团队基线漂移。

## 输出格式

操作结果一行 → 变更 diff → 下一步建议（如提交该文件）。
