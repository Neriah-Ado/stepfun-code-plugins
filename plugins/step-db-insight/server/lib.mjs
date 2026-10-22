/**
 * step-db-insight MCP server 核心逻辑。
 * v1.0.0：强制只读（语句白名单解析 + 只读连接双重防线）、EXPLAIN 解读规则、凭据缺失引导（G4/C4）。
 * v1.1.0+：迁移生成 / 慢查询建议 / 写白名单确认 / 多库方言（见后续版本段）。
 * DB 访问：环境变量 DATABASE_URL（C4，不落盘）；执行层经 psql CLI（测试缝 PSQL_FAKE）。
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

export const CREDENTIAL_GUIDANCE = [
  '未检测到 DATABASE_URL 环境变量。请安全配置后重试：',
  '- PowerShell：$env:DATABASE_URL = "postgres://user:pass@host:5432/db"',
  '- Git Bash：export DATABASE_URL="postgres://user:pass@host:5432/db"',
  '安全提示：连接串含密码，仅注入当前会话环境，禁止写入文件或提交到仓库（C4）。',
  '只读边界：插件内的语句白名单/标识符白名单只防误操作，**真正的边界是数据库只读账号**（仅 GRANT SELECT）或只读事务；不要用超级用户连接（C-01）。',
  '连接串不会被放进 psql 的 argv：工具会解析后经 PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE 环境变量传给子进程，避免进程列表泄露密码（C-02）。',
].join('\n');

const WRITE_RE = /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|vacuum|call|do|merge|replace|copy)\b/i;
const ALLOWED_PREFIX = /^\s*(select|explain|show|table|values|with)\b/i;

/**
 * 强制只读解析（DI-100-2 的核心，对抗式设计）：
 * 允许仅 SELECT/EXPLAIN/SHOW/TABLE/VALUES/只读 WITH；任何写关键字、多语句、注释走私一律拒绝。
 */
export function assertReadOnlyQuery(sql) {
  if (typeof sql !== 'string' || !sql.trim()) return { ok: false, reason: '空语句' };
  if (sql.includes(';') && /;\s*\S/.test(sql)) return { ok: false, reason: '禁止多语句（检测到语句分隔符后的内容）' };
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim();
  if (!ALLOWED_PREFIX.test(stripped)) return { ok: false, reason: '仅允许只读语句（SELECT/EXPLAIN/SHOW）' };
  if (WRITE_RE.test(stripped)) {
    // WITH 内允许嵌套 SELECT；其余任何写关键字出现即拒绝（含 EXPLAIN ANALYZE DELETE）
    return { ok: false, reason: `检测到疑似写操作关键字，已拒绝（只读模式）` };
  }
  if (/\binto\b/i.test(stripped)) {
    return { ok: false, reason: 'SELECT INTO 属于写行为，已拒绝' };
  }
  return { ok: true };
}

// ---------- C-01：标识符白名单（表/库/列名；只允许未加引号的普通标识符） ----------
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const MAX_IDENTIFIER_LEN = 63; // PostgreSQL 标识符上限（字节）

/**
 * 校验表/库/列名。允许 `schema.table` 两段；拒绝引号、分号、空白、注释符等。
 * 返回 { ok, schema, table } 或 { ok:false, reason }。校验通过的值仍只作为字符串字面量/标识符拼接。
 */
export function assertIdentifier(name) {
  if (typeof name !== 'string' || !name.trim()) return { ok: false, reason: '标识符为空' };
  const parts = name.trim().split('.');
  if (parts.length > 2) return { ok: false, reason: '最多允许 schema.table 两段' };
  for (const part of parts) {
    if (!IDENTIFIER_RE.test(part)) {
      return { ok: false, reason: '标识符仅允许未加引号的 [A-Za-z_][A-Za-z0-9_$]*（拒绝引号/分号/空白/注释符等）' };
    }
    if (part.length > MAX_IDENTIFIER_LEN) {
      return { ok: false, reason: `标识符超长（上限 ${MAX_IDENTIFIER_LEN}）：${part.slice(0, 20)}…` };
    }
  }
  return { ok: true, schema: parts.length === 2 ? parts[0] : null, table: parts.at(-1) };
}

// ---------- C-02：连接串解析为 PG* 环境变量（密码不再出现在 psql argv） ----------
const PG_ENV_KEYS = {
  host: 'PGHOST',
  hostaddr: 'PGHOSTADDR',
  port: 'PGPORT',
  user: 'PGUSER',
  password: 'PGPASSWORD',
  dbname: 'PGDATABASE',
  sslmode: 'PGSSLMODE',
  application_name: 'PGAPPNAME',
  connect_timeout: 'PGCONNECT_TIMEOUT',
};

