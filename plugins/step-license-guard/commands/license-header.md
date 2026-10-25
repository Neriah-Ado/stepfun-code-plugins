---
description: "批量校验/补写源文件 SPDX 版权头：默认 dry-run 只列差异，写盘前逐批确认"
argument-hint: [路径或目录] [--template "<模板>"] [--apply]
---

# /license-header — SPDX 头管理

<!-- HEADER-RULES-START -->
```json
{
  "scan": "默认扫描 src/ 与顶层源码目录，按扩展名映射注释语法（.py #、.js .ts //、.rs // 等）",
  "template": "默认 SPDX-License-Identifier: <仓库 LICENSE 的 SPDX>；--template 自定义时校验首行为 SPDX-License-Identifier",
  "dry_run": "默认 dry-run：只列「缺头/错头/多余」三张清单，不写任何文件",
  "apply": "--apply 时按清单分批写盘，每批先展示 diff 再确认；已有非 SPDX 版权行原样保留不删除",
  "skip": "自动跳过 node_modules / .git / 构建产物目录与二进制文件"
}
```
<!-- HEADER-RULES-END -->

## 流程

1. 扫描目标文件，检测首部是否含 `SPDX-License-Identifier`；含其他版权注释的归「错头候选」单独列出，不自动改。
2. dry-run 输出三清单（缺/错/多余）与拟写入的头内容。
3. `--apply` 分批（每批 ≤ 20 文件）展示 diff、确认后写盘。
4. 结束提示：提交信息建议 `chore: 统一源文件 SPDX 许可头`。

## 输出格式

三张清单（计数 + 文件列表，超 20 个只列前 20）→ 拟写入头 → apply 状态（未触发则说明 dry-run）。
