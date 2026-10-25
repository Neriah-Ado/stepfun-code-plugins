---
description: "分析本地日志文件：错误模式聚类、时间线、频率 Top；大文件先本地截断再喂模型，完整报告落盘 docs/log-report/"
argument-hint: <日志文件路径> [窗口，如 24h / 全部]
---

# /log-analyze — 日志错误透视

**C5 截断红线**：对话里只出现统计结果与样本行，单次喂给模型的原始片段 ≤ 200 行；完整输出写 `docs/log-report/<文件名>-<日期>.md` 后只给路径。

<!-- LENS-RULES-START -->
```json
{
  "cluster": "以堆栈首帧/错误码/异常类名为归并键（tests/lib/ci-log.mjs 的分类约定同源）；同键合并计数，取首末时间戳",
  "sample": "每组取最典型 1-3 行（首个报错 + 最大重复行），喂模型前先脱敏",
  "mask": "Authorization/secret/token/key 后的值、Bearer 头、URL 查询串中的凭据参数替换为 ***",
  "timeline": "有 ISO/常见时间戳时按窗口切桶计数；无时间戳降级为纯聚类并在报告中声明",
  "limits": { "read_lines": 200000, "sample_lines": 200, "groups_shown": 20 }
}
```
<!-- LENS-RULES-END -->

## 流程

1. 本地分块读取（按 LENS-RULES 上限），统计行数、时间范围、级别分布（ERROR/WARN/INFO）。
2. 按 cluster 键聚类：组名、计数、首末时间、样本行（脱敏后）。
3. 生成报告落盘：概览 → 聚类表 → 时间线（文本条形）→ 附录（完整样本）。
4. 终端汇报：Top 5 组的一句话摘要 + 报告绝对路径，不内联报告全文。

## 输出格式

Top 5 错误组摘要 → 级别/时间分布两行 → 报告路径。文件不存在或 0 字节时直接说明并停止，不猜测其他路径。
