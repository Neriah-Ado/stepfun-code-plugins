/**
 * step-ci-fixer MCP server 核心逻辑（CF-100-1/3 + v1.1/v1.2 扩展）。
 * 包装 gh CLI；日志只取尾部（C5，默认 16KB 错误段）；凭据走 GITHUB_TOKEN（C4）。
 * 测试缝：GH_FIXER_FAKE 指向 fake-gh 脚本（node 执行）；GH_FIXER_BIN 覆盖 gh 路径。
 * v1.3.1（C-05）：runId/prNumber 只接受正整数，--limit 收敛到 1..100，--workflow 用 `--opt=value` 形式
 *                  并拒绝控制符/前导 `-`，杜绝参数被 gh 当作选项（flag 混淆）。
 */
import { spawnSync } from 'node:child_process';

const RUN_ID_RE = /^[1-9]\d{0,19}$/;
const WORKFLOW_MAX_LEN = 128;
const clampLimit = (limit, fallback = 10) => {
  const n = Math.floor(Number(limit));
  return Number.isFinite(n) ? Math.max(1, Math.min(n, 100)) : fallback;
};
const isSafeWorkflow = (workflow) =>
  typeof workflow === 'string' && workflow.length > 0 && workflow.length <= WORKFLOW_MAX_LEN &&
  !workflow.startsWith('-') && !/[\u0000-\u001f\u007f]/.test(workflow);
const normalizeRunId = (runId) => RUN_ID_RE.test(String(runId)) ? String(runId) : null;

export const GH_MISSING_GUIDANCE = [
  '未检测到 GitHub CLI（gh）。请安装并登录后重试：',
  '- Windows: `winget install GitHub.cli` / `scoop install gh` / `choco install gh`',
  '- macOS: `brew install gh`',
  '安装后执行 `gh auth login` 完成认证（或设置 GITHUB_TOKEN 环境变量），再重跑本工具。',
].join('\n');

export const GH_AUTH_GUIDANCE = [
  'gh 已安装但未认证。请二选一：',
  '- 运行 `gh auth login`（浏览器或 token 交互登录）',
  '- 设置环境变量 GITHUB_TOKEN（权限需包含 repo 与 actions）',
  '完成后重跑本工具。',
].join('\n');

export function runGh(args, { timeoutMs = 120000 } = {}) {
  if (process.env.GH_FIXER_FAKE) {
    const r = spawnSync(process.execPath, [process.env.GH_FIXER_FAKE, ...args], { encoding: 'utf8', timeout: timeoutMs });
    return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', missing: Boolean(r.error) };
  }
  const bin = process.env.GH_FIXER_BIN || 'gh';
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: timeoutMs, shell: false });
  if (r.error || r.status === null) {
    return { code: null, stdout: '', stderr: String(r.error?.message ?? 'spawn failed'), missing: true, notLoggedIn: false };
  }
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', missing: false, notLoggedIn: false };
}

// gh 可用性与认证检查（G4/C4）
export function checkGh() {
  const probe = runGh(['auth', 'status']);
  if (probe.missing) return { available: false, guidance: GH_MISSING_GUIDANCE, kind: 'missing' };
  if (probe.code !== 0 && /not logged in|gh auth/i.test(`${probe.stdout}${probe.stderr}`)) {
    return { available: false, guidance: GH_AUTH_GUIDANCE, kind: 'not-logged-in' };
  }
  if (probe.code !== 0) return { available: false, guidance: `${probe.stderr.slice(0, 300)}\n${GH_AUTH_GUIDANCE}`, kind: 'unknown' };
  return { available: true, kind: 'ok' };
}

export function listFailedRuns({ workflow, limit = 10 } = {}) {
  if (workflow !== undefined && workflow !== null && workflow !== '' && !isSafeWorkflow(workflow)) {
    return { error: 'invalid-argument', reason: 'workflow 名称非法（拒绝前导 -、控制符或超长）' };
  }
  const args = ['run', 'list', '--status', 'failure', `--limit=${clampLimit(limit)}`, '--json', 'databaseId,displayTitle,workflowName,headBranch,conclusion,createdAt'];
  if (workflow) args.push(`--workflow=${workflow}`);
  const r = runGh(args);
  if (r.missing) return { error: 'gh-missing', guidance: GH_MISSING_GUIDANCE };
  if (r.code !== 0) return { error: 'gh-failed', stderr: r.stderr.slice(0, 300) };
  try {
    return { runs: JSON.parse(r.stdout || '[]') };
  } catch {
    return { error: 'parse-failed' };
  }
}

