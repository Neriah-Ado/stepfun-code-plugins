#!/usr/bin/env node
/**
 * stepcode-plugins 插件门禁校验（AGENTS.md §4 中可脚本化的部分）。
 * 零依赖：node tests/validate.mjs
 * 环境变量 GIT_BIN 可指定 git 可执行文件（默认 "git"）。
 */
import { readFileSync, existsSync, statSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;

const ok = (name) => console.log(`PASS ${name}`);
const bad = (name, detail) => { failed += 1; console.log(`FAIL ${name} :: ${detail}`); };
const check = (cond, name, detail = '') => (cond ? ok(name) : bad(name, detail));

// ---------- 1. 仓库骨架 ----------
check(existsSync(join(ROOT, 'AGENTS.md')), 'repo/AGENTS.md 存在');
check(existsSync(join(ROOT, '.step-plugin', 'marketplace.json')), 'repo/marketplace 存在');

const roadmap = JSON.parse(readFileSync(join(ROOT, 'roadmap.json'), 'utf8'));
for (const p of roadmap.plugins) {
  check(existsSync(join(ROOT, p.spec)), `roadmap/${p.id} spec 存在`, p.spec);
}

// ---------- 2. 插件清单门禁（G2） ----------
const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const FORBIDDEN_KEYS = ['entry', 'hooks', 'lspServers'];

for (const p of roadmap.plugins) {
  const dir = join(ROOT, p.spec, '..');
  const manifestPath = join(dir, 'step.plugin.json');
  if (!existsSync(manifestPath)) continue; // 未开发的插件只有 plugin.yaml
  const tag = `manifest/${p.id}`;

  const raw = readFileSync(manifestPath, 'utf8');
  check(statSync(manifestPath).size < 512 * 1024, `${tag} <512KB`);
  let m;
  try {
    m = JSON.parse(raw);
  } catch (e) {
    bad(`${tag} JSON 合法`, e.message);
    continue;
  }
  check(SAFE_ID.test(m.id ?? ''), `${tag} id 安全名`, String(m.id));
  check(m.id === p.id, `${tag} id 与 roadmap 一致`, `${m.id} vs ${p.id}`);
  check(SEMVER.test(m.version ?? ''), `${tag} version 语义化`, String(m.version));
  for (const k of FORBIDDEN_KEYS) {
    check(!(k in m), `${tag} 不含禁止字段 ${k}`);
  }
  for (const rel of [...(m.commands ?? []), ...(m.skills ?? []), ...(m.agents ?? [])]) {
    check(existsSync(join(dir, rel)), `${tag} 资源存在 ${rel}`);
  }
  check(existsSync(join(dir, 'README.md')), `${tag} README 存在（G5）`);
  check(existsSync(join(dir, 'CHANGELOG.md')), `${tag} CHANGELOG 存在（G5）`);
}

// ---------- 3. marketplace 源 ----------
const market = JSON.parse(readFileSync(join(ROOT, '.step-plugin', 'marketplace.json'), 'utf8'));
check(typeof market.name === 'string' && market.name.length > 0, 'marketplace/name 存在');
for (const entry of market.plugins ?? []) {
  check(
    existsSync(join(ROOT, entry.source, 'step.plugin.json')),
    `marketplace/${entry.name} source 指向有效插件`,
    entry.source,
  );
}

// ---------- 4. step-commit 命令安全规则存在性（G3） ----------
const commitCmd = readFileSync(join(ROOT, 'plugins/step-commit/commands/commit.md'), 'utf8');
for (const needle of ['HEREDOC', 'git status', 'git diff --staged', '--no-verify', '除非用户', 'git push --force']) {
  check(commitCmd.includes(needle), `commands/commit.md 含关键规则「${needle}」`);
}
const cppCmd = readFileSync(join(ROOT, 'plugins/step-commit/commands/commit-push-pr.md'), 'utf8');
for (const needle of ['gh --version', 'gh auth login', 'winget install GitHub.cli', '禁止 force push']) {
  check(cppCmd.includes(needle), `commands/commit-push-pr.md 含关键规则「${needle}」`);
}

// ---------- 5. Conventional Commits 校验 ----------
const CC_RE = /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([a-z0-9._/-]+\))?!?: (.+)$/;
const subjectOk = (subject) =>
  subject.length > 0 && subject.length <= 160 && !subject.endsWith('.') && !subject.endsWith('。'); // 本仓库上限 160（多任务 ID 后缀的历史提交已推送，不改写）
const checkMessage = (line) => {
  const m = CC_RE.exec(line);
  return Boolean(m) && subjectOk(m[3]);
};

const samples = JSON.parse(readFileSync(join(ROOT, 'tests/samples/commits.json'), 'utf8'));
for (const s of samples.valid) check(checkMessage(s), `commit 样例合法「${s}」`);
for (const s of samples.invalid) check(!checkMessage(s), `commit 样例按预期拒绝「${s}」`);

// 本仓库提交历史自举校验（git 不可用时 SKIP，不算失败）
const GIT_BIN = process.env.GIT_BIN || 'git';
if (existsSync(join(ROOT, '.git'))) {
  const probe = spawnSync(GIT_BIN, ['--version'], { cwd: ROOT });
  if (probe.status === 0) {
    const log = execFileSync(GIT_BIN, ['log', '--pretty=%s'], { cwd: ROOT, encoding: 'utf8' });
    const subjects = log.split('\n').filter(Boolean);
    for (const s of subjects) check(checkMessage(s), `git 历史 message 合法「${s}」`);
  } else {
    console.log(`SKIP git 历史校验（找不到 git：${GIT_BIN}，可用 GIT_BIN 环境变量指定）`);
  }
}

// ---------- 6. step-commit scope 推断规则与样例（SC-110-2） ----------
const commitCmdPath = join(ROOT, 'plugins/step-commit/commands/commit.md');
const commitCmdFull = readFileSync(commitCmdPath, 'utf8');

const scopeBlock = (() => {
  const m = /<!-- SCOPE-RULES-START -->\s*```json\s*([\s\S]*?)```/.exec(commitCmdFull);
  return m ? JSON.parse(m[1]) : null;
})();
check(scopeBlock !== null, 'commit.md 含 SCOPE-RULES JSON 块');

const inferScope = (paths, rules) => {
  const generic = new Set(rules.generic_dirs ?? []);
  const hits = [];
  for (const p of paths) {
    const seg = p.split('/');
    let scope = null;
    for (const r of rules.builtin_rules ?? []) {
      if (!p.startsWith(r.prefix)) continue;
      if (r.scope.startsWith('<')) {
        const name = seg[1] ?? '';
        const minSeg = r.prefix === 'src/' ? 3 : 2;
        if (seg.length >= minSeg && name && !name.includes('.')) scope = name;
      } else {
        scope = r.scope;
      }
      break;
    }
    if (scope) hits.push(scope);
  }
  if (hits.length > 0) {
    const counts = new Map();
    for (const h of hits) counts.set(h, (counts.get(h) ?? 0) + 1);
    const max = Math.max(...counts.values());
    const winners = [...counts.entries()].filter(([, c]) => c === max);
    return winners.length === 1 ? winners[0][0] : null;
  }
  const tops = new Set(paths.map((p) => p.split('/')[0]));
  if (tops.size === 1 && !generic.has([...tops][0])) return [...tops][0];
  return null;
};

if (scopeBlock) {
  const scopeCases = JSON.parse(readFileSync(join(ROOT, 'tests/samples/scope-cases.json'), 'utf8'));
  for (const c of scopeCases.cases) {
    check(
      inferScope(c.paths, scopeBlock) === c.expected,
      `scope 推断 [${c.paths.join(', ')}] → ${c.expected}`,
      `实际 ${inferScope(c.paths, scopeBlock)}`,
    );
  }
}

// ---------- 7. step-commit commitlint 规则联动（SC-110-3） ----------
check(commitCmdFull.includes('commitlint.config'), 'commit.md 含 commitlint 配置查找说明');
check(commitCmdFull.includes('type-enum') && commitCmdFull.includes('header-max-length'), 'commit.md 含规则映射说明');

const { extractCommitlintRules } = await import('./lib/commitlint-rules.mjs');

const jsonRules = extractCommitlintRules(join(ROOT, 'tests/fixtures/commitlint/json-config'));
check(jsonRules.dynamic === false, 'commitlint JSON 配置静态解析', JSON.stringify(jsonRules));
check(
  JSON.stringify(jsonRules.rules?.typeEnum) === JSON.stringify(['feat', 'fix', 'docs']),
  'commitlint type-enum 提取',
  JSON.stringify(jsonRules.rules),
);
check(jsonRules.rules?.headerMaxLength === 72, 'commitlint header-max-length 提取');
check(
  JSON.stringify(jsonRules.rules?.scopeEnum) === JSON.stringify(['auth', 'api', 'cli']),
  'commitlint scope-enum 提取',
);

const dynamicRules = extractCommitlintRules(join(ROOT, 'tests/fixtures/commitlint/dynamic-config'));
check(dynamicRules.dynamic === true, 'commitlint JS 动态配置标记 dynamic');

const noneRules = extractCommitlintRules(join(ROOT, 'tests/fixtures/commitlint/none-config'));
check(noneRules.rules === null, 'commitlint 无配置回退 null');

// ---------- 8. step-commit /changelog 分类与 semver 建议（SC-120-1/2） ----------
check(existsSync(join(ROOT, 'plugins/step-commit/commands/changelog.md')), 'commands/changelog.md 存在');
const changelogCmd = readFileSync(join(ROOT, 'plugins/step-commit/commands/changelog.md'), 'utf8');
for (const needle of ['BREAKING CHANGE', 'git push --follow-tags', '必须征得用户明确确认']) {
  check(changelogCmd.includes(needle), `commands/changelog.md 含关键规则「${needle}」`);
}

const semverBlock = (() => {
  const m = /<!-- SEMVER-RULES-START -->\s*```json\s*([\s\S]*?)```/.exec(changelogCmd);
  return m ? JSON.parse(m[1]) : null;
})();
check(semverBlock !== null, 'changelog.md 含 SEMVER-RULES JSON 块');

const { parseCommit, suggestBump, bumpVersion, formatChangelog } = await import('./lib/semver-changelog.mjs');

check(
  semverBlock && semverBlock.bump_priority?.[0]?.when === 'breaking' && semverBlock.bump_priority?.[0]?.bump === 'major',
  'SEMVER 规则优先级：breaking → major',
);
check(
  semverBlock && semverBlock.bump_priority?.[1]?.when === 'feat' && semverBlock.bump_priority?.[1]?.bump === 'minor',
  'SEMVER 规则优先级：feat → minor',
);

const changeCases = JSON.parse(readFileSync(join(ROOT, 'tests/samples/changelog-cases.json'), 'utf8'));
for (const c of changeCases.bump_cases) {
  const parsed = c.commits.map((s) => parseCommit(s));
  check(suggestBump(parsed) === c.expected, `semver 建议 [${c.commits.join(' | ') || '空'}] → ${c.expected}`, `实际 ${suggestBump(parsed)}`);
}
check(bumpVersion('1.1.0', 'minor') === '1.2.0', '版本递增 minor');
check(bumpVersion('1.1.0', 'patch') === '1.1.1', '版本递增 patch');
check(bumpVersion('1.1.0', 'major') === '2.0.0', '版本递增 major');

for (const fc of changeCases.format_cases) {
  const parsed = fc.commits.map((c) => parseCommit(c.raw, c.body ?? ''));
  const actual = formatChangelog(fc.version, fc.date, parsed);
  check(actual === fc.expected.join('\n'), 'CHANGELOG 节格式化样例', `\n--- 期望 ---\n${fc.expected.join('\n')}\n--- 实际 ---\n${actual}`);
}

