# stepcode-plugins — Step Code 第三方插件集合

[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](./LICENSE)
[![Step Code](https://img.shields.io/badge/Step%20Code-plugin%20collection-111111.svg)](https://github.com/stepfun-ai/Step-Code)

为 [Step Code](https://github.com/stepfun-ai/Step-Code)（阶跃星辰终端 AI Agent）提供 13 个可组合的插件：从提交、测试、CI 到容器、数据库、安全与文档。

> **语言策略**：对外文档统一使用简体中文，不提供 `README.en.md`。插件命令、技能提示词与目标用户均以中文为主；发布说明单独采用「中文 + English」双语，避免维护两套容易漂移的并列 README。英文读者可通过发布说明的 English 段与各插件的命令/工具表获取关键信息。

## 简介

全部插件为声明式形态：`step.plugin.json` 清单 + `commands/` `skills/` Markdown 资源；需要进程能力的插件附带零依赖 MCP server（stdio JSON-RPC）。12 个首发插件均已达到 v1.3.0，其中 step-db-insight / step-api-forge / step-docker-mate / step-ci-fixer / step-sec-scan 已发布 v1.3.1 安全修复。社区贡献的 [step-context-archive](./plugins/step-context-archive)（PR #1）已发布 v1.0.0。

## 插件索引

| 插件 | 版本 | 一句话定位 | 命令 / 工具入口 |
| --- | --- | --- | --- |
| [step-commit](./plugins/step-commit) | ![v1.3.0](https://img.shields.io/badge/version-1.3.0-blue) | Git 提交工作流套件 | `/commit` · `/commit-push-pr` · `/changelog` · `/release-pr` |
| [step-test-guard](./plugins/step-test-guard) | ![v1.3.0](https://img.shields.io/badge/version-1.3.0-blue) | 测试守护循环 | `/test` · `/nightly-test` · `/bisect` · `/flaky` |
| [step-context-archive](./plugins/step-context-archive) | ![v1.0.0](https://img.shields.io/badge/version-1.0.0-blue) | 上下文归档与召回：`/archive` 把已完成任务块原文落盘、`/recall` 按 stamp 取回；对话只留三点摘要索引 | `/archive` · `/recall` |
| [step-token-meter](./plugins/step-token-meter) | ![v1.3.0](https://img.shields.io/badge/version-1.3.0-blue) | 本地 Token 用量统计：聚合与成本粗估、HTML 报告，纯本地零网络 | `/usage` · MCP `get_usage` |
| [step-docker-mate](./plugins/step-docker-mate) | ![v1.3.1](https://img.shields.io/badge/version-1.3.1-blue) | Docker/Compose 运维：MCP 查询/编排、崩溃归因、镜像瘦身，危险操作默认确认 | MCP `docker_ps` 等 · `/docker-health` |
| [step-ci-fixer](./plugins/step-ci-fixer) | ![v1.3.1](https://img.shields.io/badge/version-1.3.1-blue) | CI 失败修复：日志抓取、失败分类、重跑闭环，支持挂机与 PR 评论交互 | `/ci-fix` · `/ci-watch` |
| [step-fe-kit](./plugins/step-fe-kit) | ![v1.3.0](https://img.shields.io/badge/version-1.3.0-blue) | 前端套件：dev server 管理、视觉验证、一键发布 | `/dev` · `/publish` |
| [step-sec-scan](./plugins/step-sec-scan) | ![v1.3.1](https://img.shields.io/badge/version-1.3.1-blue) | 安全审计：secret 扫描 + 依赖漏洞、基线与 SBOM、CI 卡点 | `/audit` · MCP `scan_secrets` |
| [step-api-forge](./plugins/step-api-forge) | ![v1.3.1](https://img.shields.io/badge/version-1.3.1-blue) | OpenAPI 全链路：校验、TS/Python 客户端、mock、文档页、breaking diff | `/api-forge` · MCP `validate_spec` |
| [step-db-insight](./plugins/step-db-insight) | ![v1.3.1](https://img.shields.io/badge/version-1.3.1-blue) | 数据库只读助手：schema 浏览、EXPLAIN 解读、受控写入 | `/db-insight` · MCP `read_query` |
| [step-doc-gen](./plugins/step-doc-gen) | ![v1.3.0](https://img.shields.io/badge/version-1.3.0-blue) | 文档生成：README、API 参考、中文排版、站点骨架、一致性守护 | `/readme` · `/api-docs` · `/i18n-docs` · `/site-scaffold` · `/doc-guard` |
| [step-cron-recipes](./plugins/step-cron-recipes) | ![v1.3.0](https://img.shields.io/badge/version-1.3.0-blue) | 定时任务模板库：6 模板 + 向导 + 变量系统 + 社区规范 | `/cron-recipe init` |
| [step-marketplace-cc](./plugins/step-marketplace-cc) | ![v1.3.0](https://img.shields.io/badge/version-1.3.0-blue) | Claude Code 插件市场桥：兼容性检查/修补/收录目录 | 兼容性检查 · `catalog.json` |

## 安装

```bash
# 在 Step Code 会话中，把本仓库添加为插件市场源
/plugin marketplace add Neriah-Ado/stepcode-plugins

# 安装具体插件
/plugin install step-commit
```

也可以直接克隆本仓库后用本地路径安装：`/plugin marketplace add <本地路径>`。

## 验证

每个插件的可脚本化门禁检查集中在 `tests/validate.mjs`（清单规范、Conventional Commits 校验、安全规则存在性等），零依赖：

```bash
node tests/validate.mjs
```

该门禁同时由 GitHub Actions 在 push / PR 时于 ubuntu 与 windows 双平台运行（[`.github/workflows/validate.yml`](./.github/workflows/validate.yml)）。

## 安全边界（MCP）

6 个 MCP server（step-token-meter / step-docker-mate / step-ci-fixer / step-sec-scan / step-api-forge / step-db-insight）均为 **stdio JSON-RPC、零第三方依赖**：

- **无认证、无审计日志**：stdio 继承宿主信任，安全边界就是启动它的 Step Code 进程；不要在不可信工作区安装/启用。
- **仅限本机**：不要将 stdio 桥接为网络/tcp 服务，也不要把这些 server 暴露到公网（它们没有监听端口，也按设计不打算有）。
- **工具调用 ≠ 用户授权**：危险操作（删容器、写库、push、生成并运行产物）必须由人类在宿主侧确认；插件里的 `confirm` 参数只是显式语义，不是权限系统。

## 发布说明

全部发布说明已同步发布到 [GitHub Releases](https://github.com/Neriah-Ado/stepcode-plugins/releases)；以下为文本源文件。

| 版本 | 主题 | 文档 |
| --- | --- | --- |
| v1.0.0 | MVP 全量首发 / Full MVP Launch | [v1.0.0](./docs/releases/v1.0.0.md) |
| v1.1.0 | 提交质量与生态扩展 / Quality & Ecosystem | [v1.1.0](./docs/releases/v1.1.0.md) |
| v1.2.0 | 自动化与可视化 / Automation & Visualization | [v1.2.0](./docs/releases/v1.2.0.md) |
| v1.3.0 | 深水区与收官 / Deep Water & Wrap-up | [v1.3.0](./docs/releases/v1.3.0.md) |
| step-context-archive v1.0.0 | 首个社区贡献插件发布 / First Community Plugin Release | [发布说明](./docs/releases/step-context-archive-v1.0.0.md) |
| 社区贡献与维护 | 自 PR #1 合并起 / From PR #1 Merge Onward（滚动更新） | [发布说明](./docs/releases/community-merge.md) |

## 文档约定

- **对外文档**：本 README、各插件 `README.md`、插件 `CHANGELOG.md` 与 `docs/releases/`；只描述用户可见能力与边界。
- **内部规范**：开发流程、版本门禁与任务编号见 [AGENTS.md](./AGENTS.md)，不进入对外文档。
- **文档规范**：[DOCS-STYLE](https://github.com/Neriah-Ado/Neriah-Ado/blob/main/docs/DOCS-STYLE.md)。

## 许可证

[AGPL-3.0-only](./LICENSE) · © 2026 Neriah-Ado
