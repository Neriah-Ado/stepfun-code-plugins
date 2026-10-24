# Changelog — step-commit

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 semver。

## [1.3.0] - 2026-09-27

### 新增

- `/commit-push-pr` 适配 GitLab MR（`glab`，含缺失时的安装指引）
- 新增 `/release-pr` 命令
- monorepo 分 package 提交与分节 CHANGELOG

## [1.2.0] - 2026-09-27

### 新增

- `/changelog` 支持 semver 建议与确认后打 tag
- 实现 `/changelog` 命令

## [1.1.0] - 2026-09-26

### 新增

- 提交语言配置：项目根 `.step-commit.json` > 插件目录 `config.json` > 内置默认；`message_language` 切换中/英 subject 与正文，两种语言输出均满足 Conventional Commits 结构。
- 自动 scope 推断：内置目录前缀规则（JSON 规则表内联于命令文本，随 `tests/samples/scope-cases.json` 校验），多文件命中聚合、平票回退、通用目录（src/lib/dist 等）不作为 scope；`scope_map` 支持项目自定义，`scope_strategy: off` 可关闭。
- commitlint 规则联动：存在 commitlint 配置时读取 `type-enum`/`header-max-length`/`scope-enum` 约束生成结果；JS 动态配置按字面量遵守并注明解析局限；无配置回退内置默认。

## [1.0.0] - 2026-09-26

### 新增

- `step.plugin.json` 插件清单，接入仓库市场源。
- `/commit`：staged diff 分析 → Conventional Commits 规范 message（type/scope/subject/正文/BREAKING CHANGE footer），HEREDOC 格式化提交；内置安全规则（不 amend 已推送提交、不 force push、先 status/diff 再动作、不 `--no-verify`、不碰机密、不全量暂存）与 pre-commit hook 失败恢复流程。
- `/commit-push-pr`：提交后推送远端并用 gh 创建 PR（标题复用提交规范、正文含摘要/变更点/测试说明/issue 关联）；gh 缺失时输出安装指引而非裸报错。
- 门禁校验脚本 `tests/validate.mjs`：清单规范、Conventional Commits 格式、命令安全规则存在性检查。
