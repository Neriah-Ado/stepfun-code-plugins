/**
 * step-sec-scan MCP server 核心逻辑（SS-100 系列 + v1.2/v1.3 扩展）。
 * 纯本地实现：secret 模式扫描与降噪、npm audit JSON 解析、报告渲染、基线对比、CycloneDX SBOM。
 * 外部扫描器（gitleaks/pip-audit/cargo audit）经 SEC_FAKE 测试缝或真实二进制调用（G4 缺失给指引）。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

// ---------- secret 模式扫描（内置，零依赖） ----------
// v1.3.1（C-06）：补齐常见前缀（slack/stripe/OpenAI 风格）、PGP 私钥块；generic 值长度门槛 24→20
export const SECRET_PATTERNS = [
  { id: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/ },
  { id: 'github-pat', re: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { id: 'slack-token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { id: 'stripe-live-key', re: /sk_live_[A-Za-z0-9]{16,}/ },
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/ },
  { id: 'jwt', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { id: 'openai-key', re: /sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/ },
  { id: 'generic-api-key', re: /(?:api[_-]?key|secret|token|passwd|password)["'\s:=]{1,4}["']?([A-Za-z0-9_-]{20,})["']?/i },
];

// 降噪（SS-100-3 / C-06，与 skills/sec-audit 的 SEC-NOISE 一致）：
// 测试/示例/文档路径不再整体忽略——仅占位值直接忽略，非占位值降级为 low 并标记 noise，
// 避免「真实密钥写在 tests/docs 里」整体漏报（CI 默认只拦 critical/high，故不会误阻断）。
export function isNoisePath(path) {
  return /(^|\/)(tests?|__tests__|spec|examples?|fixtures?|docs?|mocks?)(\/|$)/i.test(path ?? '');
}
export function isPlaceholderValue(value) {
  return /^(x{3,}|0{8,}|your[_-]?.*|\$\{.*\}|\{\{.*\}\}|<.*>|changeme|placeholder|redacted|\[?redacted\]?|example.*|sample.*|dummy.*|fake.*|mock.*|test.*)$/i.test(value ?? '');
}

export function scanSecretsInText(diffText) {
  const findings = [];
  let currentFile = null;
  let lineNo = 0;
  for (const line of String(diffText).split(/\r?\n/)) {
    const fileMatch = /^\+\+\+ b\/(.+)$/.exec(line);
    if (fileMatch) {
      currentFile = fileMatch[1];
      lineNo = 0;
      continue;
    }
    if (currentFile && line.startsWith('+') && !line.startsWith('+++')) lineNo += 1;
    if (!currentFile) continue;
    const noisy = isNoisePath(currentFile);
    for (const p of SECRET_PATTERNS) {
      const m = p.re.exec(line);
      if (!m) continue;
      const value = m[1] ?? m[0];
      if (isPlaceholderValue(value)) continue;
      findings.push({
        id: p.id,
        file: currentFile,
        line: lineNo,
        severity: noisy ? 'low' : 'critical',
        ...(noisy ? { noise: true, noiseReason: '测试/示例/文档路径，命中非占位值：降级 low 但不丢弃' } : {}),
        evidence: line.slice(0, 120),
      });
      break; // 同一行只报首个命中，避免同一值被多条规则重复计数
    }
  }
  return findings;
}

// ---------- npm audit 解析 ----------
export function parseNpmAudit(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return { error: 'parse-failed' };
  }
  const vulns = data?.vulnerabilities ?? {};
  const findings = [];
  for (const [name, v] of Object.entries(vulns)) {
    findings.push({
      kind: 'vulnerability', package: name, severity: String(v.severity ?? 'low').toLowerCase(),
      title: v.via?.[0]?.title ?? (typeof v.via?.[0] === 'string' ? `via ${v.via[0]}` : 'unknown'),
      fixAvailable: Boolean(v.fixAvailable), isDev: v.dev === true,
      evidence: `${name}@${v.range ?? '*'}`,
    });
  }
  return { findings };
}

export function runScanner(bin, args) {
  if (process.env.SEC_FAKE) {
    const scriptMap = { gitleaks: 'fake-gitleaks.mjs', 'pip-audit': 'fake-pip-audit.mjs', 'cargo-audit': 'fake-cargo-audit.mjs' };
    const r = spawnSync(process.execPath, [`${process.env.SEC_FAKE}/${scriptMap[bin] ?? 'fake-generic.mjs'}`, ...args], { encoding: 'utf8' });
    return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', missing: Boolean(r.error) };
  }
  const r = spawnSync(bin, args, { encoding: 'utf8', shell: false });
  if (r.error || r.status === null) return { code: null, stdout: '', stderr: String(r.error?.message ?? 'spawn failed'), missing: true };
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', missing: false };
}

// ---------- 报告渲染（C5：全文落盘，终端只给摘要） ----------
export function renderSecurityReport({ date, findings, note }) {
  const rank = (f) => SEVERITY_RANK[f.severity] ?? 0;
  const sorted = [...findings].sort((a, b) => rank(b) - rank(a));
  const counts = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  const lines = [`# 安全审计报告 ${date}`, '', `## 摘要`, '', `共 ${findings.length} 项：` +
    Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' / ') || '无发现', ''];
  lines.push('## 明细', '');
  for (const f of sorted) {
    lines.push(`- [${f.severity.toUpperCase()}] ${f.kind === 'vulnerability' ? `${f.package}（${f.title}）` : `${f.id} @ ${f.file}:${f.line}`}`);
    lines.push(`  - 证据: ${f.evidence ?? ''}`);
    lines.push(`  - 建议: ${f.fixAvailable ? 'npm audit fix 可自动修复' : f.kind === 'vulnerability' ? '查看 advisory 升级或替换依赖' : '立即轮换该凭据并从历史中清除'}`);
  }
  lines.push('', note ?? '', '');
  return lines.join('\n');
}

// ---------- v1.1.0 多生态审计解析 ----------
export function parsePipAudit(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return { error: 'parse-failed' };
  }
  const findings = [];
  for (const dep of data?.dependencies ?? []) {
    for (const v of dep.vulns ?? []) {
      findings.push({
        kind: 'vulnerability', package: dep.name, severity: (v.fix_versions?.length ? 'high' : 'medium'),
        title: v.aliases?.[0] ?? v.id ?? 'unknown', fixAvailable: (v.fix_versions?.length ?? 0) > 0,
        evidence: `${dep.name} ${v.id ?? ''}`,
      });
    }
  }
  return { findings };
}

export function parseCargoAudit(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return { error: 'parse-failed' };
  }
  const findings = [];
  for (const v of data?.vulnerabilities?.list ?? []) {
    findings.push({
      kind: 'vulnerability', package: v.package?.name, severity: String(v.advisory?.severity ?? 'medium').toLowerCase(),
      title: v.advisory?.title ?? v.advisory?.id ?? 'unknown', fixAvailable: Boolean(vVersions(v)?.length),
      evidence: `${v.package?.name} ${v.advisory?.id ?? ''}`,
    });
  }
  return { findings };
}
const vVersions = (v) => v?.versions?.patched;

// ---------- v1.2.0 基线对比 ----------
export function diffBaseline(current, baseline) {
  const key = (f) => `${f.kind ?? 'secret'}\u0000${f.package ?? f.id}\u0000${f.file ?? ''}`;
  const base = new Set((baseline ?? []).map(key));
  const news = [];
  const existing = [];
  for (const f of current) (base.has(key(f)) ? existing : news).push(f);
  return { news, existing };
}

// ---------- v1.2.0 CycloneDX SBOM ----------
export function buildCycloneDX(packageJson, name = 'project') {
  const components = Object.entries(packageJson?.dependencies ?? {}).map(([p, version]) => ({
    type: 'library', name: p, version: String(version).replace(/^[^\d]*/, ''),
    purl: `pkg:npm/${p}@${String(version).replace(/^[^\d]*/, '')}`,
  }));
  return {
    bomFormat: 'CycloneDX', specVersion: '1.5', serialNumber: `urn:uuid:step-sec-scan-${Date.now()}`,
    metadata: { component: { type: 'application', name } },
    components,
  };
}

// ---------- v1.3.0 升级计划与 CI 卡点 ----------
export function buildUpgradePlan(findings) {
  return findings
    .filter((f) => f.kind === 'vulnerability' && f.fixAvailable)
    .map((f) => ({ package: f.package, action: `npm install ${f.package}@latest（先看 breaking change）` }));
}

export function ciGateVerdict(findings, gate = { fail_on: ['critical', 'high'] }) {
  const bad = findings.filter((f) => gate.fail_on.includes(f.severity));
  return { pass: bad.length === 0, blocking: bad.length, fail_on: gate.fail_on };
}
