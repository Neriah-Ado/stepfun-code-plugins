#!/usr/bin/env node
// psql 测试缝：把收到的 argv 与 PG* 环境变量写盘，供 C-02 断言「密码不在 argv」。
import { writeFileSync } from 'node:fs';

const out = process.env.PSQL_PROBE_OUT;
if (out) {
  writeFileSync(out, JSON.stringify({
    args: process.argv.slice(2),
    pg: {
      PGHOST: process.env.PGHOST ?? null,
      PGPORT: process.env.PGPORT ?? null,
      PGUSER: process.env.PGUSER ?? null,
      PGPASSWORD: process.env.PGPASSWORD ?? null,
      PGDATABASE: process.env.PGDATABASE ?? null,
      PGSSLMODE: process.env.PGSSLMODE ?? null,
    },
  }));
}
process.stdout.write('OK\n');
