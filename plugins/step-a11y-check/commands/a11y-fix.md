---
description: "按 /a11y-audit 报告定点修复：逐处给出最小 diff，确认后写盘；只修报告中的位置，不做全文件重排"
argument-hint: [--report docs/a11y-report.md] [条目序号或 all]
---

# /a11y-fix — 定点修复

<!-- FIX-RULES-START -->
```json
{
  "input": "读取 --report 指定的审计报告（默认 docs/a11y-report.md）；报告不存在时先提示运行 /a11y-audit",
  "unit": "一处问题一个最小 diff：只改涉事标签与其属性，不重排格式、不顺手重构",
  "confirm": "逐处展示 位置 / 问题 / 拟改 diff，用户确认后才写盘；all 为逐处连续确认而非静默全改",
  "recheck": "全部完成后重跑对应 detectors 的核查并在结尾给通过/剩余计数"
}
```
<!-- FIX-RULES-END -->

## 流程

1. 解析报告条目，按文件分组展示。
2. 逐条给最小 diff（替换属性、补 aria-label、加 label 关联等），说明为什么这样改。
3. 确认后写盘；用户要求跳过的条目标记 skipped 并保留在报告中。
4. 复核并汇报剩余。

## 输出格式

逐处 diff → 确认结果 → 复核计数（修复 / 跳过 / 未处理）。
