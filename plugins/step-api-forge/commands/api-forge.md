---
description: OpenAPI 全链路入口：校验 spec → 生成 TS/Python 客户端 / mock / 文档页 → 落盘（产物给路径，C5）
argument-hint: [spec 路径与产物类型，可选；如 "api.json ts"]
---

# /api-forge — OpenAPI 全链路

## 1. 校验

`validate_spec`：结构校验（openapi 3.0/3.1 字段、info、paths、每个 operation 必须有 responses）。校验失败列出全部错误并停止。实现为插件内置零依赖校验器（与 tests 同源语义）；网络可用时可换用 @readme/openapi-parser 增强。

安全输入边界（C-04）：path 仅允许 URL 安全字符（`A-Za-z0-9 . _ ~ / { } -`），path 参数名必须是合法标识符，`operationId` 与响应码同样校验；`servers[].url`、注释与文档页 HTML 在生成时转义。非法 spec 直接报错而不是生成可疑产物。从不可信来源获取 spec 时，运行生成产物前仍需人工审查。

## 2. 生成

| 产物 | 工具 | 落盘默认路径 |
| --- | --- | --- |
| TS 客户端 | `generate_ts_client` | `src/api/client.generated.ts` |
| mock server（v1.1.0） | `generate_mock`（express/msw） | `mock/server.js` 或 `src/mocks/handlers.ts` |
| 文档页（v1.1.0） | `generate_docs` | `docs/api-reference.html` |
| Python SDK（v1.3.0） | `generate_python_sdk` | `sdk/<name>_client.py` |
| diff 报告（v1.2.0） | `diff_spec` | `docs/api-diff.md` |

- 产物文本由工具返回后**写入指定目录**（用户给的路径优先），完成后给绝对路径，不内联全文（C5）。
- 生成代码标头带「由 step-api-forge 生成」，禁止手改生成文件（改 spec 再生成）。

## 3. 验证生成产物

- TS：产物包含每个 operation 的方法；建议跑 `npx tsc --noEmit` 复核（未安装 TS 时提示）。
- 变更管理（v1.2.0）：`diff_spec` 报告 breaking（删除路径/方法、移除响应码、新增必填参数等）；已知 breaking 样本 100% 检出规则见 tests/lib/api-diff-cases。
- 反向生成（v1.3.0）：Agent 读路由代码整理 spec 的**提示词辅助模式**（不强求全自动）；结果与手写 spec 的 diff 由用户评审。

## 4. 汇报

spec 版本与 operation 数、生成产物清单与路径、校验/diff 结论。
