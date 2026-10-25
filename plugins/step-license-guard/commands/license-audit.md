---
description: "汇总项目依赖的开源许可：npm（读 node_modules）pip（pip-licenses，缺失给指引）go（go.mod 直读），按 allow/warn/deny 分级并落盘报告"
argument-hint: [--config config/licenses.json] [--out docs/license-report.md]
---

# /license-audit — 依赖许可审计

<!-- SPDX-RULES-START -->
```json
{
  "default_policy": { "allow": ["MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC", "0BSD", "Unlicense", "CC0-1.0"], "warn": ["LGPL-2.1-only", "LGPL-3.0-only", "MPL-2.0", "EPL-2.0", "CDDL-1.0"], "deny": ["AGPL-3.0-only", "AGPL-3.0-or-later", "GPL-2.0-only", "GPL-3.0-only", "SSPL-1.0", "EUPL-1.2"], "unknown": "无法解析的 SPDX 表达式一律 unknown，不猜归类" },
  "config": "--config 指定的 JSON 三表整体覆盖默认策略；文件不存在时用默认表并提示可自定义",
  "npm": "优先读 node_modules/*/package.json 的 license 字段；node_modules 缺失时用 npm ls --json（需网络）并声明",
  "pip": "优先 pip-licenses；缺失时输出 pip install pip-licenses 指引（G4），不裸报错",
  "go": "go.mod 直读模块清单；许可需模块缓存内 LICENSE 文件，缓存缺失的条目列 unknown 并说明",
  "report": "docs/license-report.md：汇总表（包/版本/SPDX/分级）+ deny 命中详单 + 口径说明"
}
```
<!-- SPDX-RULES-END -->

## 流程

1. 识别生态（package.json / requirements 或 pyproject / go.mod），可多生态并存。
2. 逐包取许可声明，按 SPDX-RULES 分级；表达式含 `WITH` 例外或 `OR` 双许可时逐条展开说明。
3. deny/unknown 命中给方向性建议（找同功能宽松许可替代），不替用户做合规结论。
4. 报告落盘（C5），终端只给统计行与命中清单摘要。

## 输出格式

统计行（总数/allow/warn/deny/unknown）→ deny 与 unknown 逐条摘要 → 报告路径 → 口径说明（声明来自包元数据，法律结论需人工确认）。
