# step-api-forge — OpenAPI 全链路

混合形态：MCP server（零依赖 Node）内置 OpenAPI 3.0/3.1 结构校验与代码生成，产物全部可落盘。

## 它解决什么

一份 OpenAPI spec 往往要同时服务客户端、mock、文档与兼容性评审。本插件先校验 spec 结构，再从同一份输入生成 TypeScript/Python 客户端、express/MSW mock、API 参考文档与 breaking diff，避免多处手写导致口径漂移。

## 使用

| 命令 | 说明 |
| --- | --- |
| `/api-forge` | OpenAPI 全链路入口：校验 spec → 生成 TS/Python 客户端 / mock / 文档页 → 落盘（产物给路径） |

### MCP 工具

| 工具 | 说明 |
| --- | --- |
| `validate_spec` | OpenAPI 3.0/3.1 结构校验（operations/responses 全覆盖） |
| `generate_ts_client` | TypeScript fetch 客户端（路径参数插值、summary 注释） |
| `generate_mock` / `generate_docs` | express/MSW mock 与 API 参考文档页 |
| `diff_spec` | 两版 spec 对比，breaking changes 检出（删除路径/方法、移除响应码、新增必填参数） |
| `generate_python_sdk` | Python requests SDK；反向生成走提示词辅助模式 |

## 安装

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-api-forge
```

## 验证

```bash
node tests/validate.mjs   # petstore 样例端到端（含 MCP 冒烟）
```

## 边界与限制

- 生成的代码/文档来自 spec 输入，因此把 spec 当**不可信数据**处理：path、path 参数名、`operationId`、响应码先过白名单校验，`servers[].url` 作为字符串字面量转义，TS 注释与文档页 HTML 全量转义。
- 非法 spec 会在 `validate_spec` 阶段报错并停止生成；从第三方来源拿 spec 时，仍建议在运行生成产物前人工审查。
- 本 server 只返回文本，不写文件、不执行生成代码；是否落盘/运行由用户决定。
- MCP server 走 stdio JSON-RPC，**无认证、无审计日志**：安全边界即启动它的宿主进程（stdio 继承宿主信任）。
- **仅限本机**：不要将 stdio 桥接为网络/tcp 服务，也不要把本插件 server 暴露到公网。
- **工具调用 ≠ 用户授权**：生成结果是否落盘/运行由用户决定。

## 许可证

[AGPL-3.0-only](../../LICENSE)
