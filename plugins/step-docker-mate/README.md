# step-docker-mate

Docker/Compose 容器运维。混合形态：MCP server 包装 docker CLI（零依赖 Node，协议与官方 SDK 兼容）+ docker-ops skill 运维方法论。

## MCP 工具

| 工具 | 说明 |
| --- | --- |
| `docker_ps` / `docker_inspect` / `docker_logs` | 状态总览、详情（ExitCode/OOMKilled/挂载）、日志（尾部 200 行截断） |
| `compose_up` / `compose_down` / `compose_ls` | 编排启动；down 默认 dry-run 只列受影响资源，确认后才执行（G3） |
| `image_layers` | 镜像层体积分析，配合 skill 给瘦身建议 |

## 安全与降级

- 危险操作（down/rm/prune/rmi）默认确认，绝不静默执行；
- 参数安全（C-05）：容器名/镜像引用走白名单（首字符非 `-`，非法值不触达 docker），`inspect`/`logs`/`history` 的位置参数前加 `--` 终止符，`--tail` 限制在 1..5000；
- docker CLI 缺失或 daemon 不可用时输出安装/启动指引（G4），不裸报错；
- 远程主机经 `DOCKER_MATE_CONTEXT` 环境变量（docker context），凭据仅环境注入（C4）。

## 安全边界（MCP）

- MCP server 走 stdio JSON-RPC，**无认证、无审计日志**：安全边界即启动它的宿主进程（stdio 继承宿主信任）。
- **仅限本机**：不要将 stdio 桥接为网络/tcp 服务，也不要把本插件 server 暴露到公网；远程操作请用 docker context（`DOCKER_MATE_CONTEXT`）。
- **工具调用 ≠ 用户授权**：`compose_down` 等危险操作的人类门禁仍需宿主确认（`confirm` 只是显式语义）。

## 安装

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-docker-mate
```

## 验证

```bash
node tests/validate.mjs   # 含 fake-docker 端到端：起—查日志—定位 OOM—确认 down 全流程
```

## License

[AGPL-3.0-only](../../LICENSE)
