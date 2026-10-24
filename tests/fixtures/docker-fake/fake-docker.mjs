#!/usr/bin/env node
// fake docker CLI（仅测试用）：按参数输出 canned 结果；down 执行时写 DOCKER_MATE_DOWN_MARKER 标记文件用于 G3 验证
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args[0] === '--context') args.splice(0, 2); // 远程 context 前缀对 fake 透明
// C-05：调用方用 `--` 终止选项；fake 与真实 docker 一样把其后的参数当位置参数
const optionTerminator = args.indexOf('--');
if (optionTerminator >= 0) args.splice(optionTerminator, 1);
const marker = process.env.DOCKER_MATE_DOWN_MARKER;
const out = (lines) => process.stdout.write(lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');

if (args[0] === 'version') {
  out(['24.0.0']);
} else if (args[0] === 'ps') {
  out([
    { ID: 'aaa111', Names: 'demo-web', Image: 'demo/web:latest', State: 'exited', Status: 'Exited (137) 2 minutes ago', Ports: '' },
    { ID: 'bbb222', Names: 'demo-api', Image: 'demo/api:latest', State: 'running', Status: 'Up 10 minutes', Ports: '0.0.0.0:8080->8080/tcp' },
    { ID: 'ccc333', Names: 'demo-db', Image: 'postgres:16', State: 'running', Status: 'Up 10 minutes', Ports: '5432/tcp' },
  ]);
} else if (args[0] === 'inspect') {
  const name = args[1] ?? '';
  if (name.includes('web')) {
    out([JSON.stringify([{ Name: '/demo-web', Config: { Image: 'demo/web:latest' }, State: { Status: 'exited', ExitCode: 137, OOMKilled: true, Error: '' }, RestartCount: 3, Mounts: [{ Source: '/data/web', Destination: '/var/www' }] }])]);
  } else if (name.includes('rel')) {
    out([JSON.stringify([{ Name: '/demo-rel', Config: { Image: 'demo/rel:latest' }, State: { Status: 'restarting', ExitCode: 1, OOMKilled: false, Error: '' }, RestartCount: 5, Mounts: [] }])]);
  } else if (name.includes('vol')) {
    out([JSON.stringify([{ Name: '/demo-vol', Config: { Image: 'demo/vol:latest' }, State: { Status: 'running', ExitCode: 0, OOMKilled: false, Error: '' }, RestartCount: 0, Mounts: [{ Source: '/srv/data', Destination: '/var/lib/data' }] }])]);
  } else {
    out([JSON.stringify([{ Name: `/${name}`, Config: { Image: 'demo/other:latest' }, State: { Status: 'running', ExitCode: 0, OOMKilled: false, Error: '' }, RestartCount: 0, Mounts: [] }])]);
  }
} else if (args[0] === 'logs') {
  const name = args.at(-1) ?? '';
  const lines = [];
  if (name.includes('rel')) {
    for (let i = 1; i <= 5; i += 1) lines.push(`Error: connect ECONNREFUSED 127.0.0.1:5432 (attempt ${i}), retrying`);
  } else if (name.includes('vol')) {
    for (let i = 1; i <= 3; i += 1) lines.push(`open /var/lib/data/store.db: permission denied`);
  } else {
    for (let i = 1; i <= 250; i += 1) lines.push(`line-${i} app working`);
    lines.push('FATAL ERROR: Reached heap limit - Allocation failed - JavaScript heap out of memory');
  }
  out(lines);
} else if (args[0] === 'events') {
  out([
    { time: 1769500000, Type: 'container', Action: 'die', Actor: { Attributes: { name: 'demo-web' } } },
    { time: 1769500001, Type: 'container', Action: 'oom', Actor: { Attributes: { name: 'demo-web' } } },
    { time: 1769500002, Type: 'container', Action: 'start', Actor: { Attributes: { name: 'demo-api' } } },
    { time: 1769500003, Type: 'network', Action: 'connect', Actor: { Attributes: { name: 'bridge' } } },
  ]);
} else if (args[0] === 'compose' && args[1] === '-f') {
  const rest = args.slice(3);
  if (rest[0] === 'ps') {
    out([
      { Name: 'demo-web', Service: 'web', State: 'exited' },
      { Name: 'demo-api', Service: 'api', State: 'running' },
      { Name: 'demo-db', Service: 'db', State: 'running' },
    ]);
  } else if (rest[0] === 'up') {
    out(['Container demo-db  Started', 'Container demo-api  Started', 'Container demo-web  Started']);
  } else if (rest[0] === 'down') {
    if (marker) appendFileSync(marker, `down:${args[2]}:${rest.includes('-v')}\n`);
    out(['Container demo-web  Removed', 'Container demo-api  Removed', 'Container demo-db  Removed']);
  } else {
    process.exit(1);
  }
} else if (args[0] === 'compose' && args[1] === 'ls') {
  out([{ Name: 'demo-app', Status: 'running(3)', Configfiles: 'C:/work/demo/compose.yaml' }]);
} else if (args[0] === 'history') {
  out([
    { Size: '320MB', CreatedBy: 'COPY node_modules /app/node_modules # buildkit' },
    { Size: '45MB', CreatedBy: 'COPY src /app/src # buildkit' },
    { Size: '12MB', CreatedBy: 'RUN apt-get install -y curl vim' },
    { Size: '2.4MB', CreatedBy: 'COPY package.json /app/' },
    { Size: '0B', CreatedBy: 'WORKDIR /app' },
  ]);
} else {
  process.exit(1);
}
