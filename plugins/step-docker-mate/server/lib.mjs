/**
 * step-docker-mate MCP server 核心逻辑（DM-100-1/2/3）。
 * 包装 docker CLI（优先）而非依赖 dockerode；输出结构化 JSON；长日志尾部截断（C5）。
 * 危险操作（compose_down/rm/prune）：默认 dry-run 只列受影响资源，confirm=true 才执行（G3）。
 * 测试缝：DOCKER_MATE_FAKE 指向 fake-docker 脚本（node 执行）；DOCKER_MATE_BIN 覆盖 docker 路径。
 * v1.3.1（C-05）：容器名/镜像引用白名单 + `--` 终止符，杜绝把用户输入当 docker 选项（flag 混淆）。
 */
import { spawnSync } from 'node:child_process';

// C-05：名称白名单（且首字符非 '-'，无法伪装成选项）
const CONTAINER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const IMAGE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}$/;

export function assertContainerName(name) {
  const value = typeof name === 'string' ? name.trim() : '';
  if (!CONTAINER_NAME_RE.test(value)) return { ok: false, reason: '容器名仅允许 [A-Za-z0-9][A-Za-z0-9_.-]{0,127}，且不能以 - 开头' };
  return { ok: true, value };
}

export function assertImageRef(ref) {
  const value = typeof ref === 'string' ? ref.trim() : '';
  if (!IMAGE_REF_RE.test(value)) return { ok: false, reason: '镜像引用仅允许 [A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}，且不能以 - 开头' };
  return { ok: true, value };
}

export const INSTALL_GUIDANCE = [
  '未检测到可用的 docker CLI。请安装/启动后重试：',
  '- Windows: Docker Desktop（https://www.docker.com/products/docker-desktop/）或 `winget install Docker.DockerDesktop`',
  '- macOS: `brew install --cask docker`；Linux: https://docs.docker.com/engine/install/',
  '安装后确认 `docker version` 可用，再重跑本工具。',
].join('\n');

export function runDocker(args, { timeoutMs = 120000, context } = {}) {
  const fullArgs = context ? ['--context', context, ...args] : args;
  if (process.env.DOCKER_MATE_FAKE) {
    const r = spawnSync(process.execPath, [process.env.DOCKER_MATE_FAKE, ...fullArgs], { encoding: 'utf8', timeout: timeoutMs });
    return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', missing: r.error ? true : r.status === null };
  }
  const bin = process.env.DOCKER_MATE_BIN || 'docker';
  const r = spawnSync(bin, fullArgs, { encoding: 'utf8', timeout: timeoutMs, shell: false });
  if (r.error || r.status === null || (r.status !== 0 && /ENOENT|not found/i.test(r.stderr ?? ''))) {
    return { code: null, stdout: '', stderr: r.stderr ?? String(r.error?.message ?? 'spawn failed'), missing: true };
  }
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', missing: false };
}

export function dockerVersion(ctx) {
  const r = runDocker(['version', '--format', '{{.Server.Version}}'], { context: ctx });
  if (r.missing) return { available: false, guidance: INSTALL_GUIDANCE };
  if (r.code !== 0) return { available: false, guidance: `docker daemon 不可用：${r.stderr.trim().slice(0, 300)}\n${INSTALL_GUIDANCE}` };
  return { available: true, version: r.stdout.trim() };
}

// docker ps --format '{{json .}}' → 每行一个 JSON
export function ps(ctx) {
  const r = runDocker(['ps', '-a', '--format', '{{json .}}'], { context: ctx });
  if (r.missing) return { error: 'docker-not-found', guidance: INSTALL_GUIDANCE };
  if (r.code !== 0) return { error: 'docker-failed', stderr: r.stderr.slice(0, 500) };
  const containers = r.stdout.split('\n').filter(Boolean).map((l) => {
    try {
      const j = JSON.parse(l);
      return { id: j.ID, name: j.Names, image: j.Image, state: j.State, status: j.Status, ports: j.Ports ?? '' };
    } catch {
      return null;
    }
  }).filter(Boolean);
  return { containers };
}