// ---------- 9. CHANGELOG 自举一致性（SC-120 / TG-100 验收，按插件通用） ----------
const checkBootstrapChangelog = (pluginId) => {
  if (!existsSync(join(ROOT, '.git'))) return;
  if (spawnSync(GIT_BIN, ['--version'], { cwd: ROOT }).status !== 0) return;
  const dir = join(ROOT, 'plugins', pluginId);
  const changelogPath = join(dir, 'CHANGELOG.md');
  if (!existsSync(changelogPath)) {
    console.log(`SKIP 自举一致性 ${pluginId}（CHANGELOG.md 尚未生成）`);
    return;
  }
  const gitOut = (args) => execFileSync(GIT_BIN, args, { cwd: ROOT, encoding: 'utf8' }).trim();
  const version = JSON.parse(readFileSync(join(dir, 'step.plugin.json'), 'utf8')).version;
  const tag = `${pluginId}-v${version}`;
  if (gitOut(['tag', '-l', tag]) !== '') {
    console.log(`SKIP 自举一致性 ${pluginId}（${tag} 已打 tag，条目已定稿）`);
    return;
  }
  const hasAnyTag = gitOut(['tag', '-l', `${pluginId}-v*`]) !== '';
  let raw;
  let date;
  if (hasAnyTag) {
    const lastTag = gitOut(['describe', '--tags', '--abbrev=0', '--match', `${pluginId}-v*`]);
    raw = execFileSync(GIT_BIN, ['log', `${lastTag}..HEAD`, '--pretty=%s%n%b%n---'], { cwd: ROOT, encoding: 'utf8' });
    date = gitOut(['log', '-1', '--pretty=%ad', '--date=short']);
  } else {
    // 首版本：取该插件目录的全部提交历史
    raw = execFileSync(GIT_BIN, ['log', '--pretty=%s%n%b%n---', '--', `plugins/${pluginId}`], { cwd: ROOT, encoding: 'utf8' });
    date = gitOut(['log', '-1', '--pretty=%ad', '--date=short', '--', `plugins/${pluginId}`]);
  }
  const commits = raw
    .split('\n---\n')
    .map((block) => block.split('\n'))
    .filter((parts) => parts[0]?.trim())
    .map((parts) => parseCommit(parts[0].trim(), parts.slice(1).join('\n')));
  const expected = formatChangelog(version, date, commits);
  const doc = readFileSync(changelogPath, 'utf8');
  const m = new RegExp(`## \\[${version}\\] - \\d{4}-\\d{2}-\\d{2}[\\s\\S]*?(?=\\n## \\[|\\s*$)`).exec(doc);
  check(m !== null, `CHANGELOG.md ${pluginId} 含 [${version}] 节`);
  if (m) {
    // 行尾归一化：windows 检出（core.autocrlf=true）会把文件转成 CRLF，与 git 历史生成的 LF 输出逐字符比对会假失败
    check(m[0].replace(/\r\n/g, '\n').trim() === expected.trim(), `CHANGELOG 自举一致 ${pluginId}（文件内容 = 库对 git 历史的输出）`, `\n--- 期望 ---\n${expected}\n--- 实际 ---\n${m[0]}`);
  }
};
checkBootstrapChangelog('step-commit');
checkBootstrapChangelog('step-test-guard');
checkBootstrapChangelog('step-context-archive');

// ---------- 10. step-commit monorepo 与 release PR（SC-130-1/2/3） ----------
check(changelogCmd.includes('pnpm-workspace.yaml'), 'commands/changelog.md 含 monorepo 检测说明');
const monorepoBlock = (() => {
  const m = /<!-- MONOREPO-RULES-START -->\s*```json\s*([\s\S]*?)```/.exec(changelogCmd);
  return m ? JSON.parse(m[1]) : null;
})();
check(monorepoBlock !== null, 'changelog.md 含 MONOREPO-RULES JSON 块');
check(monorepoBlock?.tag_style?.includes('<package短名>-vX.Y.Z'), 'MONOREPO 规则含 per-package tag 风格');

check(existsSync(join(ROOT, 'plugins/step-commit/commands/release-pr.md')), 'commands/release-pr.md 存在');
const releaseCmd = readFileSync(join(ROOT, 'plugins/step-commit/commands/release-pr.md'), 'utf8');
for (const needle of ['chore/release-v', 'chore(release): prepare', 'gh pr create', 'glab mr create', '禁止 force push', '每步先向用户确认']) {
  check(releaseCmd.includes(needle), `commands/release-pr.md 含关键规则「${needle}」`);
}
const releaseBlock = (() => {
  const m = /<!-- RELEASE-PR-RULES-START -->\s*```json\s*([\s\S]*?)```/.exec(releaseCmd);
  return m ? JSON.parse(m[1]) : null;
})();
check(releaseBlock?.remote?.github?.tool === 'gh' && releaseBlock?.remote?.gitlab?.tool === 'glab', 'RELEASE-PR 规则声明双平台工具');

for (const needle of ['glab --version', 'winget install GLab.GLab', 'glab auth login', '--target-branch', 'git remote get-url origin']) {
  check(cppCmd.includes(needle), `commands/commit-push-pr.md 含关键规则「${needle}」`);
}

const { detectMonorepo, groupPathsByPackage } = await import('./lib/monorepo.mjs');
const monoCases = JSON.parse(readFileSync(join(ROOT, 'tests/samples/monorepo-cases.json'), 'utf8'));

for (const c of monoCases.detect_cases) {
  const detected = detectMonorepo(join(ROOT, 'tests/fixtures', c.fixture));
  check(detected.isMonorepo === c.isMonorepo && detected.workspaceFile === c.workspaceFile, `monorepo 检测 ${c.fixture}`, JSON.stringify(detected));
  check(detected.packages.length >= c.packageCount, `monorepo ${c.fixture} 含 ${c.packageCount}+ package`, String(detected.packages.length));
  const names = detected.packages.map((p) => p.name);
  for (const n of c.names) check(names.includes(n), `monorepo ${c.fixture} 含 package ${n}`, JSON.stringify(names));
}

for (const c of monoCases.group_cases) {
  const grouped = groupPathsByPackage(c.paths, detectMonorepo(join(ROOT, 'tests/fixtures/monorepo-sample')).packages);
  check(
    JSON.stringify(grouped) === JSON.stringify(c.expected),
    `monorepo 归组 [${c.paths.join(', ')}]`,
    `\n期望 ${JSON.stringify(c.expected)}\n实际 ${JSON.stringify(grouped)}`,
  );
}

for (const c of monoCases.bump_cases) {
  const actual = Object.fromEntries(
    Object.entries(c.commits_by_package).map(([pkg, commits]) => [pkg, suggestBump(commits.map((s) => parseCommit(s)))]),
  );
  check(
    JSON.stringify(actual) === JSON.stringify(c.expected),
    `monorepo 按 package semver 建议`,
    `\n期望 ${JSON.stringify(c.expected)}\n实际 ${JSON.stringify(actual)}`,
  );
}

// ---------- 11. step-test-guard（TG-100） ----------
const tgTestCmd = readFileSync(join(ROOT, 'plugins/step-test-guard/commands/test.md'), 'utf8');
const tgSkill = readFileSync(join(ROOT, 'plugins/step-test-guard/skills/test-fix-loop/SKILL.md'), 'utf8');

const extractBlock = (text, marker) => {
  const m = new RegExp(`<!-- ${marker}-START -->\\s*\`\`\`json\\s*([\\s\\S]*?)\`\`\``).exec(text);
  return m ? JSON.parse(m[1]) : null;
};

const tgDetectBlock = extractBlock(tgTestCmd, 'TEST-DETECT');
check(tgDetectBlock !== null && Array.isArray(tgDetectBlock.detectors), 'test.md 含 TEST-DETECT JSON 块');
const tgPatterns = extractBlock(tgTestCmd, 'TEST-PATTERNS');
check(tgPatterns !== null && tgPatterns.vitest && tgPatterns.jest && tgPatterns.pytest, 'test.md 含 TEST-PATTERNS JSON 块');
const tgLoopBlock = extractBlock(tgSkill, 'LOOP-RULES');
check(tgLoopBlock !== null && tgLoopBlock.max_rounds === 3, 'SKILL.md 含 LOOP-RULES 且上限为 3 轮');

for (const needle of ['docs/test-guard/last-run.log', '以上全未命中时', '不删除、不禁用测试']) {
  check(tgTestCmd.includes(needle), `commands/test.md 含关键规则「${needle}」`);
}
for (const needle of ['断言失败', '环境问题', '真实回归', '最小改动', '全量重跑', 'escalate']) {
  check(tgSkill.includes(needle), `SKILL.md 含关键规则「${needle}」`);
}

const { detectStack } = await import('./lib/stack-detect.mjs');
const { parseTestOutput } = await import('./lib/test-parse.mjs');

const detectFixtures = [
  ['vitest-sample', 'vitest'],
  ['jest-sample', 'jest'],
  ['pytest-sample', 'pytest'],
  ['node-sample', 'node'],
  ['go-sample', 'go'],
  ['cargo-sample', 'cargo'],
  ['maven-sample', 'maven'],
  ['gradle-sample', 'gradle'],
];
for (const [fixture, stack] of detectFixtures) {
  const detected = detectStack(join(ROOT, 'tests/fixtures/test-projects', fixture), tgDetectBlock.detectors);
  check(detected?.stack === stack, `框架检测 ${fixture} → ${stack}`, JSON.stringify(detected));
}

const tgCases = JSON.parse(readFileSync(join(ROOT, 'tests/samples/test-output-cases.json'), 'utf8'));
for (const c of tgCases.cases) {
  const entries = parseTestOutput(c.stack, c.log, tgPatterns);
  check(entries.length === c.expected.length, `输出解析「${c.name}」条数`, `期望 ${c.expected.length}，实际 ${JSON.stringify(entries)}`);
  for (let i = 0; i < Math.min(entries.length, c.expected.length); i += 1) {
    const a = entries[i];
    const e = c.expected[i];
    check(a.file === e.file && a.case === e.case, `输出解析「${c.name}」#${i + 1} 定位`, JSON.stringify(a));
    if (e.expect !== undefined) check(a.expect === e.expect, `输出解析「${c.name}」#${i + 1} expect`, JSON.stringify(a));
    if (e.actual !== undefined) check(a.actual === e.actual, `输出解析「${c.name}」#${i + 1} actual`, JSON.stringify(a));
    if (e.detailContains !== undefined) check((a.detail ?? '').includes(e.detailContains), `输出解析「${c.name}」#${i + 1} detail`, JSON.stringify(a));
  }
}

// ---------- 12. step-test-guard 覆盖率解读（TG-110-2） ----------
check(tgTestCmd.includes('coverage-summary.json') && tgTestCmd.includes('cobertura.xml'), 'test.md 含覆盖率产物说明');
const covBlock = extractBlock(tgTestCmd, 'COVERAGE-RULES');
check(covBlock !== null && covBlock.default_threshold === 80, 'test.md 含 COVERAGE-RULES 且默认阈值 80');

const { readIstanbulSummary, readCobertura } = await import('./lib/coverage.mjs');
const istanbul = readIstanbulSummary(readFileSync(join(ROOT, 'tests/fixtures/coverage/istanbul-summary.json'), 'utf8'), covBlock.default_threshold);
check(istanbul.overallPct === 87.4, 'istanbul 整体覆盖率读取', JSON.stringify(istanbul));
check(
  JSON.stringify(istanbul.lowFiles) === JSON.stringify([{ file: 'src/api.ts', pct: 62 }]),
  'istanbul 低于阈值文件列表',
  JSON.stringify(istanbul.lowFiles),
);
const cobertura = readCobertura(readFileSync(join(ROOT, 'tests/fixtures/coverage/cobertura.xml'), 'utf8'), covBlock.default_threshold);
check(cobertura.overallPct === 86, 'cobertura 整体覆盖率读取', JSON.stringify(cobertura));
check(
  JSON.stringify(cobertura.lowFiles) === JSON.stringify([{ file: 'src/legacy.ts', pct: 55 }]),
  'cobertura 低于阈值文件列表',
  JSON.stringify(cobertura.lowFiles),
);

