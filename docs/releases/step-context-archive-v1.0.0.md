# step-context-archive v1.0.0 — 首个社区贡献插件发布 / First Community Plugin Release

> 发布日期 / Date: 2026-10-01（已发布，tag `step-context-archive-v1.0.0` / Released, tagged 2026-10-01）
> 范围 / Scope: 仓库首个社区贡献插件合入并完成验证发布（PR #1，作者 [@uos1231234](https://github.com/uos1231234)）/ First community-contributed plugin, merged and now verified & released (PR #1 by [@uos1231234](https://github.com/uos1231234))
> 门禁 / Gate: ALL PASS（751 项断言、31 个检查区，含该插件的专属检查区 / 751 assertions across 31 sections incl. the plugin-specific section）

---

## 中文

### 这个插件做什么

长会话的**上下文归档与召回**：`/archive` 把已完成任务块的**原文**写入项目内
`.stepcode/context-archive/stamp-<id>.md`，对话里只留一行带三点摘要
（目标 / 关键决策 / 是否完成）的 `#STAMP` 索引行；`/recall` 按索引取回原文、
基于原文回答。配套技能 `context-archive` 约定 `#STAMP` 语义、摘要协议与召回纪律。

设计原则是**摘要用于导航，原文用于引用**：摘要可能失真，一切以归档文件为准。
它解决的问题是长会话里早期任务的大段细节（堆栈、命令输出、完整代码）当下用不到、
将来要引用、却持续占用窗口。

### 社区贡献与维护合入（2026-09-27）

- PR #1 由 [@uos1231234](https://github.com/uos1231234) 于 2026-09-26 发起，
  声明式形态（清单 + 命令 + 技能，无 `entry` / `hooks` / `lspServers`，符合平台约束）；
- 评审实测结论：无安全风险（只写默认目录、不覆盖、召回只读、零依赖零网络）、
  与 roadmap/marketplace/README 登记齐全、**诚实标注未完成项**（真实项目验证项当时未做，
  状态如实标为进行中，未谎报完成）；
- 合并后的维护调整：roadmap 冲突按「上游 12 条完成 + 追加本插件」解决；
  命令文本补 `ARCHIVE-RULES` / `RECALL-RULES` JSON 规则块接入门禁的插件专属检查区；
  CHANGELOG 自举一致性检查接入本插件；内容修正——`#STAMP` 索引行改**项目相对路径**、
  退化 id（`b` 前缀短 id）明确为主格式的显式例外。

### 真实项目验证（2026-09-29，随 v1.0.0 置 done）

贡献者在 PR #1 评论提交了两个真实项目的全链路验证与**全量可复算数据**：

| 项目 | 触发方式 | 归档块 / 体量 | 一致性结论 |
| --- | --- | --- | --- |
| Atlas Sync 长程任务（deepswe-eval `agent-shell-long-horizon` 副本） | 压缩接管自动触发（`fromHook: true`，`tokensBefore: 228691`） | 7 块 / 1067 KB | 7 条 `#STAMP` 索引行全部指向真实存在的项目相对路径；压缩后模型**不读文件**答出 30 个文件之前埋设的早期事实 |
| Effect HttpApi SSE（deepswe-eval `repos/effect-sse-httpapi-streaming` 副本，Effect-TS 子集，2240 文件 monorepo） | 模型显式 `/archive` → `/recall` | 165 块 / 1032.2 KB | 索引↔磁盘 165/165 全对齐：0 缺失、0 重复、0 字节不符、0 首行不符、无摘要污染；聚合 sha256 `a07a2736…402cd` |

- 第三条验收（「除 `.stepcode/context-archive/` 外无文件副作用」）同样核销：
  `git ls-files` 逐目录确认 + 代码侧仅 2 个写入点，均指向归档根；
- 评论附带**零依赖校验脚本**（Node 18+，标准库），可在任一项目上独立复算全部结论；
- **诚实备注**（贡献者自己先行标注，此处保留）：项目 2 的 `/archive` → `/recall` 链路
  是按同一协议**手工执行**的——当时宿主尚未装载声明式插件的 commands/skills，
  因此这份数据验证的是**归档协议与产物格式的正确性**，不是宿主装载通道本身。

### 宿主加载通道：上游已修复（2026-09-29/30）

验证期间报告的两个宿主问题均已被上游（stepfun-ai/Step-Code）修复：

