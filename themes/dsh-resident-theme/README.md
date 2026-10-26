# 红后开屏动画 — DeepSeek Harness 红后主题

红后开屏动画（包名 `dsh-redqueen-splash`，插件 id `redqueen-splash`）是 DeepSeek Harness 的第三方组合包，适用于桌面版和网页版。开屏、界面主题与品牌标志都换成了《生化危机》红后的视觉语言。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.2.1--rc.2-e4002b.svg)](#环境要求)

## 简介

安装后，每次启动 Harness 都会先播放一段约 4 秒的开屏动画，再进入主界面。开屏以安布雷拉风格的八边印记开场，四种启动动画（蜂巢握手、身份扫描、终端引导、封锁警报）每次轮换播放。主界面的配色、圆角和 Logo 也会换成红后风格。开屏动画、界面主题和品牌标志可以分别开关。

界面主题提供四套生化危机风格的强调色预设（绯红、生化危害绿、T-病毒紫、保护伞红）和三种底色方案，还可以自定义颜色。空白会话页支持蜂巢网格、扫描线等背景；窗口从后台切回时会播放链路扫描、光圈或故障过渡动效。

设计参考了《生化危机》系列中的红后（Red Queen）与保护伞公司（Umbrella）的视觉语言：蜂巢六边形、红色警报美学、全息监控终端，以及她的眼睛。保护伞印记与全部图形均为程序化矢量渲染，不内置任何官方图片素材；相关名称与标识归其权利人所有，本项目为非商业爱好者作品。

## 环境要求

- DeepSeek Harness 桌面版或网页版 0.2.1-rc.2。
- 在网页版中通过命令行安装时，终端里需要能使用 `pnpm`。

## 安装

### 在插件页安装

1. 在 Harness 侧栏点击 **插件**，然后点击 **添加插件**。
2. 输入本仓库的绝对路径（或远程源 `github:Neriah-Ado/dsh-resident-theme`；远程安装建议固定到 commit，如 `github:Neriah-Ado/dsh-resident-theme#<40 位 commit SHA>`，也可用 release tag，但 tag 可能被移动），点击 **安装**。安装完成后，点击 **立即启用**。
3. 完全退出 Harness，然后重新打开。

> **供应链提示**：远程安装会在 Harness 网页界面里执行本包的 JavaScript，与本页面共享会话能力。建议 pin 到 release tag 或 commit SHA，不要安装来源不明的 fork 或镜像；品牌标记在注入前会经白名单校验（`lib/index.js`），但开屏脚本与浏览器端代码属于可信代码，**pin 住版本才是真正的信任边界**。

### 让 dsh agent 安装

1. 以本仓库目录为工作区新建会话，并切换到 **Creator** 预设。
2. 告诉 agent「安装这个插件」。agent 会按照 [`AGENTS.md`](AGENTS.md) 中的说明完成安装，每一步都会请你批准。
3. 安装完成后，完全退出并重新打开 Harness。

### 使用命令行安装

```bash
# 桌面版（先完全退出 Harness）
dsh plugin --profile desktop add "<本仓库绝对路径>"

# 网页版（先停止正在运行的 dsh web）
dsh plugin --profile web add "<本仓库绝对路径>"

# 远程安装（推荐 pin 到 commit 或 release tag）
dsh plugin --profile desktop add "github:Neriah-Ado/dsh-resident-theme#<40 位 commit SHA>"
```

### 确认安装成功

打开 **插件** 页面，在「已安装」中能看到「红后开屏动画」，并且开关已打开。完全退出并重新打开 Harness 即可看到开屏动画。

### 卸载

在 **插件** 页面打开「红后开屏动画」，点击 **卸载**，然后重启 Harness。也可以退出 Harness 后运行：

```bash
dsh plugin --profile desktop remove dsh-redqueen-splash
```

## 界面主题与品牌标志

界面主题把默认的冷灰色调换成实验室白（浅色模式）和碳黑（深色模式），把 DeepSeek 蓝换成红后绯红，并把圆角改为切角。主题会跟随 Harness 的深浅色设置。它只修改 Harness 的设计变量，不改动具体组件，因此 Harness 更新后通常仍能正常显示。

### 强调色

主题提供四套强调色预设，每套都通过 OKLab 色彩混合自动派生完整色阶：

| 预设 | 色值 | 灵感 |
| --- | --- | --- |
| `crimson`（默认） | `#c8102e` → `#ff3348` | 红后的核心配色，手工调校的绯红色阶 |
| `biohazard` | `#a4c639` → `#c8e639` | 生化危害标志的荧光绿 |
| `t-virus` | `#7b2d8e` → `#a855c7` | T-病毒的紫色光泽 |
| `umbrella` | `#d42027` → `#f04048` | 保护伞公司的标志红 |
| `custom` | 自选 | 通过取色器指定任意颜色 |

### 底色

| 方案 | 说明 |
| --- | --- |
| `clinical`（默认） | 实验室白 / 碳黑，红后的无菌质感 |
| `carbon` | 中性灰底，更低调的工业风格 |
| `official` | 保留 Harness 原生底色，仅叠加切角和强调色 |

### 空白页背景

空白会话页可选四种背景：蜂巢六边形网格（`hex`）、扫描线（`scanlines`）、完整开屏底（`full`）或关闭（`off`）；`random` 每次随机选择。

### 切回动效

窗口从后台切回时播放过渡动效：链路恢复扫描（`scan`）、六边形光圈（`iris`）或故障闪切（`glitch`）。触发条件可设为离开 30 秒后（`away`）、每次切回（`always`）或最小化/隐藏后（`hidden`）。

### 品牌标志会替换侧栏左上角和空白会话页中的 Logo，有三种样式可选：

- **隔离八角**（`octagon`，默认）：黑色切角八角块上的同心圆环，右上角带一个红色标记。
- **后之眼**（`eye`）：分段外环包围的虹膜，中央是一枚红色瞳孔。
- **保护伞印记**（`seal`）：八角红白相间的八枚扇形——保护伞公司标志的矢量渲染，也是开屏动画开场时那枚印记的静态版。

关闭品牌标志，或者停用、卸载本插件后，Harness 会恢复官方的鲸鱼标志。

## 配置

### 在 Harness 中设置

在 **插件** 页面打开「红后开屏动画」，再点击同名组件，即可进入设置页面。设置页分为**开屏**、**文字**、**外观**、**动效**四个分节：外观分节包含强调色色板、自定义取色器和底色选项；动效分节包含切回动效和触发条件。修改会立即保存；页面底部的「恢复默认」会把所有改过的选项恢复为默认值；「预览开屏」按当前设置播放；「预览切回动效」立即播放切回过渡效果。

在会话中输入 `/redqueen`，也可以预览开屏动画或修改常用选项，包括强调色和底色预设。

### 编辑配置文件

也可以直接编辑 `~/.dsh/profiles/desktop/cordis.patch.yml`（网页版为 `~/.dsh/profiles/web/cordis.patch.yml`），在末尾添加：

```yaml
- id: redqueen-splash
  config:
    exit: iris
    duration: 5000
    accent: biohazard
    base: carbon
    heroBackground: hex
    resumeEffect: scan
```

- 这里的 `config` 会整体替换默认配置，没有写出的选项会恢复为默认值。
- 颜色值需要加引号，例如 `'#c8102e'`。
- 无法识别的选项和无效的值会被忽略。

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 是否播放开屏动画。关闭后，界面主题和品牌标志不受影响 |
| `uiTheme` | `true` | 是否使用红后界面主题 |
| `brand` | `true` | 是否替换品牌标志 |
| `logo` | `octagon` | 标志样式：`octagon`（隔离八角）、`eye`（后之眼）或 `seal`（保护伞印记） |
| `accent` | `crimson` | 强调色预设：`crimson`、`biohazard`、`t-virus`、`umbrella` 或 `custom` |
| `accentColor` | `'#c8102e'` | 自定义强调色（仅 `accent` 为 `custom` 时生效），需为 `#RRGGBB` 格式 |
| `base` | `clinical` | 底色方案：`clinical`、`carbon` 或 `official` |
| `heroBackground` | `random` | 空白会话页背景：`random`、`hex`、`scanlines`、`full` 或 `off` |
| `resumeEffect` | `random` | 切回动效：`random`、`scan`、`iris`、`glitch` 或 `off` |
| `resumeTrigger` | `away` | 切回触发条件：`away`（离开 30 秒后）、`always`（每次切回）或 `hidden`（最小化/隐藏后） |
| `title` | `DEEPSEEK HARNESS` | 开屏主标题，最多 80 个字符 |
| `subtitle` | `RED QUEEN MAINFRAME · SECURITY & SURVEILLANCE DIVISION` | 开屏副标题，最多 80 个字符 |
| `code` | `RQ-DSH/0.1` | 开屏角落显示的编号，最多 80 个字符 |
| `whisper` | `YOU ARE ALL GOING TO DIE DOWN HERE.` | 退场前一闪而过的红色文字，留空则不显示，最多 80 个字符 |
| `accentLight` | `'#c8102e'` | 浅色模式下的强调色 |
| `accentDark` | `'#ff3348'` | 深色模式下的强调色 |
| `theme` | `auto` | 开屏的深浅色：`auto` 跟随 Harness，也可以设为 `light` 或 `dark` |
| `intro` | `random` | 启动动画：`random`（轮播，不与上次重复）、`hive`、`scan`、`system` 或 `lockdown` |
| `exit` | `wipe` | 退场动画：`random`（随机）、`wipe`、`blast`、`purge`、`signal` 或 `iris` |
| `duration` | `4000` | 开屏的最短播放时长（毫秒），范围 0–15000，动画节奏随之整体缩放 |
| `maxWait` | `8000` | 等待主界面加载的最长时间（毫秒），不小于 `duration`，最大 20000 |
| `skippable` | `true` | 是否允许跳过开屏动画 |
| `replayOnReload` | `false` | 刷新页面时是否重新播放 |

## 开屏动画

开屏分为**印记、启动动画、欢迎页、退场**四幕。

**印记**：保护伞公司的八角印记首先亮起，八枚红白相间的扇形自中心依次点亮——以矢量渲染致敬原作。印记与启动动画内容独占同一块舞台区，760ms 前印记完全退场、800ms 后启动动画才在同一位置登场，互不叠加。第二幕（欢迎页）完整播完之前，主界面绝不会提前露出。

**启动动画**每次从四种中轮换一种（`intro: random` 不与上次重复，也可固定一种）：

| `intro` | 名称 | 内容 |
| --- | --- | --- |
| `hive` | 蜂巢握手 | 红后之眼从印记中睁开，`ESTABLISHING UPLINK` 逐字解码，诊断清单确认蜂巢状态 |
| `scan` | 身份扫描 | 雷达环与锥形扫描束绕眼旋转，视网膜 / 步态 / 声纹三项计量条充能 |
| `system` | 终端引导 | 玻璃面板上的终端引导日志逐行打出，光标闪烁，`PURGE PROTOCOL ... ARMED` |
| `lockdown` | 封锁警报 | 红色警戒条纹向内滑动，`WARNING` 频闪，确认封锁解除 |

每种启动动画都以各自的确认语收尾（`UPLINK ESTABLISHED` / `IDENTITY VERIFIED` / `ALL SYSTEMS NOMINAL` / `CONTAINMENT SECURE`）。

**欢迎页**：`WELCOME TO` 之下主标题逐字亮起，五枚六边形模块翻入，加载进度走向 100%。启动内容先退场，欢迎页随后才在同一区域出现，两幕不交叠。

**退场**：最后播放一段退场动画，进入主界面。退场开始时开屏整体下电、根层转为透明，四种退场都以揭示真实主界面收尾——瞳孔张开、防爆门分开、数据擦除完毕或信号中断的瞬间就是主界面出现的一刻，没有跳变或黑屏衔接。

### 退场动画

| `exit` | 名称 | 效果 |
| --- | --- | --- |
| `wipe` | 垂帘（默认） | 开屏如整幅幕布完全遮住主界面，第二幕结束后自上而下逐段收起，主界面随幕布依次显现 |
| `iris` | 红后之眼 | 屏幕先暗下来，她的眼睛在中央亮起，随后画面从瞳孔处重新睁开 |
| `blast` | 防爆门 | 一道红色光缝横向展开，画面像防爆门一样上下分开 |
| `purge` | 数据清洗 | 画面结晶成满屏十六进制字符，再逐列清除 |
| `signal` | 信号丢失 | 监控画面被横条撕裂、抖动、闪烁后消失 |
| `random` | 随机 | 每次随机播放一种，且不会和上一次重复 |

### 播放规则

- 开屏至少播放 `duration` 设定的时长，并在主界面加载完成后退场；主界面一直未加载时最多等待 `maxWait`。
- 点击屏幕任意位置，或按 <kbd>Esc</kbd>、<kbd>Enter</kbd>、空格键，都可以跳过。
- 每次启动只播放一次；`replayOnReload` 设为 `true` 时刷新页面也会重播。
- 系统开启「减弱动态效果」时，开屏只显示静态画面并在约 1 秒后淡出。
- 窗口较小时，部分装饰元素会自动隐藏。

## 常见问题

**安装后没有看到开屏动画**

开屏动画只在 Harness 启动时播放。请确认插件已启用，然后完全退出 Harness 再重新打开。

**安装后 Harness 无法正常启动**

Harness 检测到启动异常时，会自动备份配置并停用第三方组合包。你可以在插件页面卸载本插件后重新启动。

## 开发

开发、测试与本地预览说明见 [docs/development.md](docs/development.md)；Agent 安装与操作红线见 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE) · © 2026 Neriah

本项目是非官方的爱好者作品，与《生化危机》（Resident Evil / Biohazard）系列的权利方卡普空（Capcom）没有关联。设计参考了系列作品中的红后形象，所有图形均为原创或程序生成，不包含官方 Logo、角色或美术素材。《生化危机》及相关名称和标识归其权利人所有。

文档规范：[DOCS-STYLE](https://github.com/Neriah-Ado/Neriah-Ado/blob/main/docs/DOCS-STYLE.md)