// ---------- 13. step-test-guard 失败用例缓存（TG-110-3） ----------
const cacheBlock = extractBlock(tgTestCmd, 'CACHE-RULES');
check(cacheBlock !== null && cacheBlock.cache_path === 'docs/test-guard/failed-cases.json', 'test.md 含 CACHE-RULES 且路径正确');
check(tgSkill.includes('failed-cases.json'), 'SKILL.md 引用失败用例缓存');

const { loadCache, saveCache, mergeCases, rangeMatches } = await import('./lib/fail-cache.mjs');
check(loadCache(cacheBlock ? JSON.stringify([{ stack: 'vitest', file: 'src/a.test.ts', case: 'x' }]) : null)?.length === 1, '缓存正常读取');
check(loadCache('{broken json') === null, '缓存损坏时容错返回 null');
check(loadCache('{"not":"array"}') === null, '缓存格式非数组时返回 null');

const merged = mergeCases(
  [{ stack: 'vitest', file: 'a.ts', case: 'x' }],
  [{ stack: 'vitest', file: 'a.ts', case: 'x' }, { stack: 'pytest', file: 't.py', case: 'y' }],
);
check(merged.length === 2, '缓存合并按 file+case 去重', JSON.stringify(merged));
check(rangeMatches([{ stack: 'vitest', file: 'a', case: 'x' }], 'vitest') === true, '缓存范围匹配');
check(rangeMatches([{ stack: 'vitest', file: 'a', case: 'x' }], 'go') === false, '缓存 stack 变化视为范围不符');
check(typeof saveCache([{ stack: 'go', file: 'a_test.go', case: 'TestSub' }]) === 'string', '缓存写出为 JSON 字符串');

// ---------- 14. step-test-guard 夜间守护与报告（TG-120-1/2） ----------
check(existsSync(join(ROOT, 'plugins/step-test-guard/commands/nightly-test.md')), 'commands/nightly-test.md 存在');
const nightlyCmd = readFileSync(join(ROOT, 'plugins/step-test-guard/commands/nightly-test.md'), 'utf8');
const nightlyBlock = extractBlock(nightlyCmd, 'NIGHTLY-RULES');
check(nightlyBlock !== null && nightlyBlock.report_path === 'docs/test-report.md', 'nightly-test.md 含 NIGHTLY-RULES 且报告路径正确');
check(nightlyBlock?.exit_semantics?.green === '0' && nightlyBlock?.exit_semantics?.has_failures === '1', '夜间任务退出码语义');
check(nightlyCmd.includes('AGENTS.md') && nightlyCmd.includes('优先于框架自动检测'), '夜间任务含 AGENTS.md 约定协作');
check(nightlyCmd.includes('禁止 git push'), '无头模式禁外向动作');

const reportBlock = extractBlock(nightlyCmd, 'REPORT-RULES');
check(reportBlock !== null && JSON.stringify(reportBlock.sections) === JSON.stringify(['摘要', '失败明细', '与上轮对比']), '报告节结构完整');

const { renderReport, diffFailures } = await import('./lib/report.mjs');
const reportCases = JSON.parse(readFileSync(join(ROOT, 'tests/samples/report-cases.json'), 'utf8'));
for (const c of reportCases.render_cases) {
  const md = renderReport(c.input);
  for (const needle of c.expectContains) check(md.includes(needle), `报告渲染「${c.name}」含「${needle}」`, md);
}
const d = diffFailures(
  [{ file: 'a', case: '1' }, { file: 'b', case: '2' }],
  [{ file: 'b', case: '2' }, { file: 'c', case: '3' }],
);
check(d.added.length === 1 && d.resolved.length === 1 && d.kept.length === 1, '失败集对比三分类', JSON.stringify(d));

// ---------- 15. step-test-guard bisect 与 flaky（TG-130-1/2） ----------
check(existsSync(join(ROOT, 'plugins/step-test-guard/commands/bisect.md')), 'commands/bisect.md 存在');
const bisectCmd = readFileSync(join(ROOT, 'plugins/step-test-guard/commands/bisect.md'), 'utf8');
const bisectBlock = extractBlock(bisectCmd, 'BISECT-RULES');
check(bisectBlock !== null && bisectBlock.finish?.includes('git bisect reset'), 'bisect.md 含 BISECT-RULES 且规定 reset');
for (const needle of ['git status', '转人工确认', '不自动 revert', 'token 经济', '125']) {
  check(bisectCmd.includes(needle), `commands/bisect.md 含关键规则「${needle}」`);
}

check(existsSync(join(ROOT, 'plugins/step-test-guard/commands/flaky.md')), 'commands/flaky.md 存在');
const flakyCmd = readFileSync(join(ROOT, 'plugins/step-test-guard/commands/flaky.md'), 'utf8');
const flakyBlock = extractBlock(flakyCmd, 'FLAKY-RULES');
check(flakyBlock !== null && flakyBlock.default_runs === 10, 'flaky.md 含 FLAKY-RULES 且默认 10 轮');
for (const needle of ['stable-pass', 'flaky', 'stable-fail', '用户确认', 'pytest-rerunfailures']) {
  check(flakyCmd.includes(needle), `commands/flaky.md 含关键规则「${needle}」`);
}

const { analyzeFlaky, recommendedAction } = await import('./lib/flaky.mjs');
check(analyzeFlaky([true, false, true, false, true, false, true, false, true, false]).verdict === 'flaky', 'flaky 判定：间歇失败');
check(analyzeFlaky([true, true, true, false]).verdict === 'flaky', 'flaky 判定：低频失败');
check(analyzeFlaky([false, false, false]).verdict === 'stable-fail', 'flaky 判定：全失败为稳定失败');
check(analyzeFlaky([]).verdict === 'invalid', 'flaky 判定：空数据无效');
check(recommendedAction('stable-fail').includes('test-fix-loop'), 'stable-fail 建议转修复闭环');
check(recommendedAction('flaky').includes('用户确认'), 'flaky 隔离动作需用户确认');

// ---------- 16. step-token-meter 用量统计（TM-100） ----------
check(existsSync(join(ROOT, 'plugins/step-token-meter/docs/storage-format.md')), 'step-token-meter 存储格式文档存在');
const usageCmd = readFileSync(join(ROOT, 'plugins/step-token-meter/commands/usage.md'), 'utf8');
for (const needle of ['零网络', 'docs/storage-format.md', '--csv', '容错解析', '成本为按公开单价的粗估']) {
  check(usageCmd.includes(needle), `commands/usage.md 含关键规则「${needle}」`);
}
const usagePrice = extractBlock(usageCmd, 'PRICE-RULES');
check(usagePrice !== null && usagePrice.default?.input === 15, 'usage.md 含 PRICE-RULES 默认单价表');

const { parseSessionText, aggregate, toCsv, costOf, loadPrices } = await import('./lib/usage.mjs');
const usageSamples = JSON.parse(readFileSync(join(ROOT, 'tests/samples/usage-samples.json'), 'utf8'));
const { records, warnings } = parseSessionText(usageSamples.lines.join('\n'));
check(records.length === usageSamples.expect.recordCount, '容错解析：有效记录数', String(records.length));
check(warnings.length === usageSamples.expect.warningCount, '容错解析：损坏行警告计数', JSON.stringify(warnings));
const agg = aggregate(records);
for (const [day, m] of Object.entries(usageSamples.expect.byDay)) {
  check(agg.byDay[day]?.total === m.total, `按日聚合 ${day} total=${m.total}`, JSON.stringify(agg.byDay[day]));
}
check(agg.byModel && Object.values(agg.byModel)[0].model === usageSamples.expect.byModelTop.model, '按模型聚合排序首位');
check(Object.values(agg.byModel)[0].total === usageSamples.expect.byModelTop.total, '按模型聚合首位总量');
const csv = toCsv(records, usagePrice);
check(csv.startsWith(usageSamples.expect.csvHeader), 'CSV 表头');
check(csv.trim().split('\n').length === usageSamples.expect.csvRowCount + 1, 'CSV 行数');
const glmCost = costOf(records[0], usagePrice);
check(Math.abs(glmCost.cost - (1000 * 2 + 500 * 8 + 200 * 0.2 + 100 * 2) / 1e6) < 1e-9, 'glm-4.7 成本计算', String(glmCost.cost));
const mysteryCost = costOf(records[3], usagePrice);
check(mysteryCost.usedDefault && mysteryCost.cost > 0, '未知模型回退 default 单价');
check(loadPrices(usagePrice, { models: { 'glm-4.7': { input: 1 } } }).models['glm-4.7'].input === 1, '单价覆盖合并');

// ---------- 16b. step-token-meter MCP server（TM-110） ----------
{
  const tmDir = join(ROOT, 'plugins/step-token-meter');
  const tmManifest = JSON.parse(readFileSync(join(tmDir, 'step.plugin.json'), 'utf8'));
  check(tmManifest.mcpServers?.['step-token-meter']?.command === 'node', 'manifest 注册 mcpServers（node 启动）');
  check(existsSync(join(tmDir, 'server/index.mjs')) && existsSync(join(tmDir, 'server/lib.mjs')), 'server 代码存在');
  check(existsSync(join(tmDir, 'config/prices.example.json')), '单价覆盖样例存在');

  const sessionFixture = join(ROOT, 'tests/fixtures/stepcode-projects');
  const mcpInput = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_usage', arguments: { range: 'all' } } }),
    JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_usage_by_model', arguments: { range: 'all' } } }),
    JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope', arguments: {} } }),
    '',
  ].join('\n');

  const mkPrices = (glmInputRate) =>
    JSON.stringify({ default: { input: 15, output: 75, cache_read: 0, cache_write: 0 }, models: { 'glm-4.7': { input: glmInputRate, output: 8, cache_read: 0.2, cache_write: 2 } } });
  const pricesPath = join(ROOT, 'tests/fixtures/tm-prices.json');

  const runServer = () => {
    const r = spawnSync(process.execPath, [join(tmDir, 'server/index.mjs')], {
      input: mcpInput,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, STEP_TOKEN_METER_DIR: sessionFixture, STEP_TOKEN_METER_PRICES: pricesPath },
    });
    if (r.status !== 0) throw new Error(`server 退出 ${r.status}: ${r.stderr}`);
    return (r.stdout + '\n').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  };

  try {
    writeFileSync(pricesPath, mkPrices(2));
    const msgs = runServer();
    const init = msgs.find((m) => m.id === 1);
    check(init?.result?.serverInfo?.name === 'step-token-meter', 'MCP initialize 握手', JSON.stringify(init));
    const tools = msgs.find((m) => m.id === 2);
    check(
      JSON.stringify(tools?.result?.tools?.map((t) => t.name)) === JSON.stringify(['get_usage', 'get_usage_by_model']),
      'MCP tools/list',
      JSON.stringify(tools?.result?.tools?.map((t) => t.name)),
    );
    const usage = msgs.find((m) => m.id === 3);
    const structured = usage?.result?.structuredContent;
    check(structured?.grandTotal === 7800, 'get_usage 汇总数', JSON.stringify(structured?.grandTotal));
    check(structured?.days?.length === 2, 'get_usage 按日条数', JSON.stringify(structured?.days?.length));
    const byModel = msgs.find((m) => m.id === 4);
    const bm = byModel?.result?.structuredContent;
    check(bm?.models?.[0]?.model === 'glm-4.7' && bm?.models?.[0]?.total === 5000, 'get_usage_by_model 排序首位', JSON.stringify(bm?.models?.[0]));
    check(msgs.find((m) => m.id === 5)?.error?.code === -32602, '未知工具返回 -32602');

    // 热加载：改写单价文件（mtime 变化）后新调用生效
    writeFileSync(pricesPath, mkPrices(20));
    const msgs2 = runServer();
    const usage2 = msgs2.find((m) => m.id === 3)?.result?.structuredContent;
    check(usage2?.grandTotal === 7800 && usage2?.days?.length === 2, '热加载后再次调用正常', JSON.stringify(usage2?.days));
    check(usage2?.days?.[0]?.cost !== structured?.days?.[0]?.cost, '单价表热加载生效（成本变化）', `${structured?.days?.[0]?.cost} -> ${usage2?.days?.[0]?.cost}`);
  } catch (e) {
    bad('MCP server 冒烟', e.message);
  } finally {
    rmSync(pricesPath, { force: true });
  }
}