// libpq connectinfo 字符串（host=... password='...'）解析；无法识别时返回 null
function parseConninfo(raw) {
  const tokens = [];
  let cur = '';
  let quote = null;
  let escaped = false;
  for (const ch of raw) {
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) tokens.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (escaped || quote) return null;
  if (cur) tokens.push(cur);
  const env = {};
  for (const token of tokens) {
    const eq = token.indexOf('=');
    if (eq <= 0) return null;
    const key = token.slice(0, eq);
    const envKey = PG_ENV_KEYS[key.toLowerCase()];
    if (envKey) env[envKey] = token.slice(eq + 1);
  }
  return Object.keys(env).length > 0 ? env : null;
}

/**
 * 把 DATABASE_URL（postgres:// 或 libpq conninfo）拆成 PG* 环境变量。
 * 返回 { env } 或 { error, guidance }；任何分支都不会保留原始连接串。
 */
export function parseDatabaseUrl(databaseUrl) {
  if (typeof databaseUrl !== 'string' || !databaseUrl.trim()) return { error: 'missing-credential' };
  const raw = databaseUrl.trim();
  if (/^postgres(ql)?:\/\//i.test(raw)) {
    let u;
    try {
      u = new URL(raw);
    } catch {
      return { error: 'invalid-credential-url', guidance: 'DATABASE_URL 不是合法连接串；请使用 postgres://user:pass@host:port/db 形式。' };
    }
    const env = {};
    if (u.hostname) env.PGHOST = u.hostname;
    if (u.port) env.PGPORT = u.port;
    if (u.username) env.PGUSER = decodeURIComponent(u.username);
    if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
    const db = u.pathname.replace(/^\//, '');
    if (db) env.PGDATABASE = decodeURIComponent(db);
    for (const [key, value] of u.searchParams) {
      const envKey = PG_ENV_KEYS[key.toLowerCase()];
      if (envKey) env[envKey] = value;
    }
    return { env };
  }
  const conninfo = parseConninfo(raw);
  if (conninfo) return { env: conninfo };
  return { error: 'invalid-credential-url', guidance: '无法解析 DATABASE_URL；请使用 postgres://user:pass@host:port/db 或 libpq conninfo（host=... dbname=...）。' };
}

export function runPsql(sql, { databaseUrl } = {}) {
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) return { missingCredential: true };
  const parsed = parseDatabaseUrl(url);
  if (parsed.error) return { invalidCredential: true, guidance: parsed.guidance };
  // C-02：连接串只经 PG* 环境变量传子进程（argv 仅含 SQL），避免密码出现在进程列表/审计日志
  const env = { ...process.env, ...parsed.env };
  if (process.env.PSQL_FAKE) {
    const r = spawnSync(process.execPath, [process.env.PSQL_FAKE, sql], { encoding: 'utf8', env });
    return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', missing: Boolean(r.error) };
  }
  const bin = process.env.PSQL_BIN || 'psql';
  const r = spawnSync(bin, ['-c', sql], { encoding: 'utf8', shell: false, env });
  if (r.error || r.status === null) return { code: null, stdout: '', stderr: String(r.error?.message ?? 'spawn failed'), missing: true };
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', missing: false };
}

// 只读守卫：先白名单，后执行；拒绝时返回 reason（G3）
export function readOnlyQuery(sql, opts) {
  const guard = assertReadOnlyQuery(sql);
  if (!guard.ok) return { rejected: true, reason: guard.reason };
  const r = runPsql(sql, opts);
  if (r.missingCredential) return { error: 'missing-credential', guidance: CREDENTIAL_GUIDANCE };
  if (r.invalidCredential) return { error: 'invalid-credential', guidance: r.guidance };
  if (r.missing) return { error: 'psql-missing', guidance: '未检测到 psql CLI。请安装 PostgreSQL 客户端工具后重试。' };
  if (r.code !== 0) return { error: 'query-failed', stderr: r.stderr.slice(0, 500) };
  return { output: r.stdout.slice(0, 16 * 1024) };
}

// ---------- v1.1.0 迁移生成与慢查询建议 ----------
const now = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

export function buildMigration(name, changes, dialect = 'postgres') {
  const stamp = now();
  const safeName = String(name).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  const q = dialect === 'mysql' ? '`' : '"';
  const header = `-- migration: ${safeName} (${dialect})\n-- 由 step-db-insight 生成，供人工审查；不自动执行\n`;
  const body = `-- changes:\n${String(changes).split('\n').map((l) => `-- ${l}`).join('\n')}\n`;
  const up = `\n-- +up\n-- 在此写正向迁移（示例骨架，按 changes 调整）\n-- ALTER TABLE ${q}target${q} ADD COLUMN ${q}new_col${q} text;\n`;
  const down = `\n-- +down\n-- 对应回滚\n-- ALTER TABLE ${q}target${q} DROP COLUMN IF EXISTS ${q}new_col${q};\n`;
  return { filename: `${stamp}_${safeName}.sql`, sql: header + body + up + down };
}

