# step-workspace — monorepo 视角

纯声明式插件：把「这次改动影响了哪些包」变成一条声明依赖闭包，把包间依赖变成一张图。

## 它解决什么

monorepo 里最常见的浪费是全量跑测试，最常见的盲区是「改了 A，B 隐式依赖 A 却没人知道」。本插件从 git diff 出发沿声明依赖反向传播算受影响集合，并给最小验证命令；顺带把 workspace 内部依赖画成图、检出循环依赖。

## 使用

| 命令 | 说明 |
| --- | --- |
| `/affected [--base origin/main]` | 变更文件 → 变更包 → 依赖闭包，分三层展示并给最小验证命令（不自动执行） |
| `/workspace-graph` | mermaid 依赖图落盘 `docs/workspace-graph.md`，拓扑排序检环 |

## 安装

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-workspace
```

## 验证

```bash
node tests/validate.mjs
```

## 边界与限制

- 依赖闭包基于声明式清单（package.json / Cargo.toml / go.work），动态 require/import 与运行时拼接引用不在闭包内。
- workspace 文件缺失时明确说明非 monorepo，不伪造结果。
- 根级配置变更按全量影响处理，粒度到此为止。

## 许可证

[AGPL-3.0-only](../../LICENSE)