// ---------- 17. step-token-meter 可视化（TM-120） ----------
const htmlBlock = extractBlock(usageCmd, 'HTML-RULES');
check(htmlBlock !== null && htmlBlock.no_external?.includes('零外部资源'), 'usage.md 含 HTML-RULES（零外部资源）');
const weeklyBlock = extractBlock(usageCmd, 'WEEKLY-RULES');
check(weeklyBlock !== null && weeklyBlock.outputs?.html === 'docs/usage-report/usage-weekly.html', 'usage.md 含 WEEKLY-RULES 周报落盘');
check(weeklyBlock?.cadence?.includes('/cron'), '周报接入 /cron');

const { renderHtmlReport } = await import('./lib/report-html.mjs');
const html = renderHtmlReport({ generatedAt: '2026-09-27T08:00:00Z', byDay: agg.byDay, byProject: agg.byProject, byModel: agg.byModel });
check(!/(src|href)\s*=|@import|url\(/i.test(html.replace(/xmlns="[^"]*"/g, '')), 'HTML 零外部资源（无 src/href/import 引用）');
check((html.match(/<svg /g) ?? []).length === 3, '三组内联 SVG 图表', String((html.match(/<svg /g) ?? []).length));
check(html.includes('#0d1117') && html.includes('lang="zh-CN"'), '暗色主题与中文页面');
check(html.includes('>2026-09-26<') && html.includes('>glm-4.7<'), '图表含日与模型标签');

// ---------- 18. step-token-meter 预算/合并/迁移（TM-130） ----------
const budgetBlock = extractBlock(usageCmd, 'BUDGET-RULES');
check(budgetBlock !== null && budgetBlock.rule?.includes('exceed'), 'usage.md 含 BUDGET-RULES');
const mergeBlock = extractBlock(usageCmd, 'MERGE-RULES');
check(mergeBlock !== null && mergeBlock.rule?.includes('本机单价表重算'), 'usage.md 含 MERGE-RULES');
check(usageCmd.includes('SCHEMA_PARSERS') && usageCmd.includes('unknown-schema'), 'usage.md 含 schema migration 说明');

const { checkBudget, mergeCsvs, parseSessionVersioned, parseSessionText: parseTextV } = await import('./lib/usage.mjs');
check(checkBudget(50, { monthly_cost: 100 }).status === 'ok', '预算 ok');
check(checkBudget(85, { monthly_cost: 100, warn_at: 0.8 }).status === 'warn', '预算 warn');
check(checkBudget(120, { monthly_cost: 100 }).status === 'exceed', '预算 exceed');
check(checkBudget(120, null).status === 'unset', '未配置预算静默');

const csvA = 'day,project,model,input,output,cache_read,cache_write,total,cost\n2026-09-26,E:/a,glm-4.7,1000,500,0,0,1500,0\n';
const csvB = 'day,project,model,input,output,cache_read,cache_write,total,cost\n2026-09-26,E:/a,glm-4.7,2000,300,0,0,2300,0\n2026-09-27,E:/b,glm-4.6,10,5,0,0,15,0\n';
const mergedCsv = mergeCsvs([csvA, csvB], usagePrice);
check(mergedCsv.split('\n')[1].startsWith('2026-09-26,E:/a,glm-4.7,3000,800,0,0,3800'), '多机合并按维度求和', mergedCsv.split('\n')[1]);
check(mergedCsv.includes('2026-09-27,E:/b,glm-4.6,10,5,0,0,15'), '多机合并保留独立维度');

const v2 = parseSessionVersioned('{"v":2,"ts":"2026-09-27T01:00:00Z","model":"glm-4.7","proj":"E:/v2","tokens":{"in":100,"out":50,"cacheR":10,"cacheW":5}}');
check(v2.ok && v2.record.total === 165 && v2.record.project === 'E:/v2', 'v2 格式解析', JSON.stringify(v2.record));
const unknown = parseSessionVersioned('{"v":99,"foo":1}');
check(unknown.ok === false || (unknown.warnings ?? []).some((w) => w.startsWith('unknown-schema:99')), '未知 schema 回退并警告', JSON.stringify(unknown.warnings ?? unknown));
const mixed = parseTextV('{"v":2,"ts":"2026-09-27T01:00:00Z","model":"m","proj":"p","tokens":{"in":1,"out":2}}\n{"timestamp":"2026-09-27T02:00:00Z","message":{"model":"m","usage":{"input_tokens":3,"output_tokens":4}}}');
check(mixed.records.length === 2 && mixed.records[1].total === 7, 'v1/v2 混合解析', JSON.stringify(mixed));

// ---------- 19. step-docker-mate（DM-100） ----------
{
  const dmDir = join(ROOT, 'plugins/step-docker-mate');
  const dmSkill = readFileSync(join(dmDir, 'skills/docker-ops/SKILL.md'), 'utf8');
  const dmDanger = extractBlock(dmSkill, 'DANGEROUS-OPS');
  check(dmDanger !== null && dmDanger.rule?.includes('绝不静默执行'), 'SKILL.md 含 DANGEROUS-OPS 确认红线');
  check(dmSkill.includes('ExitCode 137') && dmSkill.includes('port is already allocated') && dmSkill.includes('permission denied'), 'SKILL.md 含崩溃模式库（OOM/端口/权限）');

  const fake = join(ROOT, 'tests/fixtures/docker-fake/fake-docker.mjs');
  const marker = join(ROOT, 'tests/fixtures/docker-fake/down-marker.tmp');
  rmSync(marker, { force: true });
  const mkEnv = (extra) => ({ ...process.env, DOCKER_MATE_FAKE: fake, DOCKER_MATE_DOWN_MARKER: marker, ...extra });
  const runMcp = (calls, env) => {
    const r = spawnSync(process.execPath, [join(dmDir, 'server/index.mjs')], {
      input: calls.join('\n') + '\n',
      encoding: 'utf8',
      timeout: 30000,
      env,
    });
    if (r.status !== 0) throw new Error(`server 退出 ${r.status}: ${r.stderr.slice(0, 300)}`);
    return (r.stdout + '\n').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  };
  const call = (id, name, args) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args ?? {} } });
  const baseEnv = mkEnv({});

  try {
    const msgs = runMcp(
      [
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
        call(2, 'docker_ps'),
        call(3, 'docker_inspect', { container: 'demo-web' }),
        call(4, 'docker_logs', { container: 'demo-web', tail: 200 }),
        call(5, 'compose_up', { file: 'compose.yaml' }),
        call(6, 'compose_down', { file: 'compose.yaml' }),
        call(8, 'compose_ls'),
        call(9, 'image_layers', { image: 'demo/web:latest' }),
        '',
      ],
      baseEnv,
    );
    check(msgs.find((m) => m.id === 1)?.result?.serverInfo?.name === 'step-docker-mate', 'docker-mate MCP 握手');
    const psC = msgs.find((m) => m.id === 2)?.result?.structuredContent;
    check(psC?.containers?.length === 3 && psC.containers[0].state === 'exited', 'docker_ps 三容器', JSON.stringify(psC?.containers?.length));
    const ins = msgs.find((m) => m.id === 3)?.result?.structuredContent;
    check(ins?.state?.ExitCode === 137 && ins?.state?.OOMKilled === true, 'docker_inspect OOM 定位', JSON.stringify(ins?.state));
    const lg = msgs.find((m) => m.id === 4)?.result?.structuredContent;
    check(lg?.lines?.length === 200 && lg.lines.at(-1).includes('heap out of memory'), 'docker_logs 尾部截断含 FATAL', String(lg?.lines?.length));
    check(msgs.find((m) => m.id === 5)?.result?.structuredContent?.started === true, 'compose_up 启动');
    const dry = msgs.find((m) => m.id === 6)?.result?.structuredContent;
    check(dry?.dryRun === true && dry?.affected?.length === 3, 'compose_down dry-run 列出 3 资源', JSON.stringify(dry));
    check(msgs.find((m) => m.id === 8)?.result?.structuredContent?.projects?.[0]?.name === 'demo-app', 'compose_ls 项目列表');
    check(msgs.find((m) => m.id === 9)?.result?.structuredContent?.biggest?.[0]?.size === '320MB', '镜像层最大层识别');
    check(!existsSync(marker), 'G3：dry-run 未实际执行 down');

    // C-05：容器/镜像名白名单（拒绝 flag 混淆），且不触达 docker
    const invalidNames = runMcp(
      [
        call(1, 'docker_inspect', { container: '--help' }),
        call(2, 'docker_logs', { container: '-x' }),
        call(3, 'image_layers', { image: '--help' }),
        '',
      ],
      baseEnv,
    );
    check(invalidNames.find((m) => m.id === 1)?.result?.structuredContent?.error === 'invalid-identifier', 'C-05：docker_inspect 拒绝以 - 开头的容器名');
    check(invalidNames.find((m) => m.id === 2)?.result?.structuredContent?.error === 'invalid-identifier', 'C-05：docker_logs 拒绝非法容器名');
    check(invalidNames.find((m) => m.id === 3)?.result?.structuredContent?.error === 'invalid-identifier', 'C-05：image_layers 拒绝非法镜像引用');

    const msgs2 = runMcp([call(1, 'compose_down', { file: 'compose.yaml', confirm: true }), ''], baseEnv);
    check(msgs2.find((m) => m.id === 1)?.result?.structuredContent?.removed === true, 'compose_down 确认后执行');
    check(existsSync(marker), 'G3：确认后 down 真实执行（fake 标记）');

    const bad = runMcp([call(1, 'docker_ps'), ''], mkEnv({ DOCKER_MATE_FAKE: '', DOCKER_MATE_BIN: 'no-such-docker-bin-xyz' }));
    const fail = bad.find((m) => m.id === 1)?.result;
    check(fail?.isError === true && fail?.content?.[0]?.text?.includes('winget install Docker'), 'G4：docker 缺失输出安装指引');
  } catch (e) {
    bad('docker-mate 冒烟', e.message);
  } finally {
    rmSync(marker, { force: true });
  }
}

