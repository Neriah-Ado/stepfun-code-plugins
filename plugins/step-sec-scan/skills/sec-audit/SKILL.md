---
name: sec-audit
description: 安全审计方法论：secret 模式识别、误报降噪、依赖漏洞处置、基线与 SBOM、pre-commit 集成。安全审查相关任务使用。
---

# sec-audit — 安全审计方法论

## 误报降噪规则（SS-100-3 / C-06）

<!-- SEC-NOISE-START -->
```json
{
  "noise_paths": ["tests/", "test/", "__tests__/", "spec/", "examples/", "fixtures/", "docs/", "mocks/"],
  "noise_values": ["xxx*", "0{8,}", "your-*", "changeme", "placeholder", "redacted", "${...} 模板", "{{...}} 模板", "<占位>", "example*", "sample*", "dummy*", "fake*", "mock*", "test*"],
  "rule": "占位值一律忽略；测试/示例/文档路径不再整体忽略——非占位值降级为 low 并标注 noise，其余路径为 critical",
  "dev_deps": "devDependencies 中的 low 级漏洞默认降噪，high 及以上保留",
  "ci_gate": "CI 卡点默认只拦 critical/high，故测试/文档中的疑似值不阻断流水线，但会出现在报告里供人工复核"
}
```
<!-- SEC-NOISE-END -->

## 扫描范围与 git 历史（C-06）

- 内置 `scan_secrets` 的范围是**传入的 diff/文本**（默认 staged 增量，`--full` 为工作树全量文本）；它**不会**自动遍历 git 历史。
- 历史扫描是显式步骤：`git log -p --all > /tmp/history.diff` 后把内容传给 `scan_secrets` 的 `diffText`（该格式已被解析器支持）；或用 `gitleaks detect --log-opts=--all` 做二进制级扫描。历史扫描通常较慢且噪声更多，建议只在轮换/审计时执行。
- 已删除文件与旧 tag 中的凭据同样需要历史扫描；命中后按「轮换 > 清历史 > 报告」处置。

## pre-commit hook 集成模式（SS-110-2）

```sh
# .git/hooks/pre-commit（或 lint-staged 配置）
step -p "调用 step-sec-scan 的 scan_secrets 工具扫描当前 staged diff；发现 critical/high 时以退出码 1 阻止提交并输出建议"
```

约定：hook 模式**只扫 staged 增量**，超时 30s，失败不阻塞提交除非用户开启 fail_on 配置。

## 处置优先级

1. 已泄漏的 secret：轮换凭据 > 清理历史 > 报告；
2. 依赖漏洞：critical/high 先修（可自动修复的优先），medium 评估影响面，low 记录基线；
3. 基线模式用于「先冻结存量、只拦新增」的渐进治理。
