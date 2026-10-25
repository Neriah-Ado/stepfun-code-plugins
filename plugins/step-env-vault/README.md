# step-env-vault — .env 文件管理

纯声明式插件：对比环境文件找缺漏、生成可入库的 `.env.example`。一切输出默认脱敏，全程零网络。

## 它解决什么

环境文件的常见事故有两类：本地跑得起、同事跑不起来（key 没同步进 example），以及截图/贴日志时把真实密钥一起贴出去。本插件把「缺什么」变成一张表，把「泄露什么」在输出层就挡住。

## 使用

| 命令 | 说明 |
| --- | --- |
| `/env-diff` | 对比 `.env` 与 `.env.example`（可用 `--left/--right` 换任意文件），列缺失/多余/空值不一致，值全部掩码 |
| `/env-example` | 从 `.env` 生成 `.env.example`：注释与顺序保留、值替换为类型占位符 |

## 安装

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-env-vault
```

## 验证

```bash
node tests/validate.mjs
```

## 边界与限制

- 只解析 `KEY=VALUE` 形态，不做 shell 展开、不处理多行值。
- `--show` 查看原文需逐 key 确认，属例外路径。
- 只比对空/非空而非值本身，不能发现「值过期」类问题。

## 许可证

[AGPL-3.0-only](../../LICENSE)
