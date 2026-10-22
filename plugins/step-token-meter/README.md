# step-token-meter

本地会话/Token 消耗统计。**纯本地、零网络**：只读 `~/.stepcode/` 会话记录，不上传任何数据。

## 命令

| 命令 | 说明 |
| --- | --- |
| `/usage` | 按日/项目/模型聚合 token 消耗，内置默认单价表成本粗估，`--csv` 导出 |

## 特性

- 容错解析层：未知字段忽略、缺失字段取默认、损坏行跳过并计警告，格式变动不崩溃（docs/storage-format.md）；
- 成本口径透明：tokens × 公开单价，未含套餐折扣，汇报中强制注明「粗估」；
- v1.1.0 起 MCP server 化（`get_usage(range)` 等工具），单价表可配置并支持热加载。

## 安全边界（MCP）

- MCP server 走 stdio JSON-RPC，**无认证、无审计日志**：安全边界即启动它的宿主进程（stdio 继承宿主信任）。
- **仅限本机**：不要将 stdio 桥接为网络/tcp 服务，也不要把本插件 server 暴露到公网。
- **工具调用 ≠ 用户授权**：本插件工具只读本地用量数据、不修改环境；不要把不可信请求直接转给本 server。

## 安装

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-token-meter
```

## 验证

```bash
node tests/validate.mjs
```

## License

[AGPL-3.0-only](../../LICENSE)
