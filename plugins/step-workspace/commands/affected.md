---
description: "从 git diff 变更文件计算 monorepo 受影响 packages（声明依赖闭包），给出最小验证/构建命令建议"
argument-hint: [--base origin/main] [--file <单文件>]
---

# /affected — 受影响包计算

<!-- AFFECTED-RULES-START -->
```json
{
  "detect": "workspace 文件识别：pnpm-workspace.yaml / package.json workspaces / lerna.json / Cargo.toml [workspace] / go.work；全部缺失 → 明确说明非 monorepo 并停止",
  "mapping": "变更文件前缀匹配所属 package；根级配置（workspace 文件、tsconfig.base、.github 等）视为影响全部包",
  "closure": "受影响 = 变更包 ∪ 依赖闭包（沿 package.json dependencies/devDependencies 与 workspace:* 协议反向传播）；分层展示直接/传递",
  "dynamic": "动态 require/import、运行时字符串拼接的引用不在闭包内，输出末尾固定声明此局限",
  "verify_cmds": "按生态给最小命令建议（如 pnpm -r --filter <pkg> test），命令本身不自动执行"
}
```
<!-- AFFECTED-RULES-END -->

## 流程

1. 识别 workspace 与 packages 清单（路径 + 名称）。
2. 取 diff（`--base` 默认 origin/main，取不到时回退 HEAD~1 并声明）映射变更包；根级配置按全量影响处理。
3. 沿依赖闭包反向传播，分层输出：变更包 → 直接受影响 → 传递受影响。
4. 每层给最小验证命令建议（不执行）。

## 输出格式

workspace 类型与包总数 → 三层受影响清单（表格）→ 建议命令 → 动态引用局限声明。非 monorepo 时只输出说明。
