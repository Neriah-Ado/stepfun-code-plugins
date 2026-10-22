# step-token-meter — 本地 Token 用量统计

**纯本地、零网络**：只读 `~/.stepcode/` 会话记录，不上传任何数据。

## 它解决什么

「这个月 token 花在哪了」通常只能靠估算。本插件直接解析本地会话记录，按日、项目、模型聚合用量，用公开单价给出成本粗估，并支持 CSV 导出与 HTML 报告；所有计算留在本机。

## 使用

| 命令 | 说明 |
| --- | --- |
| `/usage` | 按日/项目/模型聚合 token 消耗，内置默认单价表成本粗估，`--csv` 导出 |

### 能力

- 容错解析层：未知字段忽略、缺失字段取默认、损坏行跳过并计警告，格式变动不崩溃（`docs/storage-format.md`）。
- 成本口径透明：tokens × 公开单价，未含套餐折扣，汇报中强制注明「粗估」。
- MCP server 化：提供 `get_usage(range)`、`get_usage_by_model(range)` 等工具，单价表可配置并支持热加载。
- 本地 HTML 报告（内联 SVG 图表、零外部资源）与 `/cron` 周报规则。

### 配置

- 单价表：`config/prices.json`，或通过环境变量 `STEP_TOKEN_METER_PRICES` 指定路径；文件修改后按 mtime 热加载。
- 参考样例：`config/prices.example.json`。

## 安装

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-token-meter
```

## 验证

```bash
node tests/validate.mjs
```

## 边界与限制

- MCP server 走 stdio JSON-RPC，**无认证、无审计日志**：安全边界即启动它的宿主进程（stdio 继承宿主信任）。
- **仅限本机**：不要将 stdio 桥接为网络/tcp 服务，也不要把本插件 server 暴露到公网。
- **工具调用 ≠ 用户授权**：本插件工具只读本地用量数据、不修改环境；不要把不可信请求直接转给本 server。
- 成本为按公开单价的**粗估**，不包含套餐折扣或实际账单口径。

## 许可证

[AGPL-3.0-only](../../LICENSE)
