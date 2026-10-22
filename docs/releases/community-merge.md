# 社区贡献滚动更新 — 自 PR #1 合并起 / From PR #1 Merge Onward

> 发布日期 / Date: 2026-09-27 起滚动更新，最新段落止于 2026-10-01 / rolling since 2026-09-27, latest entry 2026-10-01
> 范围 / Scope: v1.3.0 收官波次之后的**仓库级更新**——首个社区贡献插件、门禁与 CI 建设、行尾规范化；本文件滚动追加，直到下一个版本波次定稿 / repo-level updates after the v1.3.0 wave — first community plugin, gate & CI, line-ending hygiene; this file keeps rolling until the next version wave is finalized
> 门禁 / Gate: ALL PASS（745 项断言、31 个检查区 / 745 assertions across 31 sections）；GitHub Actions `validate` ubuntu + windows 双平台 SUCCESS

---

## 中文

收官之后的第一批更新不是版本波次，而是一次**社区贡献的合入**，以及围绕它把仓库的工程底盘补齐：门禁接入新插件、CI 上线双平台、行尾规范统一。节奏不同，标准不变——每一项改动都过完整门禁，每一处诚实标注都保留。

### 2026-09-27 — PR #1 合并与合并后维护

**合入 / Merged**

- 新增第 13 个插件 **step-context-archive**（社区贡献 [@uos1231234](https://github.com/uos1231234)，
  声明式形态：`/archive` 把已完成任务块原文落盘、对话只留 `#STAMP` 三点摘要索引行，
  `/recall` 按索引取回原文；配套技能约定索引语义与召回纪律）；
- roadmap / marketplace / README 三处登记齐，状态如实标为**进行中**：该插件的真实项目
  验证（≥2 个真实项目）尚未完成，`latest_version` 置空待发布回填（按仓库发布约定）。

**合并后维护 / Post-merge maintenance**（main 侧 11 个提交，含 1 个 merge；另带入贡献者分支 8 个提交）

- **版本口径**：README 徽章改进行中标注、总量表述修正——v1.0.0 未发布前不冒领版本号；
- **门禁接入**：`/archive`、`/recall` 补 `ARCHIVE-RULES` / `RECALL-RULES` JSON 规则块
  （与既有插件同一「单一事实源」模式）；门禁新增**插件专属检查区**（规则块字段、
  frontmatter、安全红线、诚实状态守卫：真实项目验证未完成前不得标完成、
  `latest_version` 必须为 null）；**CHANGELOG 自举一致性检查**接入新插件，CHANGELOG 按仓库惯例
  由 `tests/bootstrap-changelog.mjs` 从 git 历史重新自举；
- **内容修正**：`#STAMP` 索引行从绝对路径改为**项目相对路径**（跨机器/移动仓库
  仍可解析），退化 id（`b` 前缀短 id）明确为 12 位小写十六进制主格式的**显式例外**；
- **CI 上线**：新增 `.github/workflows/validate.yml`（ubuntu + windows 双平台跑
  `node tests/validate.mjs`，`fetch-depth: 0` 保障历史校验）——首跑即抓到一个真问题：
  windows 检出 CRLF 导致 CHANGELOG 自举比对假失败；修复方式为比对归一化 CRLF +
  `.gitattributes` 统一仓库 LF（本地以 `autocrlf=true` 克隆精确复现后修复）；
- **文档**：[step-context-archive v1.0.0 预发布说明](./step-context-archive-v1.0.0.md)
  （双语，含发布前 checklist）挂 README；本文件即 v1.3.0 波次之后的滚动发布说明。

**贡献者的两项上游反馈**（评审中核实并处理）：上游 main 门禁曾因 `tests/lib/dev-log.mjs`
漏提交崩溃（已由 `8d3dfef` 补交修复）；Step Code v0.1.1 宿主尚未加载已安装插件的
`commands/` / `skills/`（已如实写入插件 README 与 risks，待官方核实）。

### 2026-10-01 — step-context-archive v1.0.0 发布与宿主修复确认

**真实项目验证完成，插件随 v1.0.0 发布**（tag `step-context-archive-v1.0.0`）：

- 贡献者于 2026-09-29 提交两个真实项目的全链路验证与**全量可复算数据**：
  Atlas Sync 长程任务（压缩接管自动触发，7 块 / 1067 KB，召回不读文件答出早期事实）、
  effect-sse-httpapi-streaming（Effect-TS 子集 2240 文件 monorepo，165 块 / 1032.2 KB，
  索引↔磁盘 165/165 全对齐、聚合 sha256 可复算、零依赖校验脚本随评论给出）；
  贡献者并诚实标注项目 2 的归档/召回为按协议手工执行——验证的是协议与产物格式，
  不是宿主装载通道（详见 [v1.0.0 发布说明](./step-context-archive-v1.0.0.md)）；
- roadmap / README / 开发元数据三处回填，门禁的诚实状态守卫同步翻转为完成态；
- CHANGELOG 重新自举，**顺带修复 a461a6d（MIT → AGPL-3.0-only 许可切换）遗留的
  自举漂移**——该提交动过插件 README 但未重新自举，推送后 CI 双平台红，本次一并修复。

**宿主修复确认**：验证期间报告的两个宿主问题均已被上游 stepfun-ai/Step-Code 修复——
`bda152e074`（2026-09-29）装载插件 `skills/`/`commands/`；
`be4d5f4d81` + `0903f1f772`（2026-09-30）把内联 stdio MCP server 锚定到插件根并修复
路径包含判定的 `..` 旁路，[issue #204](https://github.com/stepfun-ai/Step-Code/issues/204)
注明后者「采用了贡献者提出的方案」。本集合 6 个 MCP 型插件
（`{"command":"node","args":["server/index.mjs"]}` 写法）在修复前宿主上确实无法启动、
修复后恢复。声明式插件与 MCP 插件自此在最新上游构建上均可用；更早版本宿主的限制
继续如实写在各插件文档。

**贡献者的持续上游工作**：其独立代码版扩展仓库在验证后提交了一批高质量审计修复
（中止落盘、磁盘索引 `INDEX.md`、写盘失败的 `#UNARCHIVED` 行、半截文件自愈等，
2026-09-29 ~ 10-01），并把自己的许可从 MIT 切换为 AGPL-3.0-only（`0e0ce9f`），
与本集合 a461a6d 的口径对齐。

## English

The first update after the wrap-up wave is not a version wave but a **community
contribution**, plus the engineering groundwork that came with it: gating the new
plugin into the repo's checks, standing up two-platform CI, and normalizing line
endings. Different rhythm, same standard — every change went through the full gate,
and every honest "pending" marker was preserved.

**Merged**: the 13th plugin **step-context-archive** (community contribution by
[@uos1231234](https://github.com/uos1231234), declarative form) — `/archive` writes
completed task blocks **verbatim** into the project and leaves a one-line `#STAMP`
three-point summary index in the conversation; `/recall` fetches the original text
and answers from it. Registered in roadmap/marketplace/README; honestly
**in progress** (real-project verification pending, `latest_version` left `null`
until release, per the repo's release convention).

**Post-merge maintenance** (11 commits on main incl. one merge; 8 commits brought
in from the contributor's branch): version bookkeeping corrected; `ARCHIVE-RULES` /
`RECALL-RULES` JSON blocks added to the command texts and enforced by a new
plugin-specific gate section (block fields, frontmatter, safety red lines, and an
honesty guard); the CHANGELOG bootstrap-consistency check now covers the plugin,
whose CHANGELOG was regenerated from git history per repo convention; content fixes —
`#STAMP` index lines switched to **project-relative paths** and the `b`-prefixed
fallback id documented as an explicit exception to the 12-hex main format; **CI
onboarded** (`.github/workflows/validate.yml`, ubuntu + windows) — its very first run
caught a real bug (CRLF checkouts breaking the CHANGELOG bootstrap comparison), fixed
by normalizing the comparison and adding `.gitattributes` (repo-wide LF); and the
pre-release bilingual notes for step-context-archive v1.0.0 were published with a
release checklist.

The contributor's two upstream findings were verified and handled: the missing
`tests/lib/dev-log.mjs` that broke the main-branch gate (fixed in `8d3dfef`), and
the report that Step Code v0.1.1 does not yet load installed plugins' `commands/`
and `skills/` (documented honestly in the plugin README and `risks`).

**2026-10-01 — step-context-archive v1.0.0 released, host fixes confirmed.**
Real-project verification completed and the plugin was tagged
`step-context-archive-v1.0.0`: two real projects with fully reproducible data
submitted by the contributor (Atlas Sync long-horizon task — auto compaction
takeover, 7 blocks / 1067 KB, recall answered early facts without re-reading files;
effect-sse-httpapi-streaming — Effect-TS subset, 2240-file monorepo, 165 blocks /
1032.2 KB, 165/165 index↔disk alignment with a recomputable aggregate sha256 and a
dependency-free verification script). The contributor honestly flagged that project
2's archive/recall loop ran manually against the same protocol, so the data verifies
the protocol and artifact format, not the host loading path. roadmap / README /
development metadata were backfilled with the gate's honesty guard flipped in
lockstep, and the CHANGELOG was re-bootstrapped — repairing a bootstrap drift left by
`a461a6d` (the MIT → AGPL-3.0-only license switch), which had kept CI red on both
platforms. Both reported host gaps are now fixed upstream: `bda152e074` loads
plugin `skills/`/`commands/`; `be4d5f4d81` + `0903f1f772` anchor inline stdio MCP
servers to the plugin root (upstream's
[issue #204](https://github.com/stepfun-ai/Step-Code/issues/204) credits the
contributor's approach) — all six MCP-type plugins of this collection, unstartable
on pre-fix hosts, work again. The contributor's standalone extension repo shipped
a batch of high-quality audit fixes (abort-safe disk writes, an on-disk
`INDEX.md`, `#UNARCHIVED` lines for failed writes, truncated-file self-heal) and
aligned its license to AGPL-3.0-only with this collection.

---

*门禁 / Gate: `node tests/validate.mjs` — 751 PASS / 0 FAIL；CI: `validate (ubuntu-latest)` ✅ + `validate (windows-latest)` ✅*
*提交 / Commits: 滚动追加；最新段落止于 step-context-archive v1.0.0 发布提交（2026-10-01）*
