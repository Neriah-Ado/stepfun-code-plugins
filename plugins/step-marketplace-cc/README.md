# step-marketplace-cc — Claude Code 插件市场桥

元项目：把高星 Claude Code 插件经规则级兼容检查/修补后收录进本仓库市场源，`/plugin marketplace add Neriah-Ado/stepcode-plugins` 一键可用。

## 它解决什么

Claude Code 插件与 Step Code 的清单/目录约定接近但不完全一致。直接收录会出现「装上了但加载器不认」的情况。本插件用检查器判断 native / patched / incompatible 三态，对已知不兼容字段自动剔除并标注修补结果，再生成兼容性索引与收录目录。

## 使用

| 能力 | 说明 |
| --- | --- |
| 兼容性检查 | `.claude-plugin/plugin.json` 自动回退读取；name→id 归一化；skills/commands/agents/.mcp.json 目录自动发现 |
| 不兼容修补 | 已知不兼容点：`lspServers`（不承载）、`entry`（只记录不加载）→ 自动剔除并标注 `patched` |
| 收录目录 | [catalog.json](./catalog.json)：10 个条目，逐条含上游、锁定版本、分类、兼容状态、实测表现 |
| 兼容性索引 | `buildCcIndex` 生成兼容性标注表，原生 Step 插件与本仓库 11 个自研插件共存索引，星级/实测徽章字段可开关 |
| 检查器实现 | `tests/lib/cc-compat.mjs`（`analyzeCcPlugin`：native / patched / incompatible 三态 + 修补后清单） |

## 安装

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
```

本插件是市场仓库的元项目，没有独立的 `plugin.json`；加入市场源后，收录目录中的插件即可按名称安装。

## 验证

```bash
node tests/validate.mjs
```

## 边界与限制

- **诚实声明**：断网开发环境下上游地址以占位符记录、实测表现统一标注「待实测」；接入网络后按「clone → checker → 锁定版本 → 实机安装验证」流程逐条回填。
- 兼容性判断基于规则与清单结构，不保证第三方插件的运行时行为；实机安装后仍需按剧本验证。
- 修补只剔除已知不兼容字段，不改写第三方插件的业务逻辑。
- 本插件不提供网络下载或自动更新能力；目录更新需人工提交。

## 许可证

[AGPL-3.0-only](../../LICENSE)