export function slowQueryAdvice(planText) {
  const { findings } = interpretExplain(planText);
  const advice = findings.map((f) => ({ finding: f, suggestion: /顺序扫描|Seq Scan/i.test(f) ? '为 WHERE/JOIN 列建 B-tree 索引' : /Nested Loop/i.test(f) ? '改写为 Hash Join 或补充连接索引' : '调整 work_mem 或改写查询' }));
  return { advice };
}

// ---------- v1.2.0 受控写入 ----------
export function classifyWrite(sql) {
  const s = String(sql).trim();
  if (/\b(delete|drop|truncate|alter|grant|revoke|vacuum)\b/i.test(s)) {
    return { kind: 'reject', reason: 'DELETE/DDL 类操作默认永久拒绝（只读兜底之外的最高红线）' };
  }
  if (/^\s*insert\b/i.test(s)) return { kind: 'insert' };
  if (/^\s*update\b/i.test(s)) return { kind: 'update' };
  if (/^\s*merge\b/i.test(s)) return { kind: 'insert' };
  return { kind: 'reject', reason: '仅支持受控 INSERT/UPDATE' };
}

export function buildWriteConfirmation(sql, cls, { confirm = false } = {}) {
  if (!confirm) {
    return {
      requiresConfirmation: true,
      kind: cls.kind,
      sql,
      warning: '受控写入：请核对语句后以 confirm=true 逐条执行；建议包在事务里（见 TXN-RULES）',
      transactionHint: 'BEGIN; <本语句>; 核对影响行数; COMMIT;（异常时 ROLLBACK）',
    };
  }
  const r = runPsql(sql);
  if (r.missingCredential) return { error: 'missing-credential', guidance: CREDENTIAL_GUIDANCE };
  if (r.invalidCredential) return { error: 'invalid-credential', guidance: r.guidance };
  if (r.missing) return { error: 'psql-missing', guidance: '未检测到 psql CLI。请安装 PostgreSQL 客户端工具后重试。' };
  if (r.code !== 0) return { error: 'write-failed', stderr: r.stderr.slice(0, 300) };
  return { executed: true, output: r.stdout.slice(0, 2000) };
}

// ---------- v1.3.0 多库方言与 schema 时间线 ----------
export function dialectInfo(dialect = 'postgres') {
  const table = {
    postgres: { quote: '"', listTables: "SELECT tablename FROM pg_tables WHERE schemaname='public'", client: 'psql' },
    mysql: { quote: '`', listTables: 'SHOW TABLES', client: 'mysql' },
    sqlite: { quote: '"', listTables: "SELECT name FROM sqlite_master WHERE type='table'", client: 'sqlite3' },
  };
  return { dialect, ...(table[dialect] ?? table.postgres) };
}

export function schemaTimeline(migrationsDir) {
  let files = [];
  try {
    files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    return { error: 'dir-unreadable', migrationsDir };
  }
  const entries = files.map((f, i) => {
    const m = /^(\d{8,14})[_-](.+)\.sql$/.exec(f);
    return { order: i + 1, timestamp: m?.[1] ?? null, name: m?.[2] ?? f.replace(/\.sql$/, '') };
  });
  const mermaid = ['timeline', ...entries.map((e) => `    ${e.order} : ${e.name}`)].join('\n');
  return { count: entries.length, entries, mermaid };
}

// ---------- EXPLAIN 解读规则（DI-100-3，与 skills/sql-review 的 EXPLAIN-RULES 一致） ----------
export function interpretExplain(planText) {
  const lines = String(planText).split(/\r?\n/).filter(Boolean);
  const findings = [];
  let seqScans = 0;
  for (const line of lines) {
    if (/Seq Scan on (\w+)/i.test(line)) {
      seqScans += 1;
      const table = /Seq Scan on (\w+)/i.exec(line)[1];
      const rows = /rows=(\d+)/i.exec(line);
      if (!rows || Number(rows[1]) > 1000) {
        findings.push(`对表 ${table} 顺序扫描${rows ? `（约 ${rows[1]} 行）` : ''}：若有 WHERE 过滤条件，考虑建索引`);
      }
    }
    if (/Nested Loop/i.test(line) && /rows=\d{4,}/i.test(line)) {
      findings.push('大规模 Nested Loop：检查连接条件是否缺索引或可改写为 Hash Join');
    }
    if (/sort method:[^"]*external merge/i.test(line.toLowerCase())) {
      findings.push('排序溢出到磁盘（external merge）：考虑增大 work_mem 或减少排序数据量');
    }
  }
  return { findings, planLines: lines.length };
}
