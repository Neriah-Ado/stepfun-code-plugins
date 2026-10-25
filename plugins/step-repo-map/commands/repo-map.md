---
description: "生成仓库地图：限深目录树、模块职责一句话、近 90 天 git 热点 Top 10，落盘 docs/repo-map.md"
argument-hint: [--depth 3] [--out docs/repo-map.md]
---

# /repo-map — 仓库地图

<!-- MAP-RULES-START -->
```json
{
  "tree": "目录树限深 3（可调），跳过 node_modules/.git/构建产物/锁文件；每目录标注语言/框架线索（从清单文件与扩展名分布推断）",
  "duty": "模块职责 = 一句话，依据 README/包描述/文件名与导出符号归纳；无依据的目录写 TODO 待补，绝不编造",
  "hotspot": "git log 近 90 天按文件提交次数 Top 10（口径：--since 90 天，含 merge 的普通提交计数）；无 git 历史则跳过并声明",
  "report": "docs/repo-map.md：目录树 → 模块职责表 → 热点表 + 统计口径与生成时间"
}
```
<!-- MAP-RULES-END -->

## 流程

1. 生成限深目录树，标注各目录的技术线索。
2. 逐顶层模块归纳职责：有依据写依据，无依据写 TODO。
3. git 热点统计（口径见 MAP-RULES），与职责表交叉：热点高但职责 TODO 的模块置顶提示「优先补认知」。
4. 报告落盘，终端给统计行与路径。

## 输出格式

统计行（目录数/热点命中数）→ 报告路径 → TODO 计数。不内联报告全文（C5）。
