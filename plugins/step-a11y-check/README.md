# step-a11y-check — 无障碍静态审计

纯声明式插件：扫描前端模板里最常见的可访问性反模式，映射到 WCAG 条目，修复走「报告 → 最小 diff → 确认」三步。

## 它解决什么

可访问性问题大多在写代码当场就能看出：图没有 alt、输入框没有 label、按钮是个 `div`。本插件把这些当场能查的东西查出来，并给每一处一个最小修复 diff——不引入工具链，不上浏览器。

## 使用

| 命令 | 说明 |
| --- | --- |
| `/a11y-audit [目录]` | 扫描 .jsx/.tsx/.html/.vue 的七类问题，四列表（位置/问题/WCAG 条目/建议）落盘 `docs/a11y-report.md` |
| `/a11y-fix [--report 路径] [序号|all]` | 按报告逐处给最小 diff，确认后写盘并复核 |

## 安装

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-a11y-check
```

## 验证

```bash
node tests/validate.mjs
```

## 边界与限制

- 静态扫描：不含运行时焦点顺序、实际渲染对比度与屏幕阅读器行为验证。
- `alt=""`、`aria-hidden` 等合理用法按「疑似」列出而非误报为问题。
- 修复只改报告定位的位置，不做格式重排或重构。

## 许可证

[AGPL-3.0-only](../../LICENSE)
