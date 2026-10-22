# step-api-forge

OpenAPI 全链路。混合形态：MCP server（零依赖 Node）内置 3.0/3.1 结构校验与代码生成，产物全部可落盘。

## MCP 工具

| 工具 | 说明 |
| --- | --- |
| `validate_spec` | OpenAPI 3.0/3.1 结构校验（operations/responses 全覆盖） |
| `generate_ts_client` | TypeScript fetch 客户端（路径参数插值、summary 注释） |
| `generate_mock` / `generate_docs` | express/MSW mock 与 API 参考文档页（v1.1.0） |
| `diff_spec` | 两版 spec 对比，breaking changes 100% 检出样本（v1.2.0） |
| `generate_python_sdk` | Python requests SDK（v1.3.0）；反向生成走提示词辅助模式 |

## 安全说明（C-04）

生成的代码/文档来自 spec 输入，因此把 spec 当不可信数据处理：path、path 参数名、`operationId`、响应码先过白名单校验，`servers[].url` 作为字符串字面量转义，TS 注释与文档页 HTML 全量转义。非法 spec 会在 `validate_spec` 阶段报错并停止生成；从第三方来源拿 spec 时，仍建议在运行生成产物前人工审查。

## 安装与验证

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-api-forge
node tests/validate.mjs   # petstore 样例端到端（含 MCP 冒烟）
```

## License

[AGPL-3.0-only](../../LICENSE)
