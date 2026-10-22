# AGENTS.md — Step Code 插件开发执行规范

> 本文件是所有 AI Agent 参与本项目开发的**唯一入口规范**。开始任何工作前必须完整阅读。
> 人读版背景文档：`../StepCode插件开发机会分析报告.md`（插件体系分析）、`../StepCode插件迭代开发计划.md`（迭代策略）。

## 1. 项目目标

为 Step Code（阶跃星辰终端 AI Agent，github.com/stepfun-ai/Step-Code，MIT）开发 12 个第三方插件，全部达到 v1.0.0+。插件为声明式形态：`step.plugin.json` 清单 + `skills/` `commands/` 目录（Markdown）+ 可选独立 MCP Server 进程。

## 2. 目录结构

```
stepcode-plugins/
├── AGENTS.md                  # 本文件：全局执行规范
├── roadmap.json               # 机器可读路线图与插件索引（进度总览）
├── plugins/
│   └── <plugin-id>/
│       ├── plugin.yaml        # 该插件唯一事实源：元数据+版本任务+验收标准+状态
│       └── (代码/清单/skills/commands 等实现产物，随开发产生)
└── _template/                 # 新插件起步骨架（如有）
```

## 3. 执行流程（每个任务循环）

1. **领取任务**：读 `roadmap.json` → 按优先级 P0 > P1 > P2、周次顺序，找到第一个 `status != "done"` 的插件 → 读其 `plugin.yaml` → 领取该插件当前版本中第一个 `done: false` 的任务。
2. **理解上下文**：任务的 `context` 字段给出实现要点；`acceptance` 是该版本的完成标准；`constraints` 是全局红线（见 §5）。
3. **实现**：小步提交，每完成一个原子任务立即验证。
4. **回写状态**（必须，一次任务一更新）：
   - 任务完成 → `plugin.yaml` 中对应任务 `done: true`
   - 版本全部任务 `done: true` 且验收标准全部满足 → 该版本 `status: done`，同时更新 `roadmap.json` 中该插件的 `latest_version` 与 `status`
   - 受阻 → 任务 `done` 保持 false，追加 `blocked_reason` 字段说明阻塞点
5. **汇报**：一句话进度 + 交付物路径，不粘贴大段日志。

## 4. 版本门禁（Definition of Done，每个版本发布前逐项自检）

| # | 检查项 | 通过标准 |
|---|---|---|
| G1 | 功能闭环 | 本版本全部任务 done，且在 ≥2 个真实项目（非玩具仓库）验证通过 |
| G2 | 清单规范 | `step.plugin.json`：`id` 匹配 `^[a-z0-9][a-z0-9._-]*$`；`requiresEnv` 声明完整；文件 <512KB |
| G3 | 权限安全 | 危险操作（rm / force push / git push / 写库 / 删容器）全部有确认步骤或白名单 |
| G4 | 降级路径 | 外部依赖（gh / docker / gitleaks 等）缺失时输出安装指引，不裸报错 |
| G5 | 文档 | README 更新、CHANGELOG 有本版本条目、核心命令有使用示例 |
| G6 | 兼容回归 | 前序版本功能不回退 |

## 5. 全局约束（红线，任何任务不得违反）

- **C1 MCP-first**：插件逻辑放独立 MCP Server 进程或 Markdown 提示词；不依赖 `entry` 可执行扩展（当前 Step Code 只记录不加载）。
- **C2 无 hooks / 无 lspServers**：清单不写这两个字段（不支持），需要事件拦截时用 MCP 工具变通。
- **C3 声明式安装**：所有文件随清单目录复制分发，不写安装脚本改用户配置。
- **C4 密钥管理**：一切凭据走 `provision.requiresEnv` 或 `mcpServers.env`，代码零硬编码密钥；未配置时输出 `/login` 或 export 引导。
- **C5 Token 经济**：喂给模型的日志/上下文先截断（如 CI 日志只取最后 N KB 错误段）；长输出落盘文件后给路径，不内联全文。
- **C6 Windows 兼容**：本机为 Windows 11 + Git Bash，脚本路径用正斜杠，避免仅 POSIX 的命令。
- **C7 上游可变性**：Step Code 处于早期（2026-09-22 开源），实现前先核对官方仓库最新 release notes 中插件相关变更；发现 `entry`/hooks/市场目录开放时，在对应插件 `plugin.yaml` 追加 `adaptation_notes`。
- **C8 MCP 边界**：MCP server 一律 stdio JSON-RPC，**无认证、无审计日志**——安全边界是启动它的宿主进程；不得把 stdio 桥接为网络/tcp 或暴露到公网。MCP 工具调用 ≠ 用户授权：危险/写操作仍需人类在宿主侧确认，插件内 `confirm` 参数只是显式语义而非权限系统（security-A C-07）。

## 6. 技术栈约定

- MCP Server：TypeScript + `@modelcontextprotocol/sdk`，npx 可运行（零安装分发）。
- 资源型插件（skills/commands）：Markdown + YAML frontmatter，与 Claude Code Agent Skills 同构。
- 测试：能落成脚本的验证步骤放 `plugins/<id>/tests/`，命令写进 plugin.yaml 的 `verify` 字段。

## 7. 任务 ID 规则

`<插件缩写大写>-<版本号无点><序号>`，如 `SC-100-1` 表示 step-commit v1.0.0 第 1 个任务。ID 一经分配不变，跨文件引用只用 ID。

## 8. 提交规范

Conventional Commits（`feat: / fix: / docs: / chore:`），commit message 中文正文允许；每个原子任务至少一个 commit，message 尾部附任务 ID（如 `feat: 实现 /commit 命令 (SC-100-2)`）。