// ---------- 19b. docker-mate 诊断增强与远程（DM-110/DM-130） ----------
{
  const dmDir = join(ROOT, 'plugins/step-docker-mate');
  const fake = join(ROOT, 'tests/fixtures/docker-fake/fake-docker.mjs');
  const mkEnv = (extra) => ({ ...process.env, DOCKER_MATE_FAKE: fake, ...extra });
  const runMcp = (calls, env) => {
    const r = spawnSync(process.execPath, [join(dmDir, 'server/index.mjs')], {
      input: calls.join('\n') + '\n', encoding: 'utf8', timeout: 30000, env,
    });
    if (r.status !== 0) throw new Error(`server 退出 ${r.status}: ${r.stderr.slice(0, 300)}`);
    return (r.stdout + '\n').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  };
  const call = (id, name, args) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args ?? {} } });
  const sc = (msgs, id) => msgs.find((m) => m.id === id)?.result?.structuredContent;

  try {
    const msgs = runMcp(
      [
        call(1, 'diagnose', { container: 'demo-web' }),
        call(2, 'diagnose', { container: 'demo-rel' }),
        call(3, 'diagnose', { container: 'demo-vol' }),
        call(4, 'docker_events', { since: '10m' }),
        '',
      ],
      mkEnv({}),
    );
    check(sc(msgs, 1)?.pattern === 'oom', '诊断：OOM 归因', JSON.stringify(sc(msgs, 1)));
    check(sc(msgs, 2)?.pattern === 'dependency-not-ready', '诊断：依赖未就绪归因', JSON.stringify(sc(msgs, 2)));
    check(sc(msgs, 3)?.pattern === 'volume-permission', '诊断：卷权限归因', JSON.stringify(sc(msgs, 3)));
    const ev = sc(msgs, 4)?.events ?? [];
    check(ev.length === 3 && ev.some((e) => e.action === 'oom' && e.actor === 'demo-web'), 'events 巡检过滤 die/oom/kill', JSON.stringify(ev));

    const { matchCrashPattern } = await import('../plugins/step-docker-mate/server/lib.mjs');
    check(
      matchCrashPattern({ ExitCode: 0, Status: 'running', OOMKilled: false }, [], 'Error: port is already allocated').id === 'port-conflict',
      '诊断：端口冲突归因（lib 级）',
    );

    const remote = runMcp([call(1, 'docker_ps'), ''], mkEnv({ DOCKER_MATE_CONTEXT: 'remote-host' }));
    check(sc(remote, 1)?.containers?.length === 3, '远程 context（DOCKER_MATE_CONTEXT）透传可用');
  } catch (e) {
    bad('docker-mate v1.1/v1.3 冒烟', e.message);
  }
}

// ---------- 19c. docker-mate 瘦身（DM-120） ----------
{
  const fake = join(ROOT, 'tests/fixtures/docker-fake/fake-docker.mjs');
  const runMcp2 = (calls, env) => {
    const r = spawnSync(process.execPath, [join(ROOT, 'plugins/step-docker-mate/server/index.mjs')], {
      input: calls.join('\n') + '\n', encoding: 'utf8', timeout: 30000, env,
    });
    if (r.status !== 0) throw new Error(`server 退出 ${r.status}: ${r.stderr.slice(0, 300)}`);
    return (r.stdout + '\n').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  };
  try {
    const msgs = runMcp2(
      [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'slimming_plan', arguments: { image: 'demo/web:latest' } } }), ''],
      { ...process.env, DOCKER_MATE_FAKE: fake },
    );
    const plan = msgs.find((m) => m.id === 1)?.result?.structuredContent;
    check(plan?.suggestions?.length >= 2, '瘦身方案覆盖 node_modules 与 apt 层', JSON.stringify(plan?.suggestions?.length));
    check(plan?.estSavingPct > 30, `瘦身预估 >30%（实际 ${plan?.estSavingPct}%）`, String(plan?.estSavingPct));
    const ls = runMcp2([JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'compose_ls', arguments: {} } }), ''], { ...process.env, DOCKER_MATE_FAKE: fake });
    check(ls.find((m) => m.id === 1)?.result?.structuredContent?.projects?.length === 1, '多 compose 项目列表');
  } catch (e) {
    bad('docker-mate v1.2 冒烟', e.message);
  }
}

// ---------- 19d. docker-mate 健康日报（DM-130） ----------
const healthCmd = readFileSync(join(ROOT, 'plugins/step-docker-mate/commands/docker-health.md'), 'utf8');
const healthBlock = extractBlock(healthCmd, 'HEALTH-RULES');
check(healthBlock !== null && healthBlock.report === 'docs/docker-health.md' && healthBlock.exit_semantics?.docker_unavailable === '2', 'docker-health.md 含 HEALTH-RULES');
check(healthBlock?.readonly?.includes('一律禁止'), '日报模式禁危险操作');
check(healthCmd.includes('DOCKER_MATE_CONTEXT'), '日报支持远程 context');

// ---------- 20. step-ci-fixer（CF-100） ----------
{
  const cfDir = join(ROOT, 'plugins/step-ci-fixer');
  const cfManifest = JSON.parse(readFileSync(join(cfDir, 'step.plugin.json'), 'utf8'));
  check(cfManifest.provision?.requiresEnv?.includes('GITHUB_TOKEN'), 'manifest 声明 provision.requiresEnv GITHUB_TOKEN（CF-100-4）');
  const cfCmd = readFileSync(join(cfDir, 'commands/ci-fix.md'), 'utf8');
  check(cfCmd.includes('push 前必须向用户确认') && cfCmd.includes('上限 3 轮'), 'ci-fix.md 含 G3 确认与 3 轮上限');

  const fake = join(ROOT, 'tests/fixtures/gh-fake/fake-gh.mjs');
  const runMcp3 = (calls, env) => {
    const r = spawnSync(process.execPath, [join(cfDir, 'server/index.mjs')], {
      input: calls.join('\n') + '\n', encoding: 'utf8', timeout: 30000, env,
    });
    if (r.status !== 0) throw new Error(`server 退出 ${r.status}: ${r.stderr.slice(0, 300)}`);
    return (r.stdout + '\n').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  };
  const call3 = (id, name, args) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args ?? {} } });
  const sc3 = (msgs, id) => msgs.find((m) => m.id === id)?.result?.structuredContent;
  const goodEnv = { ...process.env, GH_FIXER_FAKE: fake, GH_FIXER_AUTH_MODE: '' };
  const { classifyFailure: classifyCore } = await import('../plugins/step-ci-fixer/server/lib.mjs');

  try {
    const msgs = runMcp3(
      [
        call3(1, 'check_gh'),
        call3(2, 'list_failed_runs'),
        call3(3, 'list_failed_runs', { workflow: 'deploy' }),
        call3(4, 'fetch_run_log', { runId: 9001, maxBytes: 16 * 1024 }),
        call3(5, 'classify_failure', { text: 'eslint --fix failed with 3 errors (ES2101)' }),
        call3(6, 'rerun_workflow', { runId: 9001 }),
        call3(7, 'run_status', { runId: 9001 }),
        call3(8, 'fetch_pr_comments', { prNumber: 42 }),
        call3(9, 'list_failed_runs', { workflow: '--evil' }),
        call3(10, 'fetch_run_log', { runId: '9001; rm -rf /' }),
        '',
      ],
      goodEnv,
    );
    check(sc3(msgs, 1)?.available === true, 'check_gh 正常认证');
    check(sc3(msgs, 2)?.runs?.length === 2, 'list_failed_runs 两条失败 run');
    check(sc3(msgs, 3)?.runs?.every((r) => r.workflowName === 'deploy'), 'workflow 选择器过滤');
    const log = sc3(msgs, 4);
    check(log?.truncated === true && log?.bytes === 16 * 1024 && log?.text.includes('exit code 1'), 'fetch_run_log 尾部 16KB 截断', JSON.stringify({ bytes: log?.bytes }));
    check(sc3(msgs, 5)?.kind === 'lint', '失败分类：lint');
    check(sc3(msgs, 6)?.rerun === true, 'rerun_workflow 触发');
    check(sc3(msgs, 7)?.conclusion === 'failure', 'run_status 查询');
    check(sc3(msgs, 8)?.comments?.length === 2, 'PR 评论读取');
    check(sc3(msgs, 9)?.error === 'invalid-argument', 'C-05：list_failed_runs 拒绝以 - 开头的 workflow');
    check(sc3(msgs, 10)?.error === 'invalid-argument', 'C-05：fetch_run_log 拒绝非整数 runId');

    check(classifyCore('error TS2304: Cannot find name "x"') === 'build', '失败分类：build');
    check(classifyCore('npm publish 403 Forbidden deploy') === 'deploy', '失败分类：deploy');
    check(classifyCore('random output') === 'unknown', '失败分类：unknown');

    const miss = runMcp3([call3(1, 'check_gh'), ''], { ...process.env, GH_FIXER_FAKE: '', GH_FIXER_BIN: 'no-such-gh-bin-xyz' });
    check(miss.find((m) => m.id === 1)?.result?.content?.[0]?.text?.includes('winget install GitHub.cli'), 'G4：gh 缺失安装指引');
    const noauth = runMcp3([call3(1, 'check_gh'), ''], { ...process.env, GH_FIXER_FAKE: fake, GH_FIXER_AUTH_MODE: 'none' });
    check(noauth.find((m) => m.id === 1)?.result?.content?.[0]?.text?.includes('gh auth login'), 'C4：未认证输出登录指引');
  } catch (e) {
    bad('ci-fixer 冒烟', e.message);
  }
}

// ---------- 21. ci-fixer 多平台日志适配（CF-130） ----------
{
  const { parseGitlabLog, parseJenkinsLog } = await import('./lib/ci-log.mjs');
  const gl = parseGitlabLog(readFileSync(join(ROOT, 'tests/fixtures/ci-logs/gitlab.txt'), 'utf8'));
  check(gl.platform === 'gitlab' && gl.classification === 'test', 'GitLab 日志解析与分类', JSON.stringify({ c: gl.classification }));
  check(gl.errorTail.includes('ECONNREFUSED'), 'GitLab 错误段含连接被拒', gl.errorTail);
  const jk = parseJenkinsLog(readFileSync(join(ROOT, 'tests/fixtures/ci-logs/jenkins.txt'), 'utf8'));
  check(jk.buildFailure === true && jk.failedStages.includes('Test'), 'Jenkins 失败 stage 定位', JSON.stringify(jk.failedStages));
  check(jk.classification === 'test' && jk.errorTail.includes('Expected: 3'), 'Jenkins 错误段与分类', jk.classification);
}

// ---------- 22. step-fe-kit（FK-100） ----------
{
  const fkDir = join(ROOT, 'plugins/step-fe-kit');
  const devCmd = readFileSync(join(fkDir, 'commands/dev.md'), 'utf8');
  const pubCmd = readFileSync(join(fkDir, 'commands/publish.md'), 'utf8');
  const devDetect = extractBlock(devCmd, 'DEV-DETECT');
  check(devDetect !== null && devDetect.detectors?.some((d) => d.dep === 'vite'), 'dev.md 含框架检测规则');
  const devLogRules = extractBlock(devCmd, 'DEV-LOG-RULES');
  check(devLogRules?.vite?.ready && devLogRules?.next?.ready, 'dev.md 含 vite/next 就绪解析规则');
  check(devCmd.includes('杀进程前必须确认') && devCmd.includes('start /b'), 'dev.md 含 G3 与 Windows 后台启动（C6）');
  check(pubCmd.includes('/plugin install steppage') && pubCmd.includes('外向动作'), 'publish.md 含 steppage 降级指引与 G3');

  const { parseDevLog } = await import('./lib/dev-log.mjs');
  const viteLog = '  VITE v6.0.0  ready in 432 ms\n  ➜  Local:   http://localhost:5173/';
  check(parseDevLog('vite', viteLog, devLogRules).port === 5173, 'vite 就绪与端口解析');
  const nextLog = '  ▲ Next.js 15\n  - Local:        http://localhost:3000\n  ✓ Ready in 1.2s';
  check(parseDevLog('next', nextLog, devLogRules).port === 3000, 'next 就绪与端口解析');
  check(parseDevLog('vite', 'error: listen EADDRINUSE: address already in use 0.0.0.0:5173', devLogRules).error === 'EADDRINUSE', '端口占用错误识别');
  check(parseDevLog('next', '✗ Failed to compile', devLogRules).error === 'Failed to compile', 'next 编译错误识别');
}

