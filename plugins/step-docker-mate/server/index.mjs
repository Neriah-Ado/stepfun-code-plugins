#!/usr/bin/env node
/**
 * step-docker-mate MCP server（stdio JSON-RPC，零依赖；协议与 @modelcontextprotocol/sdk 兼容）。
 * 工具：docker_ps / docker_inspect / docker_logs / compose_up / compose_down / compose_ls / image_layers。
 * 环境变量：DOCKER_MATE_CONTEXT（docker context 远程主机）、DOCKER_MATE_FAKE（测试缝）、DOCKER_MATE_BIN。
 */
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dockerVersion, ps, inspect, logs, composeUp, composeDown, composeLs, imageLayers, slimmingPlan, diagnose, dockerEvents, INSTALL_GUIDANCE } from './lib.mjs';

const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(readFileSync(join(PLUGIN_DIR, 'step.plugin.json'), 'utf8')).version;
const ctx = process.env.DOCKER_MATE_CONTEXT || undefined;

const TOOLS = [
  { name: 'docker_ps', description: '列出全部容器（含已停止）', inputSchema: { type: 'object', properties: {} } },
  { name: 'docker_inspect', description: '容器详情（状态/重启次数/挂载）', inputSchema: { type: 'object', properties: { container: { type: 'string' } }, required: ['container'] } },
  { name: 'docker_logs', description: '容器日志（默认尾部 200 行，C5 截断）', inputSchema: { type: 'object', properties: { container: { type: 'string' }, tail: { type: 'number' } }, required: ['container'] } },
  { name: 'compose_up', description: 'compose 起服务（-d 后台）', inputSchema: { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] } },
  { name: 'compose_down', description: '停止并移除 compose 栈。默认 dry-run 只列受影响资源；confirm=true 才执行（G3）', inputSchema: { type: 'object', properties: { file: { type: 'string' }, confirm: { type: 'boolean' }, removeVolumes: { type: 'boolean' } }, required: ['file'] } },
  { name: 'compose_ls', description: '列出本机全部 compose 项目', inputSchema: { type: 'object', properties: {} } },
  { name: 'image_layers', description: '镜像层体积分析（瘦身建议见 skill）', inputSchema: { type: 'object', properties: { image: { type: 'string' } }, required: ['image'] } },
  { name: 'slimming_plan', description: '生成可执行的镜像瘦身方案与预估减重比例', inputSchema: { type: 'object', properties: { image: { type: 'string' } }, required: ['image'] } },
  { name: 'diagnose', description: '崩溃归因：综合 inspect+logs 匹配崩溃模式库（OOM/端口/依赖/卷权限/应用错误）', inputSchema: { type: 'object', properties: { container: { type: 'string' } }, required: ['container'] } },
  { name: 'docker_events', description: '事件流巡检（只读）：过滤 die/oom/kill/stop/start', inputSchema: { type: 'object', properties: { since: { type: 'string' }, until: { type: 'string' } } } },
];

function handleCall(name, args) {
  switch (name) {
    case 'docker_version':
      return dockerVersion(ctx);
    case 'docker_ps':
      return ps(ctx);
    case 'docker_inspect':
      return args?.container ? inspect(args.container, ctx) : { error: 'missing-arg: container' };
    case 'docker_logs':
      return args?.container ? logs(args.container, { tail: args.tail ?? 200, ctx }) : { error: 'missing-arg: container' };
    case 'compose_up':
      return args?.file ? composeUp(args.file, { ctx }) : { error: 'missing-arg: file' };
    case 'compose_down':
      return args?.file ? composeDown(args.file, { confirm: Boolean(args.confirm), removeVolumes: Boolean(args.removeVolumes), ctx }) : { error: 'missing-arg: file' };
    case 'compose_ls':
      return composeLs(ctx);
    case 'image_layers':
      return args?.image ? imageLayers(args.image, ctx) : { error: 'missing-arg: image' };
    case 'slimming_plan': {
      if (!args?.image) return { error: 'missing-arg: image' };
      const layers = imageLayers(args.image, ctx);
      if (layers.error) return layers;
      return { image: args.image, ...slimmingPlan(layers.layers) };
    }
    case 'diagnose':
      return args?.container ? diagnose(args.container, ctx) : { error: 'missing-arg: container' };
    case 'docker_events':
      return dockerEvents({ since: args?.since, until: args?.until, ctx });
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
    send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'step-docker-mate', version: VERSION } } });
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
    if (result?.error === 'docker-not-found') {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: INSTALL_GUIDANCE }], isError: true } });
      return;
    }
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result } });
    return;
  }
  send({ jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message: `Method not found: ${method}` } });
});
