# step-ci-fixer

CI 失败修复闭环。混合形态：MCP server 包装 `gh` CLI（零依赖 Node）+ `/ci-fix` 工作流命令。

## MCP 工具

| 工具 | 说明 |
| --- | --- |
| `check_gh` | gh 可用性/认证检查（缺失/未认证给出指引） |
| `list_failed_runs` / `list_workflows` | 失败 run 定位、多 workflow 选择器 |
| `fetch_run_log` | 错误段抓取（只取尾部 16KB，C5） |
| `classify_failure` | lint/test/build/deploy 分类与修复策略 |
| `rerun_workflow` / `run_status` | 重跑与状态轮询 |
| `fetch_pr_comments` | PR 评论读取（截断 8KB） |

## 工作流

`/ci-fix`：定位 → 错误段 → 分类修复（最小改动）→ **确认后 push**（G3）→ 轮询重跑，上限 3 轮转人工。`--pr` 模式读 reviewer 意见转化为修复任务；`/goal` 挂机模式见 v1.2.0；GitLab/Jenkins 日志适配见 v1.3.0。

## 凭据（C4）

`requiresEnv: GITHUB_TOKEN`——未配置时提示 `gh auth login` 或 export 指引，不裸报错；插件零硬编码凭据。

参数安全（C-05）：`runId`/`prNumber` 只接受正整数，`--limit` 收敛到 1..100，`--workflow` 以 `--workflow=<name>` 等号形式传值并拒绝前导 `-`/控制符，避免参数被 gh 当作选项。

## 安装与验证

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-ci-fixer
node tests/validate.mjs   # 含 fake-gh 端到端与降级路径
```

## License

[AGPL-3.0-only](../../LICENSE)
