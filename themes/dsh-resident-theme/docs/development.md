# 开发说明

本文面向修改本插件的开发者，收录工作原理、注入约束、本地预览与测试。安装、配置与卸载的用户步骤见 [README.md](../README.md)；Agent 执行规范与红线见 [AGENTS.md](../AGENTS.md)。

## 工作原理

- `lib/index.js` 运行在 Harness 的服务端，通过 `webserver/index-inject` 事件把界面主题、开屏样式和开屏脚本注入页面，因此开屏能在主界面加载之前出现。配置读取、校验与注入行构造见该文件，默认值在 `DEFAULTS`。
- `lib/client.js` 运行在浏览器中，负责品牌标志、设置页面和 `/redqueen` 命令。为了替换标志，`cordis.patch.yml` 会停用官方的 `ui-brand-official` 插件。
- `lib/splash.css` + `lib/splash.js` 是开屏本身；`globalThis.__redqueenSplash.replay({ exit })` 可按需重播。所有样式都限定在 `#redqueen-splash` 下，类名以 `rq-` 开头。
- `lib/splash.js` 的 `BEAT` 与 `lib/splash.css` 顶部的 `--B`、`--G`、`--R` 定义同一组时间点，修改时必须同步（`scripts/test-host.mjs` 会校验）。
- 循环动画的周期使用 1.2 秒（`--beat`）的整数倍。

## 注入与配置

- `cordis.patch.yml` 不得携带 `config` 块：默认值在 `lib/index.js` 的 `Config` schema 中。dsh 首次保存时会把合并后的整份配置复制到用户层，bundle 级 `config` 块会把每个字段都标成已覆盖。
- `lib/index.js` 是宿主侧：校验配置（`resolveConfig`），并通过 `webserver/index-inject` 注入一行样式与一段 body 脚本（`buildInjections`），让开屏在 shell 启动前出现。内联 JSON 会转义 `<`、U+2028 与 U+2029。
- `isAllowedBrandMarkup` 在品牌素材（`lib/brand/*`）进入浏览器 `dangerouslySetInnerHTML` 前做标签与属性白名单校验；未知标签 / 属性、事件处理器、`javascript:` / `data:` URL、外部 `url(...)` 与实体引用会整份丢弃，回退官方品牌标志。
- 宿主配置是 schemastery `Config`（所有字段 `.volatile()`），每次 index 渲染时读取；`@deepseek-ai/schemastery` 是从 dsh 运行时解析的可选 peer。
- `lib/theme.css` 只覆盖 `--dsw-*` 设计变量（不碰组件类名），用 `html body` 选择器赢得与主题插件的层叠。`lib/brand/` 包含 `mark-octagon.svg`、`mark-eye.svg`（可选 `hero-<logo>.svg`）与 `name.html`，以 `globalThis.__RQ_BRAND__` 注入，供客户端的 `sidebar.brand.*` 与 `conversation.hero.brand.mark` 槽位消费；bundle patch 会停用 `ui-brand-official` 腾出槽位。
- `lib/client.js` 是浏览器侧，采用随包发布的 `window.__ModuleLoader__.load` 格式，无构建步骤。占用 `sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark`、插件页 `plugins.row.config`（scope `redqueen-splash`，经 `ctx.configForms`）与 `/redqueen` 弹窗命令（`ctx.commandUi`）。locale 命名空间为 `redqueenSplash`，注册 `{ zh, en }` 且要求键严格对齐。

## 开屏实现约束

- 开屏主体在 `lib/splash.css` 与 `lib/splash.js`；`globalThis.__redqueenSplash.replay({ exit })` 按需重播。CSS 全部限定在 `#redqueen-splash` 下，类名以 `rq-` 开头。
- 节拍：CSS 的 `--B`、`--G`、`--R` 必须与 JS 的 `BEAT` 一致（`scripts/test-host.mjs` 断言）。
- 退场注册在 `EXITS`，启动动画在 `INTROS`（轮播状态存 `localStorage['redqueen-splash:last-intro']`，退场存 `...last-exit`）；`fade` 是兜底。系统开启「减弱动态效果」时始终使用普通淡出，并将开场固定为 `hive`。
- 保护伞印记是程序化矢量渲染（`splash.js` 的 `sealSvg()`；侧栏用 `lib/brand/mark-seal.svg`），不得随包发布官方 Logo 图片素材。
- 退场交接：`.is-leaving` 让根层透明并给舞台下电，所有退场都以揭示真实主界面收尾；新增退场必须维持这一契约（结束透明、无弹跳）。
- 幕间隔离：`is-seal-done`（760ms）将印记 `display: none`，`is-actb`（第二幕入场）隐藏第一幕；两者在 `is-leaving` 期间仍生效。新增幕必须用同样方式控制基础可见性。
- 空闲循环的周期使用 `--beat: 1.2s` 的整数倍。

## 本地预览

需要 Python 3。在本仓库目录运行：

```bash
npm run preview
```

然后在浏览器打开 <http://localhost:4173/preview/>。页面底部可以切换退场动画、深浅色和时长，按 <kbd>R</kbd> 重播。

**离线单文件预览**：运行 `npm run preview:build` 会把样式与脚本全部内联，生成 `preview/standalone.html`——双击即可打开，无需服务器，也方便单独分享。注意它是构建产物，改动 `lib/` 后需要重新生成。

## 测试

需要 Node.js：

```bash
npm test
```

测试覆盖：三个 JS 文件的语法、配置解析与钳制、注入行的转义、模拟加载器下的插槽/命令/多语言注册，以及 JS 与 CSS 节拍常量的一致性。测试无网络、无子进程，适合受限环境。

## 版本与发布

- 在分支上开发，用 `--no-ff` 合并，发布时打 `vX.Y.Z` tag，并保持 `package.json` 的 `version` 同步。
- [CHANGELOG.md](../CHANGELOG.md) 遵循 Keep a Changelog，新条目写在 `[未发布]` 下。
