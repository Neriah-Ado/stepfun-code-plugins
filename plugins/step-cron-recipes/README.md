# step-cron-recipes — 定时任务模板库

纯声明式插件：6 个开箱模板 + init 向导 + 变量系统 + 社区贡献规范。

## 它解决什么

把「每日检查依赖更新」「夜间跑全量测试」「巡检日志」这类重复任务写成无头提示词，最容易漏的是输出落盘路径、依赖缺失时怎么降级、以及频率怎么设。模板把这几项固定成结构，`/cron-recipe init` 再根据目标、频率、输出位置生成可用配置。

## 使用

| 模板 | 目标 | 频率建议 |
| --- | --- | --- |
| deps-check | 依赖更新检查（只报告不升级） | 每日 09:00 |
| nightly-test | 夜间全量测试（联动 step-test-guard） | 每日 03:00 |
| log-patrol | 日志巡检错误聚合日报 | 每日 08:30 |
| git-backup-check | git 备份校验 | 每日 22:00 |
| page-monitor | 页面监控（playwright 截图 diff） | 每日 10:00 |
| site-alive | 静态站存活检查 | 每 6 小时 |

| 命令 | 说明 |
| --- | --- |
| `/cron-recipe init` | 三问向导（目标/频率/输出）生成定制定时模板；支持 `{{var}}` 变量占位、内建 `date`/`range` 变量，缺失变量保留并报告 |

每个模板 = 触发频率建议 + 无头任务 prompt + 输出落盘路径 + 依赖声明与降级路径。

## 安装

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-cron-recipes
```

## 验证

```bash
node tests/validate.mjs
```

## 边界与限制

- 模板是提示词与配置骨架，不包含调度器本身；实际触发依赖 Step Code 的 `/cron` 能力。
- 外部依赖（playwright 等）未安装时按模板内的降级路径输出指引，不静默失败。
- 社区贡献模板需附至少 3 天真实运行记录，避免只验证「能生成」。
- 每个模板都要求明确输出落盘路径，长结果不回灌会话。

## 许可证

[AGPL-3.0-only](../../LICENSE)