// ---------- 23. fe-kit 视觉验证（FK-110/120） ----------
{
  const fkSkill = readFileSync(join(ROOT, 'plugins/step-fe-kit/skills/fe-visual/SKILL.md'), 'utf8');
  const visualRules = extractBlock(fkSkill, 'VISUAL-RULES');
  check(visualRules !== null && visualRules.c5?.includes('不内联 base64'), 'fe-visual 含 VISUAL-RULES 与 C5 约定');
  check(fkSkill.includes('/plugin install playwright'), 'playwright 缺失降级指引');
  const svBlock = extractBlock(fkSkill, 'SELECTOR-VIEWPORTS');
  check(JSON.stringify(svBlock?.viewports) === JSON.stringify([375, 768, 1440]), '多视口定义 375/768/1440');

  const { renderVisualReport, viewportBatch } = await import('./lib/visual-report.mjs');
  const report = renderVisualReport({
    page: '/home',
    viewports: [{ width: 375, height: 720, before: 'docs/fe-visual/before-375.png', after: 'docs/fe-visual/after-375.png', diff: '按钮换行' }],
    consoleErrors: ['Uncaught TypeError: x is not a function'],
    responsiveIssues: ['375 视口横向溢出'],
    conclusion: '响应式问题已暴露',
  });
  check(report.includes('docs/fe-visual/before-375.png') && report.includes('Uncaught TypeError'), '报告含截图路径与控制台错误');
  const batch = viewportBatch('/home');
  check(batch.map((b) => b.width).join(',') === '375,768,1440' && batch[0].path.includes('375'), '多视口批量计划生成');
  check(viewportBatch('/home', [375], '.btn')[0].selector === '.btn', 'selector 组件级截图参数');
}

// ---------- 24. fe-kit 性能与联动（FK-130） ----------
{
  const fkSkill = readFileSync(join(ROOT, 'plugins/step-fe-kit/skills/fe-visual/SKILL.md'), 'utf8');
  const perfBlock = extractBlock(fkSkill, 'PERF-RULES');
  check(perfBlock !== null && perfBlock.parse?.includes('500kB'), 'fe-visual 含 PERF-RULES');
  const mockBlock = extractBlock(fkSkill, 'MOCK-E2E');
  check(mockBlock !== null && mockBlock.degrade?.includes('api-forge 未安装时降级'), 'fe-visual 含 MOCK-E2E 联动与降级');
  const { parseViteBuild } = await import('./lib/perf-hints.mjs');
  const build = parseViteBuild('dist/assets/index-abc.js   612.45 kB │ gzip: 190.2 kB\ndist/assets/index.css   33.20 kB\ndist/assets/chunk-vendor.js  280.11 kB');
  check(build.assets.length === 3 && build.assets[0].sizeKB === 612.45, 'vite 构建产物解析');
  check(build.warnings.some((w) => w.includes('612.45') && w.includes('代码分割')), '超大 chunk 告警');
  check(build.warnings.some((w) => w.includes('280.11')), '偏大 chunk 提示');
}

// ---------- 25. step-sec-scan（SS-100 + SS-120 + SS-130） ----------
{
  const ssDir = join(ROOT, 'plugins/step-sec-scan');
  const ssSkill = readFileSync(join(ssDir, 'skills/sec-audit/SKILL.md'), 'utf8');
  const noiseBlock = extractBlock(ssSkill, 'SEC-NOISE');
  check(noiseBlock !== null && noiseBlock.rule?.includes('降级为 low'), 'sec-audit 含 SEC-NOISE 降噪规则');
  check(ssSkill.includes('pre-commit'), 'sec-audit 含 pre-commit 集成模式');
  check(ssSkill.includes('git log -p --all'), 'C-06：sec-audit 说明 git 历史扫描范围与命令');

  const { scanSecretsInText, parseNpmAudit, renderSecurityReport, diffBaseline, buildCycloneDX, buildUpgradePlan, ciGateVerdict } =
    await import('../plugins/step-sec-scan/server/lib.mjs');

  const diff = [
    'diff --git a/src/app.js b/src/app.js',
    '+++ b/src/app.js',
    '+const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";',
    '+const cfg = { apiKey: "sk-live-abcdef1234567890abcdef1234" };',
    'diff --git a/tests/keys.js b/tests/keys.js',
    '+++ b/tests/keys.js',
    '+const token = "ghp_AaaBbbCccDddEeeFffGggHhhIiiJjjKkk";',
    'diff --git a/src/demo.js b/src/demo.js',
    '+++ b/src/demo.js',
    '+const apiKey = "your-api-key-here";',
    '',
  ].join('\n');
  const findings = scanSecretsInText(diff);
  check(findings.length === 3, 'secret 扫描：3 命中（占位值忽略；测试路径非占位值降级 low）', JSON.stringify(findings.map((f) => f.id)));
  check(findings.filter((f) => f.severity === 'critical').every((f) => f.file === 'src/app.js') && findings.filter((f) => f.severity === 'critical').length === 2, 'secret 发现定位与严重度（非测试路径 critical）');
  check(findings.some((f) => f.file === 'tests/keys.js' && f.severity === 'low' && f.noise === true), 'C-06：测试路径非占位值降级 low 而不丢弃（修复整体漏报）', JSON.stringify(findings.find((f) => f.file === 'tests/keys.js')));

  // C-06：补齐常见前缀与 20 字符级 key、PGP 私钥块
  const extraSecrets = scanSecretsInText([
    '+++ b/src/extra.js',
    '+const apiKey = "abcdefghij0123456789";',
    '+const slack = "xoxb-1234567890abcdef";',
    '+const stripe = "sk_live_abcdefghijklmnop";',
    '+const pk = "-----BEGIN RSA PRIVATE KEY-----";',
    '+const pgp = "-----BEGIN PGP PRIVATE KEY BLOCK-----";',
    '+const ignored = "your-api-key-here";',
    '',
  ].join('\n'));
  for (const [id, name] of [
    ['generic-api-key', '20 字符级 generic key'],
    ['slack-token', 'Slack token'],
    ['stripe-live-key', 'Stripe live key'],
    ['private-key', 'RSA/PGP 私钥块'],
  ]) {
    check(extraSecrets.some((f) => f.id === id), `C-06：${name} 检出`, JSON.stringify(extraSecrets.map((f) => f.id)));
  }
  check(!extraSecrets.some((f) => f.evidence?.includes('your-api-key-here')), 'C-06：占位值仍然忽略');

  const auditSample = JSON.stringify({ vulnerabilities: { lodash: { severity: 'high', range: '<4.17.21', via: [{ title: 'Prototype Pollution' }], fixAvailable: true }, 'left-pad': { severity: 'low', dev: true, via: ['x'], fixAvailable: true } } });
  const auditFindings = parseNpmAudit(auditSample).findings;
  check(auditFindings.length === 2 && auditFindings[0].severity === 'high', 'npm audit 解析');
  const report = renderSecurityReport({ date: '2026-09-27', findings: [...findings, ...auditFindings] });
  check(report.includes('[CRITICAL]') && report.includes('[HIGH]') && report.includes('docs/security-report.md'.slice(0, 1) === 'd' ? '证据' : '证据'), '报告按严重度排序含证据');

  const baseline = [{ kind: 'vulnerability', package: 'lodash' }];
  const diffed = diffBaseline(auditFindings, baseline);
  check(diffed.news.every((f) => f.package !== 'lodash') && diffed.existing.length === 1, '基线对比：存量不重复报告');

  const sbom = buildCycloneDX({ dependencies: { lodash: '^4.17.21', react: '^18.2.0' } }, 'demo');
  check(sbom.bomFormat === 'CycloneDX' && sbom.components.length === 2 && sbom.components[0].purl.startsWith('pkg:npm/'), 'CycloneDX SBOM 生成');

  const plan = buildUpgradePlan(auditFindings);
  check(plan.length >= 1 && plan[0].package === 'lodash', '自动修复升级计划');
  const gate = ciGateVerdict([...findings, ...auditFindings], { fail_on: ['critical', 'high'] });
  check(gate.pass === false && gate.blocking === 3, 'CI 卡点 critical/high 阻断', JSON.stringify(gate));
}

// ---------- 25b. sec-scan 多生态（SS-110） ----------
{
  const { parsePipAudit, parseCargoAudit } = await import('../plugins/step-sec-scan/server/lib.mjs');
  const pip = parsePipAudit(JSON.stringify({ dependencies: [{ name: 'requests', vulns: [{ id: 'PYSEC-2026-1', aliases: ['CVE-2026-1234'], fix_versions: ['2.32.0'] }] }] }));
  check(pip.findings.length === 1 && pip.findings[0].package === 'requests' && pip.findings[0].severity === 'high', 'pip-audit 解析');
  const cargo = parseCargoAudit(JSON.stringify({ vulnerabilities: { list: [{ package: { name: 'openssl-src' }, advisory: { id: 'RUSTSEC-2026-0001', title: 'buffer overflow', severity: 'high' }, versions: { patched: ['111.0.0'] } }] } }));
  check(cargo.findings.length === 1 && cargo.findings[0].fixAvailable === true, 'cargo audit 解析');
  const ssCmd = readFileSync(join(ROOT, 'plugins/step-sec-scan/commands/audit.md'), 'utf8');
  check(ssCmd.includes('--multi-ecosystem') && ssCmd.includes('--baseline') && ssCmd.includes('--gate'), 'audit.md 含多生态/基线/卡点参数');
}

// ---------- 26. step-api-forge（AF-100） ----------
{
  const afDir = join(ROOT, 'plugins/step-api-forge');
  const { validateOpenApi, generateTsClient } = await import('../plugins/step-api-forge/server/lib.mjs');
  const spec = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/openapi/petstore-mini.json'), 'utf8'));
  const v = validateOpenApi(spec);
  check(v.valid === true && v.operationCount === 3 && v.openapiVersion === '3.0.3', 'petstore 3.0 校验通过', JSON.stringify(v.errors));
  check(validateOpenApi({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/a': { get: { responses: { '200': {} } } } } }).valid === true, '3.1 校验通过');
  const bad = validateOpenApi({ openapi: '2.0', info: {}, paths: { '/a': { get: {} } } });
  check(bad.valid === false && bad.errors.length >= 3, '非法 spec 全量报错', JSON.stringify(bad.errors));
  const client = generateTsClient(spec);
  check(client.code.includes('getPets') && client.code.includes('postPets') && client.code.includes('getPetsPetId'), 'TS 客户端含全部 operation 方法');
  check(client.code.includes('step-api-forge 生成') && client.code.includes('${petId}'), '路径参数插值正确');

  const fake = join(ROOT, 'tests/fixtures/gh-fake/fake-gh.mjs');
  const runMcp4 = (calls, env) => {
    const r = spawnSync(process.execPath, [join(afDir, 'server/index.mjs')], { input: calls.join('\n') + '\n', encoding: 'utf8', timeout: 30000, env });
    if (r.status !== 0) throw new Error(`server 退出 ${r.status}: ${r.stderr.slice(0, 200)}`);
    return (r.stdout + '\n').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  };
  const specPath = join(ROOT, 'tests/fixtures/openapi/petstore-mini.json');
  const msgs = runMcp4(
    [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'validate_spec', arguments: { specPath } } }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'generate_ts_client', arguments: { specPath, baseUrl: 'http://localhost:3000' } } }),
      '',
    ],
    { ...process.env, GH_FIXER_FAKE: fake },
  );
  check(msgs.find((m) => m.id === 1)?.result?.structuredContent?.valid === true, 'MCP validate_spec');
  check(msgs.find((m) => m.id === 2)?.result?.structuredContent?.code?.includes('localhost:3000'), 'MCP generate_ts_client');
}

