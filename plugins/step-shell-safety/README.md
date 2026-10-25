# step-shell-safety — Shell 命令安全预检

纯声明式插件：对即将执行的命令做静态风险分级与更安全替代建议，并把团队已知的安全模式沉淀为可评审的白名单。预检全程零执行。

## 它解决什么

终端 AI Agent 高频执行 shell 命令，最危险的往往不是恶意，而是「顺手」：递归删除、force push、管道执行远程脚本。分级参考、解释副作用、给替代写法，把确认的依据摆到桌面上，而不是靠一次弹窗的肌肉记忆。

## 使用

| 命令 | 说明 |
| --- | --- |
| `/shell-check <命令>` | 静态解析并解释命令副作用，按 block / warn / note 分级，给出更安全写法 |
| `/risk-baseline` | 维护项目白名单 `config/risk-baseline.json`：`--list` / `--add` / `--remove` |

内置 `dangerous-patterns` 技能：不可逆删除、远程执行、提权、范围逃逸、持久化五类危险模式库。

## 安装

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-shell-safety
```

## 验证

```bash
node tests/validate.mjs
```

## 边界与限制

- 预检本身不执行被检命令；执行与否始终由用户决定，分级是静态分析参考而非安全保证。
- 模式库不完备，无法确定作用域的命令一律按 warn 处理。
- 白名单只降级告警等级，永不把命令升为免检。
- 不分析二进制与混淆脚本的内容语义。

## 许可证

[AGPL-3.0-only](../../LICENSE)
