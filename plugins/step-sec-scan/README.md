# step-sec-scan

安全审计。混合形态：MCP server（零依赖 Node）内置 secret 模式扫描与降噪、npm audit 解析、基线对比、CycloneDX SBOM、CI 卡点；可选接入 gitleaks/pip-audit/cargo audit。

## MCP 工具

| 工具 | 说明 |
| --- | --- |
| `scan_secrets` | secret 模式扫描（staged 增量/给定 diff 文本）；占位值忽略，测试/示例/文档路径的非占位值降级 low 并标注 noise |
| `npm_audit` | 依赖漏洞解析（severity/证据/可修复性） |
| `report` | 结构化报告（Markdown，落盘 docs/security-report.md，C5） |
| `baseline_diff` | 基线对比：只报新引入，冻结存量 |
| `sbom_generate` | CycloneDX 1.5 SBOM |
| `upgrade_plan` / `ci_gate` | 自动修复计划 / CI 阻断判定（默认 critical/high） |

## 安装与验证

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-sec-scan
node tests/validate.mjs   # 含 secret 命中/降噪/基线/SBOM/卡点全链路校验
```

## License

[AGPL-3.0-only](../../LICENSE)