export function listWorkflows({ limit = 20 } = {}) {
  const r = runGh(['run', 'list', `--limit=${clampLimit(limit, 20)}`, '--json', 'workflowName,displayTitle,conclusion,status,createdAt']);
  if (r.missing) return { error: 'gh-missing', guidance: GH_MISSING_GUIDANCE };
  if (r.code !== 0) return { error: 'gh-failed', stderr: r.stderr.slice(0, 300) };
  try {
    const runs = JSON.parse(r.stdout || '[]');
    const byName = new Map();
    for (const run of runs) byName.set(run.workflowName, (byName.get(run.workflowName) ?? 0) + 1);
    return { workflows: [...byName.entries()].map(([name, runsCount]) => ({ name, runsCount })) };
  } catch {
    return { error: 'parse-failed' };
  }
}

// C5：日志只保留尾部 maxBytes（默认 16KB）
export function fetchRunLog(runId, { maxBytes = 16 * 1024 } = {}) {
  const id = normalizeRunId(runId);
  if (!id) return { error: 'invalid-argument', reason: 'runId 必须是正整数' };
  const r = runGh(['run', 'view', id, '--log']);
  if (r.missing) return { error: 'gh-missing', guidance: GH_MISSING_GUIDANCE };
  if (r.code !== 0) return { error: 'gh-failed', stderr: r.stderr.slice(0, 300) };
  const buf = Buffer.from(`${r.stdout}${r.stderr}`, 'utf8');
  const truncated = buf.length > maxBytes;
  const text = (truncated ? buf.subarray(buf.length - maxBytes) : buf).toString('utf8');
  return { runId, truncated, bytes: Math.min(buf.length, maxBytes), text };
}

export function rerunWorkflow(runId) {
  const id = normalizeRunId(runId);
  if (!id) return { error: 'invalid-argument', reason: 'runId 必须是正整数' };
  const r = runGh(['run', 'rerun', id]);
  if (r.missing) return { error: 'gh-missing', guidance: GH_MISSING_GUIDANCE };
  if (r.code !== 0) return { error: 'gh-failed', stderr: r.stderr.slice(0, 300) };
  return { runId: Number(runId), rerun: true };
}

export function runStatus(runId) {
  const id = normalizeRunId(runId);
  if (!id) return { error: 'invalid-argument', reason: 'runId 必须是正整数' };
  const r = runGh(['run', 'view', id, '--json', 'status,conclusion,displayTitle']);
  if (r.missing) return { error: 'gh-missing', guidance: GH_MISSING_GUIDANCE };
  if (r.code !== 0) return { error: 'gh-failed', stderr: r.stderr.slice(0, 300) };
  try {
    return { ...JSON.parse(r.stdout) };
  } catch {
    return { error: 'parse-failed' };
  }
}

export function fetchPrComments(prNumber, { maxBytes = 8 * 1024 } = {}) {
  const id = normalizeRunId(prNumber);
  if (!id) return { error: 'invalid-argument', reason: 'prNumber 必须是正整数' };
  const r = runGh(['pr', 'view', id, '--json', 'comments']);
  if (r.missing) return { error: 'gh-missing', guidance: GH_MISSING_GUIDANCE };
  if (r.code !== 0) return { error: 'gh-failed', stderr: r.stderr.slice(0, 300) };
  try {
    const comments = (JSON.parse(r.stdout || '[]').comments ?? []).map((c) => ({ author: c.author?.login, body: c.body }));
    const text = comments.map((c) => `@${c.author}: ${c.body}`).join('\n');
    const buf = Buffer.from(text, 'utf8');
    return { comments, truncated: buf.length > maxBytes, text: (buf.length > maxBytes ? buf.subarray(0, maxBytes) : buf).toString('utf8') };
  } catch {
    return { error: 'parse-failed' };
  }
}

// ---------- v1.1.0 失败分类（与 commands/ci-fix.md 分类策略表一致） ----------
export function classifyFailure(logText) {
  const t = String(logText);
  const rules = [
    { kind: 'lint', match: /eslint|prettier|stylelint|lint error|ES\d{4}/i },
    { kind: 'test', match: /tests? failed|✕|●|AssertionError|FAILED|assert .* ==/i },
    { kind: 'deploy', match: /deploy|upload|npm publish|docker push|permission denied \(publickey\)/i },
    { kind: 'build', match: /error TS\d+|Cannot find module|Module not found|build failed|FAILED: .*compile|exit code [1-9]/i },
  ];
  for (const r of rules) {
    if (r.match.test(t)) return r.kind;
  }
  return 'unknown';
}
