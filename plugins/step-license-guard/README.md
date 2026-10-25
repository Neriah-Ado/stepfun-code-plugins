# step-license-guard — 依赖许可合规

纯声明式插件：汇总项目依赖的开源许可并按策略分级，批量维护源文件 SPDX 头。归类只依据 SPDX 表达式，未知不猜。

## 它解决什么

引入一个依赖之前，没人会去读它的 LICENSE；等合规审查或商用交付时才发现 GPL/AGPL 混进了闭源交付物。本插件把「项目里到底带了哪些许可、哪些踩了红线」变成一张可落盘的表，并在源码层维护统一的 SPDX 标识。

## 使用

| 命令 | 说明 |
| --- | --- |
| `/license-audit` | npm（离线读 node_modules）/ pip（pip-licenses，缺失给安装指引）/ go（go.mod）依赖许可汇总，allow/warn/deny 分级，报告落盘 |
| `/license-header [路径] [--apply]` | 源文件 SPDX 头校验与补写，默认 dry-run，写盘逐批确认 |

## 安装

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-license-guard
```

## 验证

```bash
node tests/validate.mjs
```

## 边界与限制

- 许可信息取自包元数据声明，双许可（`OR`）与带例外的表达式逐条展开，但**不构成法律意见**。
- 无法解析的 SPDX 表达式一律 unknown，不猜测归类。
- Python 生态依赖 `pip-licenses`，缺失时给出安装指引而非裸报错。

## 许可证

[AGPL-3.0-only](../../LICENSE)
