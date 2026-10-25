# step-regex-lab — 正则实验台

纯声明式插件：审查正则的含义、边界与性能风险，从样例归纳草案。纯静态分析，不在会话里批量执行匹配。

## 它解决什么

正则的三个高频事故：看不懂别人写的、ReDoS 上线后拖垮服务、归纳出来的正则只对自己给的例子负责。本插件把三者变成三张表：逐段解释表、风险定级、带反例的用例表。

## 使用

| 命令 | 说明 |
| --- | --- |
| `/regex-check <正则> [--lang js]` | 逐段解释、正/反用例表、ReDoS 灾难性回溯定级与替代写法 |
| `/regex-gen <样例…>` | 从 ≥3 个样例归纳草案，显式列出未覆盖样例，强制提示复核 |

## 安装

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-regex-lab
```

## 验证

```bash
node tests/validate.mjs
```

## 边界与限制

- 静态分析：不执行匹配，实跑验证建议用户在本地 REPL 完成。
- ReDoS 定级覆盖常见灾难性回溯形态，不能证明「零风险」。
- `/regex-gen` 是归纳不是推导，草案必须过 `/regex-check` 复核后才可入库。

## 许可证

[AGPL-3.0-only](../../LICENSE)
