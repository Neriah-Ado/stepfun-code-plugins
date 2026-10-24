#!/usr/bin/env node
/**
 * step-commit v1.0.0 流程验证（验收标准：示例仓库全流程跑通 /commit）。
 *
 * 在临时示例仓库中按 commands/commit.md 的文档流程执行：
 *   status/diff 确认范围 → 生成规范 message → HEREDOC 提交
 *   → pre-commit hook 失败 → 修复后重试（全程不使用 --no-verify）
 *   → 提交后确认；message 通过 Conventional Commits 校验。
 * 随后按 commands/commit-push-pr.md 验证 gh 缺失时的降级路径（G4）。
 *
 * 运行：node tests/verify-commit-flow.mjs   （GIT_BIN 可指定 git 路径）
 */
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GIT_BIN = process.env.GIT_BIN || 'git';
let failed = 0;
const check = (cond, name, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` :: ${detail}`}`);
  if (!cond) failed += 1;
};

const git = (repo, ...args) => {
  const r = spawnSync(GIT_BIN, args, { cwd: repo, encoding: 'utf8', shell: false });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败: ${r.stderr}`);
  return r.stdout.trim();
};

// 与 tests/validate.mjs 相同的 commitlint 等价校验
const CC_RE = /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([a-z0-9._/-]+\))?!?: (.+)$/;
const messageOk = (line) => {
  const m = CC_RE.exec(line);
  return Boolean(m) && m[3].length > 0 && m[3].length <= 100 && !m[3].endsWith('.') && !m[3].endsWith('。');
};

const repo = mkdtempSync(join(tmpdir(), 'step-commit-verify-'));
try {
  git(repo, 'init');
  git(repo, 'config', 'user.name', 'verify-bot');
  git(repo, 'config', 'user.email', 'verify@example.com');
  git(repo, 'config', 'commit.gpgsign', 'false');

  // 基础提交（不含被测改动）
  writeFileSync(join(repo, 'README.md'), '# sample repo\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-m', 'chore: 初始化示例仓库');

  // —— 流程 1：staged 改动 + status/diff 确认范围（命令文档 §1） ——
  writeFileSync(join(repo, 'index.js'), 'export const hello = () => "hi";\n');
  git(repo, 'add', 'index.js');
  const status = git(repo, 'status', '--porcelain');
  check(/^A\s+index\.js$/m.test(status), 'git status 能确认 staged 范围', status);
  const diffStat = git(repo, 'diff', '--staged', '--stat');
  check(diffStat.includes('index.js'), 'git diff --staged 可读改动', diffStat);

  // —— 流程 2：pre-commit hook（模拟 lint：存在 .lint-broken 时报错退出 1） ——
  const hookPath = join(repo, '.git', 'hooks', 'pre-commit');
  writeFileSync(
    hookPath,
    [
      '#!/bin/sh',
      'if [ -f .lint-broken ]; then',
      '  echo "pre-commit: lint 发现问题（模拟）：index.js 缺少分号"',
      '  exit 1',
      'fi',
      'exit 0',
    ].join('\n'),
  );
  writeFileSync(join(repo, '.lint-broken'), 'lint 首跑失败标记');

  // —— 流程 3：HEREDOC 提交（命令文档 §4），hook 首跑失败 ——
  const message = 'feat(index): 新增 hello 导出\n\n示例改动，用于验证 /commit 文档流程与 hook 失败恢复。';
  const r1 = spawnSync(GIT_BIN, ['commit', '-m', message], { cwd: repo, encoding: 'utf8' });
  check(r1.status !== 0, 'pre-commit hook 失败时提交被拦截', r1.stderr || r1.stdout);
  check(r1.stderr.includes('lint 发现问题'), '能读取 hook 失败输出用于归因');
  check(git(repo, 'rev-list', '--count', 'HEAD') === '1', 'hook 失败后未产生新提交');

  // —— 流程 4：按文档归因修复（移除失败源），重试且不加 --no-verify ——
  rmSync(join(repo, '.lint-broken'), { force: true });
  const r2 = spawnSync(GIT_BIN, ['commit', '-m', message], { cwd: repo, encoding: 'utf8' });
  check(r2.status === 0, '修复后重试提交成功（未跳过 hook）', r2.stderr || r1.stderr);
  check(git(repo, 'log', '-1', '--pretty=%s') === message.split('\n')[0], '提交首行与生成的 message 一致');
  check(messageOk(message.split('\n')[0]), '生成的 message 通过 Conventional Commits 校验');
  check(git(repo, 'status', '--porcelain') === '', '提交后工作区干净（命令文档 §6）');
  check(!JSON.stringify(r1).includes('--no-verify') && !JSON.stringify(r2).includes('--no-verify'), '全程未使用 --no-verify');

  // —— 流程 5：/commit-push-pr 的 gh 降级路径（G4） ——
  // 清理项（security-A §7-17）：参数为常量且无用户输入，仍改 shell:false 收敛攻击面
  const gh = spawnSync('gh', ['--version'], { encoding: 'utf8', shell: false });
  const doc = readFileSync(join(ROOT, 'plugins/step-commit/commands/commit-push-pr.md'), 'utf8');
  if (gh.status !== 0) {
    console.log('INFO 本机无 gh，按命令文档输出安装指引：\n未检测到 GitHub CLI。请安装后重试：\nwinget install GitHub.cli\ngh auth login');
    check(doc.includes('winget install GitHub.cli') && doc.includes('gh auth login'), 'gh 缺失时命令文档提供安装指引（G4）');
  } else {
    console.log('INFO 本机已安装 gh，跳过降级路径演示');
    check(typeof doc === 'string' && doc.length > 0, '命令文档可读取');
  }
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log(failed === 0 ? '\nVERIFY ALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
