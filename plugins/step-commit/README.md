# step-commit — Git 提交工作流套件

纯声明式插件（commands + Markdown 提示词，零外部依赖），把 Step Code 变成守规范的提交助手。

## 它解决什么

手工写提交信息容易出现格式漂移；推送、建 PR、生成 CHANGELOG、发 release PR 又分别要记不同工具的参数。本插件把这四件事收进斜杠命令：先看 diff，再按 Conventional Commits 生成消息，提交后按平台推送并建 PR；版本发布时从 commit 历史生成 CHANGELOG 与发布 PR。

## 使用

| 命令 | 说明 |
| --- | --- |
| `/commit` | 分析 staged 改动 → 生成 Conventional Commits 规范 message → HEREDOC 格式化提交 |
| `/commit-push-pr` | 推送远端并创建 PR/MR（GitHub 用 `gh`，GitLab 用 `glab`，缺失时输出安装指引） |
| `/changelog` | 汇聚 commit 历史按 feat/fix/breaking 分类生成 CHANGELOG 条目，semver 升级建议，确认后打 tag |
| `/release-pr` | release-please 风格发布 PR：分支 + 版本号 + CHANGELOG，双平台创建 |

### 配置

读取顺序：项目根 `.step-commit.json` > 插件目录 `config.json` > 内置默认。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `message_language` | `"zh"` | subject 与正文语言：`zh` / `en` |
| `subject_max_length` | `100` | 首行最大长度（commitlint `header-max-length` 优先） |
| `body_line_length` | `72` | 正文每行最大长度 |
| `scope_strategy` | `"auto"` | 自动 scope 推断开关（`auto` / `off`） |
| `scope_map` | `{}` | 路径前缀 → scope 自定义映射，如 `{ "src/auth/": "auth" }` |

仓库存在 commitlint 配置时，`type-enum`、`header-max-length`、`scope-enum` 等规则自动约束生成结果。

### monorepo

检测到 `pnpm-workspace.yaml` / `workspaces` / `lerna.json` 时自动进入 monorepo 模式：scope 取 package 名、`/changelog` 按 package 分节出独立 CHANGELOG 与独立版本建议、`/release-pr` 按 package 建 release 分支。基于单根工作区内路径前缀实现，不依赖多根工作区能力。

## 安装

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-commit
```

## 验证

在仓库根目录运行（清单规范 + Conventional Commits 校验 + 安全规则存在性）：

```bash
node tests/validate.mjs
```

## 边界与限制

- 提交前先确认范围：`git status` / `git diff --staged` 是流程的一部分，不跳过。
- 不 amend 已推送提交、不 force push。
- pre-commit hook 失败时走「归因 → 修复 → 重试」流程，不默认使用 `--no-verify`（除非用户明确要求）。
- staged 中疑似机密或大文件时停止并征求用户决定。
- 推送与建 PR 依赖 `gh`（GitHub）或 `glab`（GitLab）；工具缺失时输出安装指引，不裸报错。

## 许可证

[AGPL-3.0-only](../../LICENSE)
