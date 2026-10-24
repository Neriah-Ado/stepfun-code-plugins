#!/usr/bin/env node
// fake psql（仅测试用）：canned 结果
const sql = process.argv[2] ?? '';
if (/pg_tables/i.test(sql)) {
  process.stdout.write(' users\n orders\n products\n');
} else if (/information_schema\.columns/i.test(sql)) {
  process.stdout.write(' id|int4|NO\n email|text|NO\n');
} else if (/^select \* from ([\w.]+) limit/i.test(sql)) {
  process.stdout.write(' 1 | a@b.c\n 2 | d@e.f\n');
} else if (/^explain/i.test(sql)) {
  process.stdout.write('Seq Scan on orders  (cost=0.00..1234.00 rows=5000 width=64)\nFilter: (user_id = 42)\n');
} else if (/^insert/i.test(sql)) {
  process.stdout.write('INSERT 0 1\n');
} else {
  process.stdout.write('OK\n');
}
