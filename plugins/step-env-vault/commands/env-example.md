---
description: "从 .env 生成可入库的 .env.example：值替换为类型占位符，保留注释与顺序；生成内容不含真实值"
argument-hint: [--src .env] [--out .env.example]
---

# /env-example — 生成 .env.example

<!-- EXAMPLE-RULES-START -->
```json
{
  "default": { "src": ".env", "out": ".env.example" },
  "placeholder": { "猜空": "<EMPTY>", "猜数字": "<NUMBER>", "猜布尔": "<true|false>", "猜URL/主机": "<URL>", "猜密钥类命名（KEY/SECRET/TOKEN/PASSWORD）": "<SECRET>", "其他": "<VALUE>" },
  "keep": "注释、空行、key 顺序原样保留；值全部替换，绝不透传",
  "overwrite": "out 已存在时先展示将覆盖的内容并确认"
}
```
<!-- EXAMPLE-RULES-END -->

## 流程

1. 读 src，逐行处理：注释原样输出；`KEY=VALUE` 输出 `KEY=<占位符>`；异常行跳过并警告。
2. 占位符按 key 命名与值形态推断（见 EXAMPLE-RULES），推断不出用 `<VALUE>`。
3. out 不存在直接写盘；已存在则 diff 确认后覆盖。
4. 尾部自查：对生成内容再扫一遍，任何行仍含真实值形态（长随机串、`://`+凭据）即报错重来。

## 输出格式

生成路径（绝对路径）→ key 总数与占位符分布 → 覆盖确认提示（如触发）。
