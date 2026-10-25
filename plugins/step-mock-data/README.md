# step-mock-data — 测试数据生成与脱敏

纯声明式插件：按 schema 生成**虚构**测试数据，把真实样例数据**脱敏**成文档可用的形态。两条路径都围绕同一个红线：不让真实个人信息进测试与文档。

## 它解决什么

测试数据要么随手编格式还不对，要么拿真实用户数据拷进测试库——前者拖调试，后者是合规事故。本插件从 schema 出发生成合法的虚构数据，反向把真实样例掩码成保留格式的安全形态。

## 使用

| 命令 | 说明 |
| --- | --- |
| `/mock-data <schema> [条数]` | 按 JSON Schema / TS 类型 / 建表语句生成虚构数据，超 20 条落盘（C5） |
| `/mask-data <数据> [--keep N\|--full]` | 手机号/身份证/邮箱/姓名/银行卡格式保持掩码，声明可逆性 |

## 安装

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-mock-data
```

## 验证

```bash
node tests/validate.mjs
```

## 边界与限制

- 生成器不内置真实个人信息样本；身份证类字段只出格式占位，声明不可用作实名用途。
- 复杂 schema（条件式 if/then、正则 pattern）只覆盖常见形态，未覆盖项显式列出。
- 默认掩码保留前后缀、可反推部分信息，要求不可逆用 `--full`。
- 脱敏原文不落盘，只存在于会话。

## 许可证

[AGPL-3.0-only](../../LICENSE)
