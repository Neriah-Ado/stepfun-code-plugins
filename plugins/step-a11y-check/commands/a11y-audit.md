---
description: "静态扫描前端模板的可访问性问题（JSX/HTML/Vue），按 WCAG 条目映射并落盘报告 docs/a11y-report.md"
argument-hint: [目录，默认 src/] [--out docs/a11y-report.md]
---

# /a11y-audit — 可访问性静态审计

<!-- A11Y-RULES-START -->
```json
{
  "detectors": [
    { "check": "img 缺 alt 或 alt=\"\"（后者仅装饰性可接受，需注释说明）", "wcag": "1.1.1" },
    { "check": "button/a 无可读文本且无 aria-label", "wcag": "2.4.4 / 4.1.2" },
    { "check": "input/select/textarea 缺关联 label（for/id 或 aria-label）", "wcag": "3.3.2 / 1.3.1" },
    { "check": "tabindex 正值（打断自然焦点顺序）", "wcag": "2.4.3" },
    { "check": "aria-* 拼写不在 ARIA 属性白名单 / aria-hidden 用于可聚焦元素", "wcag": "4.1.2" },
    { "check": "仅用颜色承载状态（无文本/图标冗余）", "wcag": "1.4.1" },
    { "check": "div+onClick 伪造可点击（无 role/键盘事件）", "wcag": "2.1.1 / 4.1.2" }
  ],
  "scope": "默认 src/ 下 .jsx .tsx .html .vue；跳过 node_modules 与构建产物",
  "report": "docs/a11y-report.md：四列表（位置 / 问题 / WCAG 条目 / 建议）+ 计数 + 静态扫描局限声明",
  "false_positive": "lint 注释（eslint-disable 等含 a11y 字样）标住的行跳过并计数"
}
```
<!-- A11Y-RULES-END -->

## 流程

1. 收集目标文件，逐个按 detectors 检查；只看模板与属性字面量，不做运行时推断。
2. 命中写入四列表；无法确定意图的（如 alt=""）按「疑似」列出并说明判断依据。
3. 报告落盘，终端给计数与 Top 问题摘要。

## 输出格式

问题计数（按 WCAG 条目分桶）→ 疑似项说明 → 报告路径 → 局限声明（静态扫描不含运行时焦点顺序、实际对比度与屏幕阅读器行为）。
