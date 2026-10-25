---
description: "对比 .env 与 .env.example 或多环境文件，列出缺失/多余 key 与不一致；所有值默认脱敏，不外发"
argument-hint: [--left .env] [--right .env.example]
---

# /env-diff — 环境变量对比

**脱敏红线**：默认输出只显示 `前4字符****（长度N）`；`--show` 原文输出前必须单独向用户确认，且只确认单个 key。

<!-- DIFF-RULES-START -->
```json
{
  "default": { "left": ".env", "right": ".env.example" },
  "parse": "仅支持 KEY=VALUE、# 注释与空行；空值/引号值保留字面量；shell 展开（$VAR、反引号）原样保留不求解",
  "compare": ["left 缺失（right 有）", "left 多余（right 无）", "key 相同但空/非空不同（只比对空与非空，不比对值）"],
  "mask": "所有值脱敏展示；文件名与 key 全量展示",
  "no_network": "纯本地读取，不请求任何远端"
}
```
<!-- DIFF-RULES-END -->

## 流程

1. 读取两侧文件，按 DIFF-RULES 解析；解析到异常行（无 `=`、缩进）跳过并计数警告。
2. 三个方向逐一对比，输出表格（key / 左侧状态 / 右侧状态 / 掩码值）。
3. 给行动建议：left 缺失 → 提示从 right 拷贝并填值；left 多余 → 提示确认是否应补进 example。
4. `.gitignore` 检查：`.env` 未被忽略时显著告警并给出补行建议。

## 输出格式

对比表格 → 解析警告 N 条 → .gitignore 状态 → 行动建议。全程不内联任何完整密钥。
