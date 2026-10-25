# step-repo-map — 仓库认知地图

纯声明式插件：把「这仓库长什么样、哪里最热、新人从哪开始」变成一份落盘的地图和一条带验证状态的上手路径。

## 它解决什么

接手陌生仓库的第一小时决定后面的效率：目录树要自己滚、职责要自己猜、热点没人告诉你。本插件生成一份地图（树 + 职责 + 热点），再从地图推出一条新人路径——并且诚实地标注哪一步验证过、哪一步只是推断。

## 使用

| 命令 | 说明 |
| --- | --- |
| `/repo-map [--depth 3]` | 限深目录树 + 模块职责一句话（无依据标 TODO）+ 近 90 天热点 Top 10，落盘 `docs/repo-map.md` |
| `/onboard [--role 后端]` | 基于地图生成四段式上手路径（环境 → 走读 → 首改 → 深水区），每步标注验证状态 |

## 安装

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-repo-map
```

## 验证

```bash
node tests/validate.mjs
```

## 边界与限制

- 模块职责只从 README、包描述与代码结构归纳，缺失信息标 TODO，不编造。
- 热点依赖 git 历史；无历史仓库跳过该节并声明。
- 上手路径中未实际执行过的命令一律标「待验证」。

## 许可证

[AGPL-3.0-only](../../LICENSE)
