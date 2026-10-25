# 第二批插件 v1.0.0 — 10 个新插件批量发布 / Second Batch: 10 New Plugins

发布日期 / Released: 2026-10-26

## 中文

本批次为仓库新增 10 个 v1.0.0 插件，全部为**纯声明式、零第三方依赖、零网络**，覆盖此前未涉及的能力域：

| 插件 | 定位 | 命令入口 |
| --- | --- | --- |
| step-shell-safety | Shell 命令安全预检：副作用解释、三级风险分级、更安全替代；项目风险白名单（预检零执行） | `/shell-check` · `/risk-baseline` |
| step-env-vault | .env 管理：缺漏对比（值默认脱敏）、生成可入库的 `.env.example` | `/env-diff` · `/env-example` |
| step-log-lens | 日志透视：错误聚类与时间线，大文件先截断后喂模型，报告落盘，凭据脱敏 | `/log-analyze` · `/log-tail` |
| step-regex-lab | 正则实验台：逐段解释、正反用例表、ReDoS 灾难性回溯检测、样例归纳草案 | `/regex-check` · `/regex-gen` |
| step-license-guard | 依赖许可合规：npm/pip/go SPDX 分级审计（未知不猜归类）、源文件 SPDX 头维护 | `/license-audit` · `/license-header` |
| step-a11y-check | 无障碍静态审计：七类反模式映射 WCAG 条目，修复走「报告 → 最小 diff → 确认」 | `/a11y-audit` · `/a11y-fix` |
| step-workspace | monorepo 视角：从 git diff 沿声明依赖闭包算受影响包、依赖图与环检测 | `/affected` · `/workspace-graph` |
| step-todo-flow | TODO 工作流：TODO.md 增删改查（写盘先 diff）、需求拆分条目必须带验收标准 | `/todo` · `/todo-plan` |
| step-mock-data | 测试数据：按 schema 生成虚构数据（生成器不内置真实个人信息）、真实样例格式保持脱敏 | `/mock-data` · `/mask-data` |
| step-repo-map | 仓库认知：目录树 + 模块职责（缺失标 TODO）+ git 热点、新人上手路径标注验证状态 | `/repo-map` · `/onboard` |

安全边界延续仓库既有约定：所有写操作（白名单维护、SPDX 头补写、TODO 写盘、a11y 修复）先展示 diff 再确认；日志与 env 类输出默认脱敏；`/mock-data` 输出固定带虚构声明。

### English

This release adds 10 new v1.0.0 plugins, all **pure-declarative, zero-dependency and zero-network**, covering previously uncovered domains: shell command risk pre-check, .env management, log analysis with truncation-first token economy, regex lab with ReDoS detection, dependency license audit (SPDX), static accessibility audit with WCAG mapping, monorepo affected-package computation, project TODO workflow, synthetic test-data generation with real-PII red lines, and repository mapping with onboarding paths. All write operations show a diff and require confirmation first; log/env outputs are masked by default; mock data always carries a synthetic-data disclaimer.

### 升级 / Upgrade

```bash
/plugin marketplace update
/plugin install <插件名>
```
