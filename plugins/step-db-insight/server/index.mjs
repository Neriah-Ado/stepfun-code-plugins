#!/usr/bin/env node
/**
 * step-db-insight MCP server（stdio JSON-RPC，零依赖；协议与 @modelcontextprotocol/sdk 兼容）。
 * 工具：list_tables / describe_table / sample_rows / explain_query /（v1.1）migration_scaffold /（v1.2）write_confirm /（v1.3）schema_timeline。
 * 所有查询类工具经 assertReadOnlyQuery 白名单强制只读（G3）。
 */
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReadOnlyQuery, readOnlyQuery, interpretExplain, CREDENTIAL_GUIDANCE, buildMigration, slowQueryAdvice, classifyWrite, buildWriteConfirmation, schemaTimeline, assertIdentifier } from './lib.mjs';

const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(readFileSync(join(PLUGIN_DIR, 'step.plugin.json'), 'utf8')).version;
const DIALECT = process.env.DB_DIALECT || 'postgres';

const TOOLS = [
  { name: 'list_tables', description: '列出数据库全部表（只读）', inputSchema: { type: 'object', properties: {} } },
  { name: 'describe_table', description: '表结构详情（只读）', inputSchema: { type: 'object', properties: { table: { type: 'string' } }, required: ['table'] } },
  { name: 'sample_rows', description: '表样例数据（默认 20 行，只读）', inputSchema: { type: 'object', properties: { table: { type: 'string' }, limit: { type: 'number' } }, required: ['table'] } },
  { name: 'explain_query', description: 'EXPLAIN 查询计划（只读）并按规则解读', inputSchema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] } },
  { name: 'read_query', description: '任意只读 SELECT（经白名单守卫）', inputSchema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] } },
  { name: 'migration_scaffold', description: '生成迁移 SQL 草稿供人工审查（v1.1.0）', inputSchema: { type: 'object', properties: { name: { type: 'string' }, changes: { type: 'string' } }, required: ['name', 'changes'] } },
  { name: 'write_confirm', description: 'INSERT/UPDATE 受控写入：返回确认载荷，confirm=true 才执行；DELETE/DDL 永久拒绝（v1.2.0）', inputSchema: { type: 'object', properties: { sql: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['sql'] } },
  { name: 'schema_timeline', description: '从迁移目录生成 schema 演进时间线（mermaid，v1.3.0）', inputSchema: { type: 'object', properties: { migrationsDir: { type: 'string' } }, required: ['migrationsDir'] } },
];

const LIST_TABLES_SQL = {
  postgres: "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1",
  mysql: 'SHOW TABLES',
  sqlite: "SELECT name FROM sqlite_master WHERE type='table' ORDER BY 1",
};

function handleCall(name, args) {
  switch (name) {
    case 'list_tables': {
      const q = LIST_TABLES_SQL[DIALECT] ?? LIST_TABLES_SQL.postgres;
      return readOnlyQuery(q);
    }
    case 'describe_table': {
      if (!args?.table) return { error: 'missing-arg: table' };
      // C-01：库/表名标识符白名单，阻止用引号/分号逃逸出字符串字面量
      const id = assertIdentifier(args.table);
      if (!id.ok) return { error: 'invalid-identifier', reason: id.reason };
      const q = DIALECT === 'postgres'
        ? (id.schema
          ? `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = '${id.schema}' AND table_name = '${id.table}'`
          : `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = '${id.table}'`)
        : `SELECT * FROM ${id.schema ? `${id.schema}.` : ''}${id.table} LIMIT 0`;
      return readOnlyQuery(q);
    }
    case 'sample_rows': {
      if (!args?.table) return { error: 'missing-arg: table' };
      const id = assertIdentifier(args.table);
      if (!id.ok) return { error: 'invalid-identifier', reason: id.reason };
      const limit = Math.max(1, Math.min(Math.floor(Number(args.limit)) || 20, 100));
      return readOnlyQuery(`SELECT * FROM ${id.schema ? `${id.schema}.` : ''}${id.table} LIMIT ${limit}`);
    }
    case 'explain_query': {
      if (!args?.sql) return { error: 'missing-arg: sql' };
      const r = readOnlyQuery(`EXPLAIN ${args.sql}`);
      if (r.rejected || r.error || r.missingCredential || r.guidance) return r;
      return { plan: r.output, interpretation: interpretExplain(r.output) };
    }
    case 'read_query': {
      if (!args?.sql) return { error: 'missing-arg: sql' };
      return readOnlyQuery(args.sql);
    }
    case 'migration_scaffold':
      return args?.name && args?.changes ? buildMigration(args.name, args.changes, DIALECT) : { error: 'missing-arg: name/changes' };
    case 'write_confirm': {
      if (!args?.sql) return { error: 'missing-arg: sql' };
      const cls = classifyWrite(args.sql);
      if (cls.kind === 'reject') return { rejected: true, reason: cls.reason };
      return buildWriteConfirmation(args.sql, cls, { confirm: Boolean(args.confirm) });
    }
    case 'schema_timeline':
      return args?.migrationsDir ? schemaTimeline(args.migrationsDir) : { error: 'missing-arg: migrationsDir' };
    default:
      return null;
  }
}

const rl = createInterface({ input: process.stdin });
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

rl.on('line', (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  const { id, method, params } = req;
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'step-db-insight', version: VERSION } } });
    return;
  }
  if (method?.startsWith('notifications/')) return;
  if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} });
    return;
  }
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }
  if (method === 'tools/call') {
    const result = handleCall(params?.name, params?.arguments);
    if (result === null) {
      send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } });
      return;
    }
    if (result?.error === 'missing-credential') {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: CREDENTIAL_GUIDANCE }], isError: true } });
      return;
    }
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result } });
    return;
  }
  send({ jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message: `Method not found: ${method}` } });
});