- [`bda152e074`](https://github.com/stepfun-ai/Step-Code/commit/bda152e074)（2026-09-29）：
  已安装插件的 `skills/` 与 `commands/` 经 `resources_discover` 通道装载（会话内安装的
  插件在下次资源重载生效，项目插件根受 trust 门控）——本插件的 `/archive`、`/recall`
  与技能在 **≥ 2026-09-30 的 Step Code 构建**上正常生效；
- [`be4d5f4d81`](https://github.com/stepfun-ai/Step-Code/commit/be4d5f4d81) +
  [`0903f1f772`](https://github.com/stepfun-ai/Step-Code/commit/0903f1f772)（2026-09-30）：
  插件清单内联 stdio MCP server 的工作目录锚定到插件根（相对 `args` 不再解析到
  step 进程目录），并修正路径包含判定的 `..` 旁路——本集合 6 个 MCP 型插件
  （`{"command":"node","args":["server/index.mjs"]}` 写法）在修复前宿主上确实无法启动，
  修复后恢复正常。上游在 [issue #204](https://github.com/stepfun-ai/Step-Code/issues/204)
  中注明第二项「采用了贡献者提出的方案」。

### 发布内容与流程

- **开发元数据**：真实项目验证项置 done（验证证据摘要写入任务上下文）、版本与插件状态 done、
  risks 首条更新为上游修复后的口径；
- roadmap `latest_version: "1.0.0"` / status done；根 README 徽章回填 v1.0.0；
- CHANGELOG 按仓库惯例由 `tests/bootstrap-changelog.mjs` 从 git 历史自举
  （含修复 a461a6d 许可切换提交引入的自举漂移——该提交当时未重新自举，CI 双平台红，
  本次发布一并修复）；
- 门禁的诚实状态守卫同步翻转：现在断言真实项目验证已完成、roadmap 已回填、
  README 徽章已更新——门禁与状态同进退；
- 许可口径：本集合自 a461a6d 起以 **AGPL-3.0-only** 分发，声明式内容随集合；
  贡献者的独立代码版扩展仓库亦切换为 AGPL-3.0-only（`0e0ce9f`），与本集合口径一致。

## English

`step-context-archive` is the repo's first community-contributed plugin (PR #1 by
[@uos1231234](https://github.com/uos1231234), merged 2026-09-27). It archives
completed task blocks **verbatim** into `.stepcode/context-archive/stamp-<id>.md`
inside the project, leaving a one-line `#STAMP` index with a three-point summary
(goal / key decisions / done-or-not) in the conversation; `/recall` fetches the
archived original text and answers from it. Design principle: **summaries are for
navigation, originals are for citation**.

**Real-project verification (2026-09-29, done with this release)**: two
real projects, fully reproducible data submitted in PR #1 comments — Atlas Sync
long-horizon task (auto takeover via compaction hook, 7 blocks / 1067 KB, the model
recalled early facts from 30 files back without reading files after compaction) and
effect-sse-httpapi-streaming (Effect-TS subset, 2240-file monorepo, 165 blocks /
1032.2 KB, 165/165 index↔disk alignment: 0 missing, 0 duplicate, 0 byte mismatch,
0 first-line mismatch, no summary pollution; aggregate sha256 `a07a2736…402cd`).
A dependency-free verification script ships with the comments; the acceptance
criterion "no file side effects outside `.stepcode/context-archive/`" is verified
too. Honest note (contributor-flagged first): project 2's `/archive` → `/recall`
loop was executed **manually against the same protocol** — at that time the host
did not load declarative plugins' commands/skills yet — so the data verifies the
**archive protocol and artifact format**, not the host loading path.

**Host loading gap fixed upstream (2026-09-29/30)**: `bda152e074` loads installed
plugins' `skills/`/`commands/` via `resources_discover` (reload-pickup, project
roots trust-gated) — this plugin's commands and skill take effect on **Step Code
builds ≥ 2026-09-30**; `be4d5f4d81` + `0903f1f772` anchor inline stdio MCP servers
to the plugin root (relative `args` resolve correctly now, `..` containment bypass
fixed). All six MCP-type plugins of this collection (the
`{"command":"node","args":["server/index.mjs"]}` pattern) were indeed unstartable
on pre-fix hosts and work again after the fix; upstream notes in
[issue #204](https://github.com/stepfun-ai/Step-Code/issues/204) that the second
fix "uses the approach you proposed", crediting the contributor.

Release mechanics: the development metadata flips the real-project verification / version / plugin status to done
(evidence summarized in the task context) with `risks[0]` updated to the
post-fix wording; roadmap backfills `latest_version: "1.0.0"`; root README badge
backfilled; CHANGELOG re-bootstrapped from git history per repo convention (also
repairing a bootstrap drift introduced by the `a461a6d` license-switch commit,
which had left CI red on both platforms); the gate's honesty guard flipped in
lockstep — it now asserts the done state, the backfill, and the badge. License
note: the collection has been **AGPL-3.0-only** since `a461a6d`; the declarative
content ships with it, and the contributor's standalone code-extension repo
switched to AGPL-3.0-only as well (`0e0ce9f`).

---

*标签 / Tags: `step-context-archive-v1.0.0`（2026-10-01，main = a461a6d 之后的发布提交）*
*贡献者 / Contributor: [@uos1231234](https://github.com/uos1231234) · 维护 / Maintenance: Neriah-Ado*
