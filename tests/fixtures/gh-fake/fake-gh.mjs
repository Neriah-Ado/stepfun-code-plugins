#!/usr/bin/env node
// fake gh CLI（仅测试用）：canned GitHub Actions 结果；GH_FIXER_AUTH_MODE=none 模拟未认证
const args = process.argv.slice(2);
const out = (s) => process.stdout.write(`${s}\n`);

if (args[0] === 'auth' && args[1] === 'status') {
  if (process.env.GH_FIXER_AUTH_MODE === 'none') {
    process.stderr.write('not logged in to any hosts, run `gh auth login`\n');
    process.exit(4);
  }
  out(['github.com account: Neriah (ok)']);
} else if (args[0] === 'run' && args[1] === 'list') {
  // C-05：调用方用 `--workflow=<name>` 等号形式传值，避免值被当成选项
  const wfArg = args.find((a) => a.startsWith('--workflow='));
  const wfIdx = args.indexOf('--workflow');
  const wf = wfArg ? wfArg.slice('--workflow='.length) : wfIdx >= 0 ? args[wfIdx + 1] : null;
  const all = [
    { databaseId: 9001, displayTitle: 'ci: unit tests', workflowName: 'ci', headBranch: 'main', conclusion: 'failure', createdAt: '2026-09-27T01:00:00Z' },
    { databaseId: 9002, displayTitle: 'deploy: staging', workflowName: 'deploy', headBranch: 'main', conclusion: 'failure', createdAt: '2026-09-26T22:00:00Z' },
  ];
  out(JSON.stringify(wf ? all.filter((r) => r.workflowName === wf) : all));
} else if (args[0] === 'run' && args[1] === 'view') {
  const id = args[2];
  const jsonIdx = args.indexOf('--json');
  if (jsonIdx >= 0) {
    out(JSON.stringify({ status: 'completed', conclusion: 'failure', displayTitle: `run ${id}` }));
  } else {
    // ~40KB 日志，结尾为错误段
    const chunk = 'x'.repeat(2048) + ' ok\n';
    let log = '';
    for (let i = 0; i < 15; i += 1) log += `[ci] line ${i}: ${chunk}`;
    log += '[ci] Running tests\n[ci] ✕ calc suite › sub\n[ci]   Expected: 3 Received: 2\n[ci] error TS2304: Cannot find name "calcX"\n[ci] ##[error]Process completed with exit code 1.\n';
    out(log);
  }
} else if (args[0] === 'run' && args[1] === 'rerun') {
  out(['Rerun started']);
} else if (args[0] === 'pr' && args[1] === 'view') {
  out(JSON.stringify({ comments: [{ author: { login: 'reviewer-a' }, body: 'please fix the flaky import order' }, { author: { login: 'reviewer-b' }, body: 'the deploy step needs the new secret' }] }));
} else {
  process.exit(1);
}
