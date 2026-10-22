# step-ci-fixer — CI 失败修复闭环

混合形态：MCP server 包装 `gh` CLI（零依赖 Node）+ `/ci-fix`、`/ci-watch` 两条工作流命令。

## 它解决什么

CI 挂了以后，常见流程是「打开网页找失败 run → 翻很长的日志 → 判断是 lint、测试还是构建 → 本地改 → push → 等重跑」。本插件把日志抓取、失败分类、重跑与状态轮询做成工具，修复动作仍由模型在本地完成，push 前必须确认。

## 使用

| 命令 | 说明 |
| --- | --- |
| `/ci-fix` | 定位失败 run → 截取错误段 → 分类修复（最小改动）→ **确认后 push** → 轮询重跑，上限 3 轮转人工；`--pr` 模式把 reviewer 意见转化为修复任务 |
| `/ci-watch` | `/goal` 挂机模式：持续监控 run 状态直到绿或超时，进度落盘 `docs/ci-watch.md`，无头只读 |

日志适配覆盖 GitHub Actions、GitLab CI 与 Jenkins：GitLab 按 job 段切分并提取错误尾部，Jenkins 定位失败的 stage 与 `BUILD FAILURE`。

### MCP 工具

| 工具 | 说明 |
| --- | --- |
| `check_gh` | gh 可用性/认证检查（缺失/未认证给出指引） |
| `list_failed_runs` / `list_workflows` | 失败 run 定位、多 workflow 选择器 |
| `fetch_run_log` | 错误段抓取（只取尾部 16KB，控制上下文体积） |
| `classify_failure` | lint/test/build/deploy 分类与修复策略 |
| `rerun_workflow` / `run_status` | 重跑与状态轮询 |
| `fetch_pr_comments` | PR 评论读取（截断 8KB） |

## 安装

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-ci-fixer
```

## 验证

```bash
node tests/validate.mjs   # 含 fake-gh 端到端与降级路径
```

## 边界与限制

- **所需凭据**：`GITHUB_TOKEN`。未配置时提示 `gh auth login` 或 export 指引，不裸报错；插件零硬编码凭据。
- 参数安全：`runId`/`prNumber` 只接受正整数，`--limit` 收敛到 1..100，`--workflow` 以 `--workflow=<name>` 等号形式传值并拒绝前导 `-`/控制符，避免参数被 gh 当作选项。
- 修复闭环上限 3 轮，超限转人工；push 前必须获得用户确认。
- MCP server 走 stdio JSON-RPC，**无认证、无审计日志**：安全边界即启动它的宿主进程（stdio 继承宿主信任）。
- **仅限本机**：不要将 stdio 桥接为网络/tcp 服务，也不要把本插件 server 暴露到公网。
- **工具调用 ≠ 用户授权**：`rerun_workflow` 等写操作与 push 仍需人类确认；`GITHUB_TOKEN` 仅经环境注入。

## 许可证

[AGPL-3.0-only](../../LICENSE)
