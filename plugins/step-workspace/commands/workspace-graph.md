---
description: "生成 monorepo 包依赖图（mermaid）落盘 docs/workspace-graph.md，并检测循环依赖"
argument-hint: [--out docs/workspace-graph.md]
---

# /workspace-graph — 依赖图与环检测

<!-- GRAPH-RULES-START -->
```json
{
  "edges": "workspace 内部依赖（workspace:* / path 依赖 / go.work replace）为实线；外部依赖不画",
  "mermaid": "graph LR，节点为包短名，落盘 docs/workspace-graph.md（C5：终端只给路径与统计）",
  "cycle": "拓扑排序检测循环依赖；有环时列出环节点链并标注位置",
  "no_exec": "纯静态解析清单文件，不调用包管理器"
}
```
<!-- GRAPH-RULES-END -->

## 流程

1. 读取 workspace 清单，解析各包的内部依赖边。
2. 生成 mermaid 图落盘；终端给包数/边数统计。
3. 拓扑排序检测环；无环给出分层顺序（可作构建顺序参考）。

## 输出格式

统计（包数 / 内部边数 / 环：无或有）→ 构建顺序参考（无环时）→ 图文件路径。