export function inspect(container, ctx) {
  const id = assertContainerName(container);
  if (!id.ok) return { error: 'invalid-identifier', reason: id.reason };
  const r = runDocker(['inspect', '--', id.value], { context: ctx });
  if (r.missing) return { error: 'docker-not-found', guidance: INSTALL_GUIDANCE };
  if (r.code !== 0) return { error: 'not-found', stderr: r.stderr.slice(0, 300) };
  try {
    const j = JSON.parse(r.stdout)[0] ?? {};
    return {
      name: j.Name?.replace(/^\//, ''),
      image: j.Config?.Image,
      state: j.State ?? null,
      restartCount: j.RestartCount ?? 0,
      mounts: (j.Mounts ?? []).map((m) => ({ source: m.Source, dest: m.Destination })),
    };
  } catch {
    return { error: 'parse-failed' };
  }
}

// C5：日志只取尾部 maxLines（默认 200）
export function logs(container, { tail = 200, ctx } = {}) {
  const id = assertContainerName(container);
  if (!id.ok) return { error: 'invalid-identifier', reason: id.reason };
  const safeTail = Math.max(1, Math.min(Math.floor(Number(tail)) || 200, 5000));
  const r = runDocker(['logs', '--tail', String(safeTail), '--', id.value], { context: ctx });
  if (r.missing) return { error: 'docker-not-found', guidance: INSTALL_GUIDANCE };
  if (r.code !== 0) return { error: 'docker-failed', stderr: r.stderr.slice(0, 300) };
  const text = `${r.stdout}${r.stderr}`.split('\n');
  while (text.length > 0 && text.at(-1) === '') text.pop();
  return { container: id.value, tail: safeTail, truncated: text.length >= safeTail, lines: text.slice(-safeTail) };
}

export function composeUp(file, { ctx } = {}) {
  const r = runDocker(['compose', '-f', file, 'up', '-d'], { context: ctx, timeoutMs: 300000 });
  if (r.missing) return { error: 'docker-not-found', guidance: INSTALL_GUIDANCE };
  if (r.code !== 0) return { error: 'compose-failed', stderr: r.stderr.slice(-500) };
  return { file, started: true, output: r.stdout.split('\n').slice(-20) };
}

// G3：dry-run 列出将停止/删除的资源；confirm=true 才真正 down（含 -v 需 removeVolumes）
export function composeDown(file, { confirm = false, removeVolumes = false, ctx } = {}) {
  const psR = runDocker(['compose', '-f', file, 'ps', '--format', '{{json .}}'], { context: ctx });
  const affected = psR.code === 0
    ? psR.stdout.split('\n').filter(Boolean).map((l) => {
        try {
          const j = JSON.parse(l);
          return { name: j.Name ?? j.Service, state: j.State };
        } catch {
          return null;
        }
      }).filter(Boolean)
    : [];
  if (!confirm) {
    return { file, dryRun: true, affected, message: 'dry-run：以上资源将被停止并移除。用户确认后以 confirm=true 重新调用。' };
  }
  const args = ['compose', '-f', file, 'down'];
  if (removeVolumes) args.push('-v');
  const r = runDocker(args, { context: ctx, timeoutMs: 300000 });
  if (r.missing) return { error: 'docker-not-found', guidance: INSTALL_GUIDANCE };
  if (r.code !== 0) return { error: 'compose-failed', stderr: r.stderr.slice(-500) };
  return { file, removed: true, affected, output: r.stdout.split('\n').slice(-20) };
}

export function composeLs(ctx) {
  const r = runDocker(['compose', 'ls', '--format', '{{json .}}'], { context: ctx });
  if (r.missing || r.code !== 0) return { projects: [] };
  const projects = r.stdout.split('\n').filter(Boolean).map((l) => {
    try {
      const j = JSON.parse(l);
      return { name: j.Name, status: j.Status, configs: j.Configfiles };
    } catch {
      return null;
    }
  }).filter(Boolean);
  return { projects };
}

// 镜像层分析（dive 式解读）：docker history --format json 逐层大小
// ---------- v1.1.0 诊断增强 ----------
// 纯函数：状态+挂载+日志尾部 → 崩溃模式（lib 级可单测）
export function matchCrashPattern(state = {}, mounts = [], tail = '') {
  const patterns = [
    {
      id: 'oom',
      match: state.ExitCode === 137 || state.OOMKilled === true || /heap out of memory|OOMKilled|Killed/i.test(tail),
      cause: 'OOM：内存不足或泄漏（ExitCode 137 / OOMKilled）',
      action: '提高内存限制（mem_limit / deploy.resources）或排查泄漏；勿盲目重启掩盖问题',
    },
    {
      id: 'port-conflict',
      match: /port is already allocated|address already in use/i.test(tail),
      cause: '端口冲突：宿主端口被其他进程/容器占用',
      action: '找到占用方并调整端口映射',
    },
    {
      id: 'dependency-not-ready',
      match: /dependency failed to start|ECONNREFUSED|connection refused/i.test(tail) || (state.Status === 'restarting' && (state.RestartCount ?? 0) > 0),
      cause: '依赖未就绪：连接 DB/上游服务被拒或反复重启',
      action: '为依赖加 healthcheck 与 depends_on.condition；应用侧重试退避',
    },
    {
      id: 'volume-permission',
      match: /permission denied/i.test(tail) && (mounts ?? []).length > 0,
      cause: '卷权限：挂载路径属主/共享配置与容器 UID 不匹配',
      action: '检查宿主目录属主与盘符共享（Windows）；对齐容器运行 UID',
    },
  ];
  return patterns.find((p) => p.match) ?? null;
}

// 崩溃模式库：症状 → 归因 → 处置（与 skills/docker-ops/SKILL.md 表格一致）
export function diagnose(container, ctx) {
  const ins = inspect(container, ctx);
  if (ins.error) return ins;
  const lg = logs(container, { tail: 200, ctx });
  const tail = (lg.lines ?? []).join('\n');
  const state = ins.state ?? {};
  const hit = matchCrashPattern(state, ins.mounts ?? [], tail);
  if (hit) return { container, pattern: hit.id, cause: hit.cause, action: hit.action, exitCode: state.ExitCode ?? null, evidence: (lg.lines ?? []).slice(-10) };
  if (state.ExitCode === 0 && state.Status === 'running') return { container, pattern: 'none', cause: '容器运行中，未见故障模式', action: '无需处置', exitCode: 0 };
  return { container, pattern: 'app-error', cause: `应用自身异常（ExitCode ${state.ExitCode ?? '未知'}），含应用栈回溯`, action: '按日志定位代码，转入修复闭环', exitCode: state.ExitCode ?? null, evidence: (lg.lines ?? []).slice(-10) };
}

// docker events 巡检（只读）：过滤 die/oom/kill 事件
export function dockerEvents({ since, until, ctx } = {}) {
  const args = ['events', '--format', '{{json .}}'];
  if (since) args.push('--since', since);
  if (until) args.push('--until', until);
  const r = runDocker(args, { context: ctx, timeoutMs: 30000 });
  if (r.missing) return { error: 'docker-not-found', guidance: INSTALL_GUIDANCE };
  if (r.code !== 0) return { error: 'docker-failed', stderr: r.stderr.slice(0, 300) };
  const events = r.stdout.split('\n').filter(Boolean).map((l) => {
    try {
      const j = JSON.parse(l);
      return { time: j.time, type: j.Type, action: j.Action, actor: j.Actor?.Attributes?.name ?? j.Actor?.ID };
    } catch {
      return null;
    }
  }).filter((e) => e && /die|oom|kill|stop|start/i.test(e.action));
  return { events };
}

// ---------- v1.2.0 瘦身建议：按最大层指令归类，给出可执行方案与预估减重 ----------
export function slimmingPlan(layers) {
  const parseSize = (s) => {
    const m = /^([\d.]+)(B|kB|MB|GB)$/.exec(String(s));
    if (!m) return 0;
    const unit = { B: 1, kB: 1e3, MB: 1e6, GB: 1e9 }[m[2]];
    return parseFloat(m[1]) * unit;
  };
  const suggestions = [];
  for (const l of layers ?? []) {
    const bytes = parseSize(l.size);
    const cmd = (l.createdBy ?? '').toLowerCase();
    if (bytes < 10 * 1e6) continue;
    if (/node_modules/.test(cmd)) {
      suggestions.push({ layer: l.createdBy, size: l.size, plan: '多阶段构建：仅 COPY 产物（npm ci --omit=dev + prod 阶段拷贝），剔除 node_modules 层', estSaving: bytes });
    } else if (/apt-get/.test(cmd)) {
      suggestions.push({ layer: l.createdBy, size: l.size, plan: '合并 RUN 并加 --no-install-recommends + rm -rf /var/lib/apt/lists/*；移除非必需包（curl/vim）', estSaving: Math.round(bytes * 0.6) });
    } else if (/curl|wget/.test(cmd)) {
      suggestions.push({ layer: l.createdBy, size: l.size, plan: '下载产物后立即删除安装包，合并到同一 RUN', estSaving: Math.round(bytes * 0.5) });
    } else if (/^copy/i.test(cmd)) {
      suggestions.push({ layer: l.createdBy, size: l.size, plan: '检查 .dockerignore，避免把构建缓存/测试/文档拷入镜像', estSaving: Math.round(bytes * 0.3) });
    }
  }
  const totalBytes = (layers ?? []).reduce((s, l) => s + parseSize(l.size), 0);
  const savingBytes = suggestions.reduce((s, x) => s + x.estSaving, 0);
  return { suggestions, estSavingPct: totalBytes > 0 ? Math.round((savingBytes / totalBytes) * 100) : 0 };
}

export function imageLayers(image, ctx) {
  const id = assertImageRef(image);
  if (!id.ok) return { error: 'invalid-identifier', reason: id.reason };
  const r = runDocker(['history', '--no-trunc', '--format', '{{json .}}', '--', id.value], { context: ctx });
  if (r.missing || r.code !== 0) return { error: 'docker-failed', stderr: r.stderr.slice(0, 300) };
  const layers = r.stdout.split('\n').filter(Boolean).map((l) => {
    try {
      const j = JSON.parse(l);
      return { size: j.Size, createdBy: (j.CreatedBy ?? '').slice(0, 160) };
    } catch {
      return null;
    }
  }).filter(Boolean);
  const parseSize = (s) => {
    const m = /^([\d.]+)(B|kB|MB|GB)$/.exec(String(s));
    if (!m) return 0;
    const unit = { B: 1, kB: 1e3, MB: 1e6, GB: 1e9 }[m[2]];
    return parseFloat(m[1]) * unit;
  };
  const sorted = [...layers].sort((a, b) => parseSize(b.size) - parseSize(a.size));
  return { layers, biggest: sorted.slice(0, 5) };
}
