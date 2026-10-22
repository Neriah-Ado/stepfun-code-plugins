# step-doc-gen — 文档生成套件

纯声明式插件：README、API 参考、多语言 README、docs 站点骨架与文档一致性检查。生成诚实（缺失信息标 TODO，绝不编造），中文排版规范内置。

## 它解决什么

文档工作里最耗时的不是写字，而是找信息、保持结构一致、以及发现代码变了文档没变。本插件从代码结构与注释生成骨架，用术语表与结构同步检查维护多语言版本，并用 git diff 交叉比对找出过期段落。

## 使用

| 命令 | 说明 |
| --- | --- |
| `/readme` | 从 package.json/目录结构生成 README 骨架，TODO 占位不编造 |
| `/api-docs` | 从 JSDoc/类型导出生成 API 参考 |
| `/i18n-docs` | README 多语言（结构同步检查 + 术语表），仅生成 README.xx.md |
| `/site-scaffold` | mkdocs/astro 站点骨架 + 侧边栏自动组织 |
| `/doc-guard` | 文档-代码一致性周检（`/cron` 可接入，报告落盘 `docs/stale-report.md`） |

内置 `zh-style` 技能：全角标点、术语表、代码块与数字单位的中文排版规范。

## 安装

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-doc-gen
```

## 验证

```bash
node tests/validate.mjs
```

## 边界与限制

- 生成器不补全缺失事实：找不到的信息保留 TODO，不用推测内容填充。
- `/i18n-docs` 只生成 `README.xx.md`，不覆盖或改写原文。
- `/doc-guard` 依赖 git diff 判断需更新的文档段落；无版本历史时无法给出完整结论。
- 生成的站点骨架只包含结构与侧边栏，内容仍需人工填充。

## 许可证

[AGPL-3.0-only](../../LICENSE)
