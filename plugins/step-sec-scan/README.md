# step-sec-scan — 安全审计

混合形态：MCP server（零依赖 Node）内置 secret 模式扫描与降噪、`npm audit` 解析、基线对比、CycloneDX SBOM、CI 卡点；可选接入 `gitleaks` / `pip-audit` / `cargo audit`。

## 它解决什么

提交前的安全检查常被拆成好几步：扫 secret、查依赖漏洞、和上次基线比、生成报告、判断是否阻断 CI。本插件把这些步骤收进 `/audit`，把命中按严重度排序后落盘，默认只报新引入的问题，存量漏洞冻结在基线里。

## 使用

| 命令 | 说明 |
| --- | --- |
| `/audit` | 依赖漏洞 + secret 泄漏扫描，结构化报告落盘 `docs/security-report.md`，终端只给摘要；支持 `--staged` 增量、`--full` 全量、`--baseline` 基线模式 |

### MCP 工具

| 工具 | 说明 |
| --- | --- |
| `scan_secrets` | secret 模式扫描（staged 增量/给定 diff 文本）；占位值忽略，测试/示例/文档路径的非占位值降级 low 并标注 noise |
| `npm_audit` | 依赖漏洞解析（severity/证据/可修复性） |
| `report` | 结构化报告（Markdown，落盘 `docs/security-report.md`，终端只给摘要） |
| `baseline_diff` | 基线对比：只报新引入，冻结存量 |
| `sbom_generate` | CycloneDX 1.5 SBOM |
| `upgrade_plan` / `ci_gate` | 自动修复计划 / CI 阻断判定（默认 critical/high） |

## 安装

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-sec-scan
```

## 验证

```bash
node tests/validate.mjs   # 含 secret 命中/降噪/基线/SBOM/卡点全链路校验
```

## 边界与限制

- 测试/示例/文档路径中的**非占位值**不会被直接忽略：降级为 low 并标注 noise，避免整体漏报。
- 历史扫描需要显式传入 `git log -p --all` 的输出，默认只覆盖当前 diff/staged 范围。
- 扫描结果只用于本地报告，不上传；`/audit` 不自动提交修复，修复 PR 与依赖升级仍需人工确认。
- MCP server 走 stdio JSON-RPC，**无认证、无审计日志**：安全边界即启动它的宿主进程（stdio 继承宿主信任）。
- **仅限本机**：不要将 stdio 桥接为网络/tcp 服务，也不要把本插件 server 暴露到公网。
- **工具调用 ≠ 用户授权**：修复 PR / 升级等写操作仍需人类确认。

## 许可证

[AGPL-3.0-only](../../LICENSE)
