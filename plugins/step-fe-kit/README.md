# step-fe-kit — 前端开发套件

纯声明式插件：dev server 管理、视觉验证、一键发布。编排**内置** playwright/steppage 插件，零自有后端。

## 它解决什么

前端改动需要反复确认三件事：dev server 是否真的起来了、页面在多个视口下有没有回归、构建产物怎么快速发布预览。本插件把这三步做成命令与技能：检测框架后启动并确认就绪，用截图对比和控制台错误检查视觉回归，构建后联动 steppage 发布。

## 使用

| 命令 | 说明 |
| --- | --- |
| `/dev` | 框架检测（vite/next/webpack）→ 后台启动 → 就绪确认 → 端口占用处理 → 热重载确认 → 停止 |
| `/publish` | 构建 + 调内置 steppage 发布，预览链接回贴终端；未安装时给出 `/plugin install` 指引 |

### 视觉验证

技能 `fe-visual` 提供：改版前后截图对比、浏览器控制台错误采集、指定 selector 组件级截图、375/768/1440 多视口批量检查、性能提示（vite 构建产物解析）与 api-forge mock 联动的 E2E 检查。

## 安装

```bash
/plugin marketplace add Neriah-Ado/stepcode-plugins
/plugin install step-fe-kit
```

## 验证

```bash
node tests/validate.mjs
```

## 边界与限制

- `/publish` 依赖内置 steppage 插件；未安装时只输出安装指引，不代替用户安装。
- 视觉验证依赖 playwright 插件；缺失时给出安装指引。
- 结束 dev server 前必须确认为本插件启动的进程，不误杀其他进程。
- Windows 下使用 `start /b` 等兼容方式后台启动（路径用正斜杠）。
- 插件本身不提供后端服务，发布与浏览器能力由宿主内置插件承担。

## 许可证

[AGPL-3.0-only](../../LICENSE)
