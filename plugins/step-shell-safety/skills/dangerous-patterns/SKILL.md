---
name: dangerous-patterns
description: 危险 Shell 命令模式库：按类别列出高危形态、识别要点与更安全替代，供 /shell-check 与日常命令评审引用
---

# 危险命令模式库

<!-- PATTERN-CATEGORIES-START -->
```json
{
  "irreversible": ["rm -rf 指向 / / ~ / $VAR 拼接路径", "git push --force 覆盖远端历史", "DROP TABLE / TRUNCATE", "磁盘格式化与分区命令"],
  "remote-exec": ["curl/wget 管道到 sh/bash", "安装脚本未审阅直接执行", "base64/eval 包裹的隐藏执行"],
  "privilege": ["chmod 777 / chown -R 系统路径", "sudo 包装的未知脚本", "setuid/capability 调整"],
  "scope-escape": ["cd 未校验后跟删除", "变量未加引号遇空格/通配符展开", "$(...)/反引号嵌套的间接删除"],
  "persistence": ["写 crontab / rc / 注册表 Run 键", "ssh key 注入", "服务安装"],
  "safer": { "force-push": "git push --force-with-lease", "delete": "先 ls 确认目标再逐个删除，或移入回收目录", "remote-script": "先下载到本地、通读后再执行", "sudo": "最小化授权并解释每一步" }
}
```
<!-- PATTERN-CATEGORIES-END -->

## 使用规则

- 匹配到任一类别即在 `/shell-check` 输出中点名类别与对应条目。
- 模式库是**不完备清单**：未命中不等于安全，`unknown` 一律按 warn 处理。
- 只做识别与建议，本技能不包含任何执行步骤。