// ---------- 26b. api-forge mock/docs/diff/python（AF-110/120/130） ----------
{
  const { generateMockServer, generateDocsPage, diffOpenApi, generatePythonSdk, validateOpenApi, generateTsClient } = await import('../plugins/step-api-forge/server/lib.mjs');
  const spec = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/openapi/petstore-mini.json'), 'utf8'));
  const mock = generateMockServer(spec, { style: 'express' });
  check(mock.code.includes("app.get('/pets'") && mock.code.includes('app.listen'), 'express mock 生成');
  const msw = generateMockServer(spec, { style: 'msw' });
  check(msw.code.includes('http.get') && msw.code.includes('HttpResponse'), 'MSW handlers 生成');
  const docs = generateDocsPage(spec);
  check(docs.html.includes('Petstore Mini') && docs.html.includes('/pets/{petId}'), '文档页生成');

  const newSpec = JSON.parse(JSON.stringify(spec));
  delete newSpec.paths['/pets/{petId}'];
  newSpec.paths['/pets'].get.responses = {};
  const diff = diffOpenApi(spec, newSpec);
  check(diff.hasBreaking && diff.breaking.some((b) => b.includes('路径被删除')), 'diff：删除路径检出');
  check(diff.breaking.some((b) => b.includes('响应码被移除')), 'diff：响应码移除检出', JSON.stringify(diff.breaking));

  const addRequired = JSON.parse(JSON.stringify(spec));
  addRequired.paths['/pets'].post.parameters = [{ name: 'force', in: 'query', required: true }];
  const diff2 = diffOpenApi(spec, addRequired);
  check(diff2.hasBreaking && diff2.breaking.some((b) => b.includes('新增必填参数')), 'diff：新增必填参数检出');
  const compatible = diffOpenApi(spec, (() => { const s = JSON.parse(JSON.stringify(spec)); s.paths['/pets/{petId}/friends'] = { get: { responses: { '200': {} } } }; return s; })());
  check(!compatible.hasBreaking && compatible.compatible.some((c) => c.includes('新增路径')), 'diff：兼容变更不误报');

  const py = generatePythonSdk(spec);
  check(py.code.includes('class ApiClient') && py.code.includes('pets_petId_get') && py.code.includes('import requests'), 'Python SDK 生成');

  // C-04：恶意 spec 不得把可执行代码注入生成产物
  const hostilePath = JSON.parse(JSON.stringify(spec));
  hostilePath.paths["/');require('child_process').execSync('calc');//"] = { get: { responses: { '200': { description: 'x' } } } };
  const hv = validateOpenApi(hostilePath);
  check(hv.valid === false && hv.errors.some((e) => e.includes('path 含非法字符')), 'C-04：恶意 path 被校验拒绝', JSON.stringify(hv.errors));
  check(generateMockServer(hostilePath).error === 'spec-invalid', 'C-04：恶意 path 不进入 mock 生成');
  const respKeySpec = JSON.parse(JSON.stringify(spec));
  respKeySpec.paths['/pets'].get.responses = { '200);process.exit(1)//': { description: 'x' } };
  check(validateOpenApi(respKeySpec).valid === false, 'C-04：非法响应码被拒绝');
  const summarySpec = JSON.parse(JSON.stringify(spec));
  summarySpec.paths['/pets'].get.summary = 'x */ require("child_process").execSync("calc") /*';
  const summClient = generateTsClient(summarySpec);
  check(summClient.code.includes('*\\/ require') && !summClient.code.includes('*/ require'), 'C-04：summary 不提前闭合 TS 注释');
  const urlSpec = JSON.parse(JSON.stringify(spec));
  urlSpec.servers = [{ url: 'http://x/";import os;os.system("calc");"' }];
  const pyHostile = generatePythonSdk(urlSpec);
  const baseLine = pyHostile.code.split('\n').find((l) => l.startsWith('BASE_URL = '));
  check(baseLine && JSON.parse(baseLine.slice('BASE_URL = '.length)) === urlSpec.servers[0].url, 'C-04：servers[].url 以 JSON 字符串字面量转义', baseLine);
  check(!/\nimport os/.test(pyHostile.code), 'C-04：恶意 servers url 不产生可执行行');
  const badParam = JSON.parse(JSON.stringify(spec));
  badParam.paths['/pets/{petId}'].get.parameters = [{ name: 'petId");x', in: 'path', required: true }];
  check(validateOpenApi(badParam).valid === false, 'C-04：非法 path 参数名被拒绝');
  const badOpId = JSON.parse(JSON.stringify(spec));
  badOpId.paths['/pets'].get.operationId = 'x; process.exit(1)';
  check(validateOpenApi(badOpId).valid === false, 'C-04：非法 operationId 被拒绝');
}

// ---------- 27. step-db-insight（DI-100 ~ DI-130） ----------
{
  const diDir = join(ROOT, 'plugins/step-db-insight');
  const { assertReadOnlyQuery, interpretExplain, buildMigration, classifyWrite, buildWriteConfirmation, dialectInfo, schemaTimeline, assertIdentifier, parseDatabaseUrl, runPsql } =
    await import('../plugins/step-db-insight/server/lib.mjs');

  // 只读保证对抗测试（验收标准：任何路径都无法产生写语句执行）
  const adversarial = [
    'SELECT 1; DROP TABLE users',
    'WITH x AS (SELECT 1) DELETE FROM users',
    '/* hidden */ DELETE FROM users',
    "SELECT * FROM users; UPDATE users SET admin=true",
    'EXPLAIN ANALYZE DELETE FROM users',
    'INSERT INTO users VALUES (1)',
    'select * from users where name = "a" --; drop table users',
    'SELECT * INTO tmp FROM users',
    'TRUNCATE users',
  ];
  for (const sql of adversarial) {
    check(assertReadOnlyQuery(sql).ok === false, `只读守卫拒绝「${sql.slice(0, 40)}」`, JSON.stringify(assertReadOnlyQuery(sql)));
  }
  check(assertReadOnlyQuery('SELECT * FROM users WHERE id = 1').ok === true, '只读守卫放行正常 SELECT');
  check(assertReadOnlyQuery('EXPLAIN SELECT * FROM users').ok === true, '只读守卫放行 EXPLAIN');
  check(assertReadOnlyQuery('WITH t AS (SELECT 1) SELECT * FROM t').ok === true, '只读守卫放行只读 CTE');

  const plan = interpretExplain('Seq Scan on orders  (cost=0.00..1234.00 rows=5000 width=64)\nFilter: (user_id = 42)');
  check(plan.findings.some((f) => f.includes('orders') && f.includes('索引')), 'EXPLAIN 解读给出索引建议');

  check(JSON.parse(readFileSync(join(diDir, 'step.plugin.json'), 'utf8')).provision?.requiresEnv?.includes('DATABASE_URL'), 'manifest 声明 DATABASE_URL（C4）');
  const diCmd = readFileSync(join(diDir, 'commands/db-insight.md'), 'utf8');
  check(diCmd.includes('环境注入') && diCmd.includes('export 示例'), '凭据指引含 export 示例与环境注入（C4）');

  // C-01：标识符白名单（拒绝引号/分号/多段/超长，允许 schema.table）
  check(assertIdentifier('public.users').ok === true && assertIdentifier('public.users').schema === 'public', 'C-01：schema.table 合法标识符放行');
  for (const badName of ["users'", 'users;drop', 'users --', 'a.b.c', '1users', 'users"', 'users x', 'x'.repeat(64)]) {
    check(assertIdentifier(badName).ok === false, `C-01：非法标识符被拒绝「${badName.slice(0, 24)}」`, JSON.stringify(assertIdentifier(badName)));
  }
  check(diCmd.includes('只读账号') && diCmd.includes('白名单'), 'C-01：命令文档强调只读账号是真正边界');

  // C-02：连接串解析为 PG* 环境变量（不保留连接串/密码）
  const parsedUrl = parseDatabaseUrl('postgres://u:p%40ss@db.example:5433/app?sslmode=require');
  check(
    parsedUrl.env?.PGHOST === 'db.example' && parsedUrl.env?.PGPORT === '5433' && parsedUrl.env?.PGUSER === 'u' &&
      parsedUrl.env?.PGPASSWORD === 'p@ss' && parsedUrl.env?.PGDATABASE === 'app' && parsedUrl.env?.PGSSLMODE === 'require',
    'C-02：DATABASE_URL 拆分为 PG* 环境变量',
    JSON.stringify(parsedUrl),
  );
  check(!JSON.stringify(parsedUrl).includes('postgres://') && parseDatabaseUrl('nonsense').error === 'invalid-credential-url', 'C-02：解析结果不保留原始连接串且非法串报错');
  const connParsed = parseDatabaseUrl("host=db.example port=5433 user=u password='se cret' dbname=app");
  check(connParsed.env?.PGPASSWORD === 'se cret' && connParsed.env?.PGDATABASE === 'app', 'C-02：libpq conninfo 形式同样支持', JSON.stringify(connParsed));

  // C-02：子进程 argv 不含密码/连接串（探测脚本记录 argv 与 PG* 环境）
  const probeScript = join(ROOT, 'tests/fixtures/psql-fake/arg-probe.mjs');
  const probeOut = join(ROOT, 'tests/fixtures/psql-fake/arg-probe.tmp.json');
  const prevFake = process.env.PSQL_FAKE;
  const prevOut = process.env.PSQL_PROBE_OUT;
  rmSync(probeOut, { force: true });
  process.env.PSQL_FAKE = probeScript;
  process.env.PSQL_PROBE_OUT = probeOut;
  try {
    const run = runPsql("SELECT 'SECRET-SQL'", { databaseUrl: 'postgres://u:topsecret@db.example:5433/app' });
    check(run.code === 0, 'C-02：fake psql 经环境变量调用成功', JSON.stringify(run));
    const probe = JSON.parse(readFileSync(probeOut, 'utf8'));
    check(JSON.stringify(probe.args) === JSON.stringify(["SELECT 'SECRET-SQL'"]), 'C-02：argv 只有 SQL,无连接串/密码', JSON.stringify(probe.args));
    check(probe.pg.PGPASSWORD === 'topsecret' && probe.pg.PGHOST === 'db.example' && probe.pg.PGDATABASE === 'app', 'C-02：密码经 PGPASSWORD 环境变量传入', JSON.stringify(probe.pg));
  } finally {
    if (prevFake === undefined) delete process.env.PSQL_FAKE; else process.env.PSQL_FAKE = prevFake;
    if (prevOut === undefined) delete process.env.PSQL_PROBE_OUT; else process.env.PSQL_PROBE_OUT = prevOut;
    rmSync(probeOut, { force: true });
  }

  // v1.1/v1.2/v1.3
  const mig = buildMigration('add user bio', 'add bio column', 'postgres');
  check(/^\d{14}_add_user_bio\.sql$/.test(mig.filename) && mig.sql.includes('+up') && mig.sql.includes('+down'), '迁移草稿命名与 up/down');
  const cls = classifyWrite('DELETE FROM users');
  check(cls.kind === 'reject' && /永久拒绝/.test(cls.reason), 'DELETE 永久拒绝');
  const wu = buildWriteConfirmation('INSERT INTO users(email) VALUES (\'a@b.c\')', { kind: 'insert' });
  check(wu.requiresConfirmation === true && wu.transactionHint.includes('ROLLBACK'), '写确认载荷与事务提示');
  check(dialectInfo('mysql').quote === '`', 'mysql 方言适配');
  check(dialectInfo('sqlite').client === 'sqlite3', 'sqlite 方言适配');

  const migDir = join(ROOT, 'tests/fixtures/db-migrations');
  mkdirSync(migDir, { recursive: true });
  writeFileSync(join(migDir, '20260101120000_create_users.sql'), '-- up\n');
  writeFileSync(join(migDir, '20260102090000_add_orders.sql'), '-- up\n');
  const tl = schemaTimeline(migDir);
  check(tl.count === 2 && tl.mermaid.includes('create_users'), 'schema 时间线生成');

  // MCP 冒烟（fake psql + 缺凭据降级）
  const runMcp5 = (calls, env) => {
    const r = spawnSync(process.execPath, [join(diDir, 'server/index.mjs')], { input: calls.join('\n') + '\n', encoding: 'utf8', timeout: 30000, env });
    if (r.status !== 0) throw new Error(`server 退出 ${r.status}: ${r.stderr.slice(0, 200)}`);
    return (r.stdout + '\n').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  };
  const call5 = (id, name, args) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args ?? {} } });
  const fake = join(ROOT, 'tests/fixtures/psql-fake/fake-psql.mjs');
  const msgs = runMcp5(
    [
      call5(1, 'list_tables'),
      call5(2, 'read_query', { sql: 'SELECT 1; DROP TABLE users' }),
      call5(3, 'describe_table', { table: "users' UNION SELECT 1--" }),
      call5(4, 'sample_rows', { table: 'public.users' }),
      '',
    ],
    { ...process.env, PSQL_FAKE: fake, DATABASE_URL: 'postgres://u:p@localhost/db', DB_DIALECT: 'postgres' },
  );
  check(msgs.find((m) => m.id === 1)?.result?.structuredContent?.output?.includes('users'), 'MCP list_tables（fake psql）');
  check(msgs.find((m) => m.id === 2)?.result?.structuredContent?.rejected === true, 'MCP 只读守卫拒绝写语句');
  check(msgs.find((m) => m.id === 3)?.result?.structuredContent?.error === 'invalid-identifier', 'C-01：MCP describe_table 拒绝非法表名');
  check(msgs.find((m) => m.id === 4)?.result?.structuredContent?.output?.includes('a@b.c'), 'C-01：schema.table 正常查询（fake psql）');
  const nocred = runMcp5([call5(1, 'list_tables'), ''], { ...process.env, PSQL_FAKE: fake, DATABASE_URL: '' });
  check(nocred.find((m) => m.id === 1)?.result?.content?.[0]?.text?.includes('DATABASE_URL'), 'G4：缺凭据输出 export 指引');
}

