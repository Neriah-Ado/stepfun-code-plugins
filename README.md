# stepcode-plugins

[Step Code](https://github.com/stepfun-ai/Step-Code)（阶跃星辰终端 AI Agent）第三方插件集合。全部插件为声明式形态：`step.plugin.json` 清单 + `commands/` `skills/` Markdown 资源，遵循 [AGENTS.md](./AGENTS.md) 执行规范与版本门禁。

## 插件索引

| 插件 | 版本 | 说明 |
| --- | --- | --- |
| [step-commit](./plugins/step-commit) | ![v1.3.0](https://img.shields.io/badge/version-1.3.0-blue) | Git 提交工作流套件：`/commit` 规范提交、`/commit-push-pr` 提交并建 PR、`/changelog` 发布辅助、`/release-pr` 发布 PR |
| [step-test-guard](./plugins/step-test-guard) | ![v1.3.0](https://img.shields.io/badge/version-1.3.0-blue) | 测试守护循环：`/test` 运行测试 → 失败归因 → 定点修复 → 重跑闭环 |
| [step-context-archive](./plugins/step-context-archive) | ![v1.0.0](https://img.shields.io/badge/version-1.0.0-blue) | 上下文归档与召回：`/archive` 把已完成任务块原文落盘、`/recall` 按 stamp 取回；对话只留三点摘要索引 |
| [step-token-meter](./plugins/step-token-meter) | ![v1.3.0](https://img.shields.io/badge/version-1.3.0-blue) | 本地 Token 用量统计：`/usage` 聚合与成本粗估、MCP 工具、HTML 报告，纯本地零网络 |
| [step-docker-mate](./plugins/step-docker-mate) | ![v1.3.0](https://img.shields.io/badge/version-1.3.0-blue) | Docker/Compose 运维：MCP 查询/编排、崩溃归因、镜像瘦身，危险操作默认确认 |
| [step-ci-fixer](./plugins/step-ci-fixer) | ![v1.3.0](https://img.shields.io/badge/version-1.3.0-blue) | CI 失败修复：/ci-fix 闭环、挂机监控、PR 评论交互、多平台日志适配 |
| [step-fe-kit](./plugins/step-fe-kit) | ![v1.3.0](https://img.shields.io/badge/version-1.3.0-blue) | 前端套件：/dev dev server 管理、视觉验证、/publish 一键发布 |
| [step-sec-scan](./plugins/step-sec-scan) | ![v1.3.0](https://img.shields.io/badge/version-1.3.0-blue) | 安全审计：/audit secret 扫描+依赖漏洞、基线与 SBOM、CI 卡点 |
| [step-api-forge](./plugins/step-api-forge) | ![v1.3.1](https://img.shields.io/badge/version-1.3.1-blue) | OpenAPI 全链路：校验、TS/Python 客户端、mock、breaking diff |
| [step-db-insight](./plugins/step-db-insight) | ![v1.3.1](https://img.shields.io/badge/version-1.3.1-blue) | 数据库只读助手：schema 浏览、EXPLAIN 解读、受控写入 |
| [step-doc-gen](./plugins/step-doc-gen) | ![v1.3.0](https://img.shields.io/badge/version-1.3.0-blue) | 文档生成：/readme、/api-docs、中文排版、站点骨架、一致性守护 |
| [step-cron-recipes](./plugins/step-cron-recipes) | ![v1.3.0](https://img.shields.io/badge/version-1.3.0-blue) | 定时任务模板库：6 模板 + 向导 + 变量系统 + 社区规范 |
| [step-marketplace-cc](./plugins/step-marketplace-cc) | ![v1.3.0](https://img.shields.io/badge/version-1.3.0-blue) | Claude Code 插件市场桥：兼容性检查/修补/收录目录 |

12 个首发插件均已达到 v1.3.0；社区贡献的 [step-context-archive](./plugins/step-context-archive)（PR #1）已发布 v1.0.0。

## 发布说明 / Release Notes

全部发布说明已同步发布到 [GitHub Releases](https://github.com/Neriah-Ado/stepcode-plugins/releases)；以下为文本源文件。

- [v1.0.0 — MVP 全量首发 / Full MVP Launch](./docs/releases/v1.0.0.md)
- [v1.1.0 — 提交质量与生态扩展 / Quality & Ecosystem](./docs/releases/v1.1.0.md)
- [v1.2.0 — 自动化与可视化 / Automation & Visualization](./docs/releases/v1.2.0.md)
- [v1.3.0 — 深水区与收官 / Deep Water & Wrap-up](./docs/releases/v1.3.0.md)
- [step-context-archive v1.0.0 — 首个社区贡献插件发布 / First Community Plugin Release](./docs/releases/step-context-archive-v1.0.0.md)
- [社区贡献与维护 — 自 PR #1 合并起 / From PR #1 Merge Onward](./docs/releases/community-merge.md)（滚动更新 / rolling）

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

## License

[AGPL-3.0-only](./LICENSE)