// ---------- 28. step-doc-gen（DG-100 ~ DG-130） ----------
{
  const dgDir = join(ROOT, 'plugins/step-doc-gen');
  const readmeCmd = readFileSync(join(dgDir, 'commands/readme.md'), 'utf8');
  const structure = extractBlock(readmeCmd, 'README-STRUCTURE');
  check(structure !== null && structure.honesty?.includes('绝不编造'), 'readme.md 含节结构与诚实规则');
  check(extractBlock(readFileSync(join(dgDir, 'commands/api-docs.md'), 'utf8'), 'API-DOCS-RULES') !== null, 'api-docs.md 含规则块');
  check(readFileSync(join(dgDir, 'skills/zh-style/SKILL.md'), 'utf8').includes('全角标点'), '中文排版规范内置');

  const { headingsSync, staleCheck } = await import('./lib/i18n.mjs');
  const src = '# T\n## 安装\n## 使用\n### 示例\n';
  const okZh = '# 标题\n## 安装（中文）\n## 使用说明\n### 示例（中文）\n';
  check(headingsSync(src, okZh).inSync === true, 'i18n 结构同步通过');
  check(headingsSync(src, '# T\n## 使用\n').inSync === false, 'i18n 结构缺失检出');
  const stale = staleCheck(['src/auth.ts'], { 'docs/guide.md': '见 src/auth.ts 的登录流程', 'README.md': '无关内容' });
  check(stale.count === 1 && stale.stale[0].doc === 'docs/guide.md', '过期文档样本 100% 检出', JSON.stringify(stale));

  const { buildMkdocsNav } = await import('./lib/site.mjs');
  const nav = buildMkdocsNav(['index.md', 'guide/index.md', 'guide/quickstart.md', 'api.md']);
  check(nav.includes('  - guide:') && nav.includes('- quickstart: guide/quickstart.md') && nav.includes('index.md'), 'mkdocs 侧边栏自动组织', nav);

  const guardCmd = readFileSync(join(dgDir, 'commands/doc-guard.md'), 'utf8');
  check(extractBlock(guardCmd, 'DOC-GUARD-RULES')?.exit_semantics?.has_stale === '1', 'doc-guard 含 /cron 接入与退出码');
}

// ---------- 29. step-cron-recipes（CR-100 ~ CR-130） ----------
{
  const crDir = join(ROOT, 'plugins/step-cron-recipes');
  const skill = readFileSync(join(crDir, 'skills/recipe-format/SKILL.md'), 'utf8');
  const fmt = extractBlock(skill, 'RECIPE-FORMAT');
  check(fmt !== null && JSON.stringify(fmt.required_sections)?.includes('依赖声明'), '模板通用结构约定');

  const required = ['触发频率建议', '输出落盘路径', '依赖声明'];
  const recipeIds = ['deps-check', 'nightly-test', 'log-patrol', 'git-backup-check', 'page-monitor', 'site-alive'];
  for (const id of recipeIds) {
    const t = readFileSync(join(crDir, `recipes/${id}.md`), 'utf8');
    for (const sec of required) check(t.includes(sec), `模板 ${id} 含「${sec}」`);
    check(t.startsWith('---') && t.includes('description:'), `模板 ${id} 有 frontmatter`);
  }

  const { renderTemplate, buildIndex } = await import('./lib/recipes.mjs');
  const r = renderTemplate('检查 {{url}} 于 {{date}}，范围 {{range}} 天', { url: 'https://example.com' });
  check(r.rendered.includes('https://example.com') && r.rendered.includes(new Date().toISOString().slice(0, 10)) && r.rendered.includes('7d'), '变量渲染与内建变量');
  check(r.missing.length === 0, '无缺失变量');
  const r2 = renderTemplate('报告 {{owner}}', {});
  check(r2.missing.includes('owner') && r2.rendered.includes('{{owner}}'), '缺失变量保留并报告');

  const idx = buildIndex([
    { id: 'deps-check', description: '依赖更新检查', schedule: '每日 09:00', output: 'docs/cron/deps-report.md' },
    { id: 'site-alive', description: '存活检查', schedule: '每 6 小时', output: 'docs/cron/site-alive.md' },
  ]);
  check(idx.includes('| deps-check |') && idx.includes('| site-alive |'), '模板索引页生成');

  const crCmd = readFileSync(join(crDir, 'commands/cron-recipe.md'), 'utf8');
  check(extractBlock(crCmd, 'WIZARD-RULES')?.questions?.length === 3, 'init 向导三问');
  check(extractBlock(crCmd, 'CONTRIBUTING-TEMPLATE')?.path?.includes('community'), '社区贡献规范');
}

// ---------- 30. step-marketplace-cc（MC-100 ~ MC-130） ----------
{
  const { analyzeCcPlugin, buildCcIndex } = await import('./lib/cc-compat.mjs');
  const native = analyzeCcPlugin(JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/cc-plugins/native.json'), 'utf8')));
  check(native.compat === 'native' && native.id === 'cc-pr-review', 'CC 插件：原生兼容判定');
  const patched = analyzeCcPlugin(JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/cc-plugins/patched.json'), 'utf8')));
  check(patched.compat === 'patched' && !('lspServers' in patched.patched) && !('entry' in patched.patched), 'CC 插件：lspServers/entry 剔除修补');
  const upper = analyzeCcPlugin(JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/cc-plugins/uppercase.json'), 'utf8')));
  check(upper.id === 'cc-lint-watcher', 'name→id 归一化', upper.id);

  const catalog = JSON.parse(readFileSync(join(ROOT, 'plugins/step-marketplace-cc/catalog.json'), 'utf8'));
  check(catalog.entries.length >= 10, `收录 ≥10 条（实际 ${catalog.entries.length}）`);
  for (const e of catalog.entries) {
    check(typeof e.lockedVersion === 'string' && typeof e.compat === 'string' && typeof e.note === 'string', `目录条目 ${e.name} 字段完整`);
  }
  check(catalog.entries.every((e) => e.note.includes('待实测')), '诚实标注：实测表现全部为待实测');

  const index = buildCcIndex(catalog.entries);
  check(index.includes('锁定版本') && index.includes('cc-commit-helper'), '兼容性标注表生成');
  const nativeEntry = { name: 'step-commit', upstream: 'Neriah-Ado/stepcode-plugins', lockedVersion: '1.3.0', category: '原生', compat: 'native', note: '本仓库原生插件' };
  const mixedIndex = buildCcIndex([nativeEntry, ...catalog.entries.slice(0, 2)], { includeBadges: true });
  check(mixedIndex.includes('step-commit') && mixedIndex.includes('★'), '原生与迁移插件共存索引 + 徽章（MC-130）');
}

// ---------- 31. step-context-archive（SCA-100，PR #1 社区贡献） ----------
{
  const scaDir = join(ROOT, 'plugins/step-context-archive');
  const archiveCmd = readFileSync(join(scaDir, 'commands/archive.md'), 'utf8');
  const recallCmd = readFileSync(join(scaDir, 'commands/recall.md'), 'utf8');
  const scaSkill = readFileSync(join(scaDir, 'skills/context-archive/SKILL.md'), 'utf8');
  const scaYaml = readFileSync(join(scaDir, 'plugin.yaml'), 'utf8');

  // frontmatter（与 Claude Code Agent Skills 同构）
  for (const [name, text] of [['archive.md', archiveCmd], ['recall.md', recallCmd]]) {
    check(text.startsWith('---') && text.includes('description:'), `commands/${name} 有 frontmatter`);
  }

  // 规则块（validate 单一事实源）
  const archiveBlock = extractBlock(archiveCmd, 'ARCHIVE-RULES');
  check(archiveBlock !== null, 'archive.md 含 ARCHIVE-RULES JSON 块');
  check(archiveBlock?.archive_dir === '.stepcode/context-archive/', 'ARCHIVE-RULES 归档目录固定');
  check(archiveBlock?.id_format?.startsWith('12 位小写十六进制'), 'ARCHIVE-RULES id 格式');
  check(archiveBlock?.overwrite === false, 'ARCHIVE-RULES 禁止覆盖既有归档');
  check(archiveBlock?.outside_default_dir?.includes('用户同意'), 'ARCHIVE-RULES 越界写盘需用户同意');
  check(archiveBlock?.path_style?.includes('项目相对路径'), 'ARCHIVE-RULES 索引行使用项目相对路径');
  const recallBlock = extractBlock(recallCmd, 'RECALL-RULES');
  check(recallBlock !== null, 'recall.md 含 RECALL-RULES JSON 块');
  check(recallBlock?.read_only === true, 'RECALL-RULES 只读召回');
  check(recallBlock?.answer_from?.includes('原文'), 'RECALL-RULES 基于原文回答');
  check(recallBlock?.on_missing?.includes('禁止编造'), 'RECALL-RULES 缺失时禁止编造');

  // 安全红线与关键规则（G3）
  for (const needle of ['只归档、不销毁', '不越界写盘', '不夹带机密', '不编造原文', '不改用户配置']) {
    check(archiveCmd.includes(needle), `archive.md 含安全红线「${needle}」`);
  }
  check(archiveCmd.includes('#STAMP') && archiveCmd.includes('是否完成'), 'archive.md 含 STAMP 索引行与完成状态汇报');
  for (const needle of ['不要猜', '以**当前文件**为准']) {
    check(recallCmd.includes(needle), `recall.md 含召回规则「${needle}」`);
  }
  for (const needle of ['目标：', '关键决策：', '是否完成：', '召回纪律']) {
    check(scaSkill.includes(needle), `SKILL.md 含「${needle}」`);
  }

  // 诚实状态一致性（G1）：SCA-100-4 已在两个真实项目完成验证（2026-09-29，PR #1 评论附可复算数据），随 v1.0.0 发布回填
  check(/- id: SCA-100-4[\s\S]*?done: true/.test(scaYaml), 'plugin.yaml SCA-100-4 已完成（≥2 真实项目验证，证据可复算）');
  check(!scaYaml.includes('status: in-progress'), 'plugin.yaml 无残留 in-progress 状态');
  check(scaYaml.includes('status: done'), 'plugin.yaml 版本/插件状态 done');
  const scaRoadmap = roadmap.plugins.find((p) => p.id === 'step-context-archive');
  check(scaRoadmap?.status === 'done', 'roadmap 状态与 plugin.yaml 一致');
  check(scaRoadmap?.latest_version === '1.0.0', 'roadmap latest_version 已随 v1.0.0 回填');
  check(readFileSync(join(ROOT, 'README.md'), 'utf8').includes('badge/version-1.0.0-blue) | 上下文归档与召回'), 'README 徽章已回填 v1.0.0');
}

// ---------- 汇总 ----------
console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
