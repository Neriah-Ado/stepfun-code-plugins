/**
 * dsh-redqueen-splash — browser half.
 *
 * Replaces the sidebar and conversation brand marks, provides the plugin
 * settings page, and registers the /redqueen popup command. The splash
 * itself is injected by the host half (lib/splash.js), so this module never
 * touches it except through globalThis.__redqueenSplash.replay().
 *
 * Bundle format: a parser-loaded registration for the shell's module table
 * (window.__ModuleLoader__.load), no build step.
 */

window.__ModuleLoader__.load({
  id: "dsh-redqueen-splash",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");
    const { jsx, jsxs } = require("react/jsx-runtime");
    const P = require("@deepseek-ai/dsh-client-ui-primitives");

    const NS = "redqueenSplash";
    const CONFIG = globalThis.__RQ_SPLASH__ || {};
    const BRAND = globalThis.__RQ_BRAND__ || {};

    const exits = ["random", "wipe", "blast", "purge", "signal", "iris"];
    const intros = ["random", "hive", "scan", "system", "lockdown"];
    const themes = ["auto", "light", "dark"];
    const logos = ["octagon", "eye", "seal"];
    const accents = ["crimson", "biohazard", "t-virus", "umbrella", "custom"];
    const bases = ["clinical", "carbon", "official"];
    const heroBackgrounds = ["random", "hex", "scanlines", "full", "off"];
    const resumeEffects = ["random", "scan", "iris", "glitch", "off"];
    const resumeTriggers = ["away", "always", "hidden"];
    const switches = ["enabled", "skippable", "replayOnReload", "uiTheme", "brand"];
    const texts = ["title", "subtitle", "code", "whisper"];
    const validColor = (value) => typeof value === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
    const expandColor = (value) => value.length === 4 ? "#" + [...value.slice(1)].map((c) => c + c).join("") : value;

    const ACCENT_COLORS = {
      crimson: "#c8102e",
      biohazard: "#a4c639",
      "t-virus": "#7b2d8e",
      umbrella: "#d42027",
    };

    // ---- resume layer -------------------------------------------------------
    const RESUME_MS = { scan: 840, iris: 1300, glitch: 540 };
    function resumeLayer(doc, kind) {
      const el = (tag, className, parent, vars) => {
        const node = doc.createElement(tag);
        if (className) node.className = className;
        if (vars) for (const [name, value] of Object.entries(vars)) node.style.setProperty(name, value);
        parent.append(node);
        return node;
      };
      const svg = (className, viewBox, markup, parent) => {
        const node = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        node.setAttribute("class", className);
        node.setAttribute("viewBox", viewBox);
        node.innerHTML = markup;
        parent.append(node);
      };
      const root = doc.createElement("div");
      root.className = `rq-resume rq-resume--${kind}`;
      root.setAttribute("aria-hidden", "true");
      if (kind === "scan") {
        el("i", "rq-rs-line", root);
        for (const corner of ["tl", "tr", "bl", "br"]) el("i", `rq-rs-c rq-rs-c--${corner}`, root);
        const tag = el("span", "rq-rs-tag", root);
        tag.append("UPLINK RESTORED");
        el("b", "", tag);
      } else if (kind === "iris") {
        const view = doc.defaultView || {};
        const reach = Math.hypot((view.innerWidth || 1600) / 2, (view.innerHeight || 1000) / 2);
        root.style.setProperty("--rq-ri-max", String(reach / 0.866 / 100 + 0.3));
        const veil = el("i", "rq-ri-veil", root);
        svg("rq-ri-emblem", "0 0 220 220", '<circle cx="110" cy="110" r="90" pathLength="1" transform="rotate(-90 110 110)"/>'
          + '<path class="rq-ri-hex" pathLength="1" d="M151.57 86V134L110 158L68.43 134V86L110 62"/>'
          + '<path class="rq-ri-seal" pathLength="1" d="M110 62L151.57 86"/><rect x="102" y="102" width="16" height="16"/>', veil);
        svg("rq-ri-ring", "-100 -100 200 200", '<polygon points="0,-100 86.6,-50 86.6,50 0,100 -86.6,50 -86.6,-50"/>', root);
      } else if (kind === "glitch") {
        el("i", "rq-rg-flash", root);
        for (const [type, y, h, x, w, a, b, c, d] of [
          ["hi", "12%", "5%", "6%", "52%", "40px", "-30px", "12px", "0s"],
          ["dim", "24%", "9%", "30%", "70%", "-60px", "24px", "-8px", ".03s"],
          ["inv", "40.5%", "1.1%", "0%", "38%", "120px", "-40px", "60px", ".06s"],
          ["blk", "47%", "4px", "71%", "64px", "-26px", "40px", "-90px", ".01s"],
          ["hi", "54%", "3.5%", "44%", "48%", "-80px", "50px", "-20px", ".02s"],
          ["dim", "65%", "7%", "0%", "64%", "30px", "-70px", "16px", ".05s"],
          ["blk", "71%", "3px", "22%", "38px", "60px", "-24px", "110px", ".07s"],
          ["inv", "78%", ".8%", "52%", "40%", "-90px", "60px", "-30px", ".08s"],
          ["hi", "86%", "4%", "18%", "30%", "50px", "-20px", "70px", ".04s"]
        ]) el("i", `rq-rg-s rq-rg-s--${type}`, root, { "--y": y, "--h": h, "--x": x, "--w": w, "--a": a, "--b": b, "--c": c, "--d": d });
        for (const [y, h, x, w, color, a, b, c, d] of [
          ["31%", "2px", "-5%", "70%", "", "-40px", "60px", "0px", "0s"],
          ["62%", "1px", "35%", "75%", "var(--rq-rs-ink)", "50px", "-20px", "10px", ".05s"],
          ["74%", "1px", "8%", "45%", "75%", "20px", "-60px", "12px", ".09s"]
        ]) el("b", "rq-rg-l", root, { "--y": y, "--h": h, "--x": x, "--w": w, ...(color ? { "--lc": color } : {}), "--a": a, "--b": b, "--c": c, "--d": d });
      }
      return root;
    }

    const zh = {
      summary: "设置红后开屏、界面主题和品牌。",
      command: "红后", commandDescription: "预览开屏或更改红后主题设置。",
      splash: "开屏", text: "文字", color: "颜色", interface: "界面", appearance: "外观", motion: "动效", actions: "操作",
      exit: "退场", theme: "主题", logo: "Logo 方案",
      enabled: "开屏动画", skippable: "允许跳过", replayOnReload: "刷新时重播",
      uiTheme: "界面主题", brand: "品牌替换",
      octagon: "隔离八角", eye: "后之眼", seal: "保护伞印记",
      logoOctagon: "Logo：隔离八角", logoEye: "Logo：后之眼", logoSeal: "Logo：保护伞印记",
      duration: "显示时长（ms）", title: "主标题", subtitle: "副标题", code: "角落编号",
      whisper: "幽灵提示语", accentLight: "浅色强调色", accentDark: "深色强调色",
      accent: "强调色", accentColor: "自定义颜色",
      ac_crimson: "红后绯红", ac_biohazard: "生化黄绿", ac_tvirus: "T-病毒紫", ac_umbrella: "保护伞红", ac_custom: "自定义",
      base: "底色",
      bs_clinical: "实验室白", bs_carbon: "碳黑", bs_official: "原版冷灰",
      heroBackground: "空白页背景",
      hb_random: "随机", hb_hex: "蜂巢网格", hb_scanlines: "扫描线", hb_full: "完整开屏底", hb_off: "关闭",
      resumeEffect: "切回动效", resumeTrigger: "切回触发",
      rf_random: "随机", rf_scan: "链路恢复扫描", rf_iris: "红后之眼", rf_glitch: "信号故障", rf_off: "关闭",
      rt_away: "离开 30 秒后", rt_always: "每次切回", rt_hidden: "最小化或隐藏后",
      random: "随机", wipe: "垂帘", blast: "防爆门", purge: "数据清洗", signal: "信号丢失", iris: "红后之眼",
      intro: "启动动画", hive: "蜂巢握手", scan: "身份扫描", system: "终端引导", lockdown: "封锁警报",
      auto: "跟随", light: "浅色", dark: "深色", on: "开启", off: "关闭",
      uiThemeOn: "界面主题 开", uiThemeOff: "界面主题 关",
      brandOn: "品牌替换 开", brandOff: "品牌替换 关",
      preview: "预览开屏", previewNow: "立即预览",
      previewResume: "预览切回动效", previewResumeNow: "立即预览切回动效",
      resetAll: "恢复默认", restart: "重启 Harness 后生效；预览立即播放。",
      readOnly: "此配置当前为只读。", unavailable: "配置服务暂不可用。",
      saveFailed: "保存失败，请重试。", invalidNumber: "请输入 0–15000 的毫秒数。",
      search: "搜索…", empty: "暂无内容", noResults: "没有匹配项",
      whisperHint: "退场前一闪而过的红色文字；留空则不显示。颜色值请加 #。",
      appearanceNote: "界面的深浅色在 Harness「设置 → 通用 → 外观」中切换；「强调色」同时影响开屏和界面。",
    };
    const en = {
      summary: "Configure the Red Queen splash, interface theme and brand.",
      command: "Red Queen", commandDescription: "Preview the splash or change Red Queen settings.",
      splash: "Splash", text: "Text", color: "Color", interface: "Interface", appearance: "Appearance", motion: "Motion", actions: "Actions",
      exit: "Exit", theme: "Theme", logo: "Logo scheme",
      enabled: "Splash animation", skippable: "Skippable", replayOnReload: "Replay on reload",
      uiTheme: "Interface theme", brand: "Brand replacement",
      octagon: "Containment octagon", eye: "Queen's eye", seal: "Umbrella seal",
      logoOctagon: "Logo: containment octagon", logoEye: "Logo: Queen's eye", logoSeal: "Logo: Umbrella seal",
      duration: "Duration (ms)", title: "Main heading", subtitle: "Sub heading", code: "Corner identifier",
      whisper: "Ghost message", accentLight: "Accent (light)", accentDark: "Accent (dark)",
      accent: "Accent", accentColor: "Custom colour",
      ac_crimson: "Queen crimson", ac_biohazard: "Biohazard green", ac_tvirus: "T-Virus purple", ac_umbrella: "Umbrella red", ac_custom: "Custom",
      base: "Base tone",
      bs_clinical: "Lab white", bs_carbon: "Carbon black", bs_official: "Harness grey",
      heroBackground: "Blank page background",
      hb_random: "Random", hb_hex: "Honeycomb grid", hb_scanlines: "Scanlines", hb_full: "Full splash", hb_off: "Off",
      resumeEffect: "Resume effect", resumeTrigger: "Resume trigger",
      rf_random: "Random", rf_scan: "Link scan", rf_iris: "Queen's eye", rf_glitch: "Signal glitch", rf_off: "Off",
      rt_away: "After 30 s away", rt_always: "Every return", rt_hidden: "After minimize or hide",
      random: "Random", wipe: "Curtain", blast: "Blast doors", purge: "Data purge", signal: "Signal loss", iris: "Queen's eye",
      intro: "Boot intro", hive: "Hive handshake", scan: "Identity scan", system: "Terminal boot", lockdown: "Lockdown alert",
      auto: "Auto", light: "Light", dark: "Dark", on: "On", off: "Off",
      uiThemeOn: "Interface theme on", uiThemeOff: "Interface theme off",
      brandOn: "Brand replacement on", brandOff: "Brand replacement off",
      preview: "Preview splash", previewNow: "Preview now",
      previewResume: "Preview resume effect", previewResumeNow: "Preview resume effect now",
      resetAll: "Reset to defaults", restart: "Takes effect after restarting Harness; previews play at once.",
      readOnly: "This configuration is currently read-only.", unavailable: "The configuration service is unavailable.",
      saveFailed: "Saving failed, please retry.", invalidNumber: "Enter a value between 0 and 15000 ms.",
      search: "Search…", empty: "Nothing here", noResults: "No matches",
      whisperHint: "A red line that flashes before the exit; leave empty to hide. Quote hex colors with #.",
      appearanceNote: "Switch the interface between light and dark in Harness Settings → General → Appearance; Accent affects both splash and interface.",
    };

    const CSS = [
      ".rq-brand{display:inline-flex}",
      ".rq-brand-mark>svg,.rq-brand-hero>svg{width:100%;height:100%}",
      ".rq-cfg{display:flex;flex-direction:column;gap:20px;max-width:720px;color:var(--dsw-alias-label-primary)}",
      ".rq-cfg-note{margin:0;font-size:13px;color:var(--dsw-alias-label-tertiary)}",
      ".rq-cfg-section{display:flex;flex-direction:column;gap:12px}",
      ".rq-cfg-h{margin:0;font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}",
      ".rq-cfg-row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:32px}",
      ".rq-cfg-label{font-size:13px;color:var(--dsw-alias-label-secondary)}",
      ".rq-cfg-field{display:flex;flex-direction:column;gap:4px}",
      ".rq-cfg-hint{margin:0;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}",
      ".rq-cfg-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}",
      ".rq-cfg-preview,.rq-cfg-reset{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 16px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:transparent;font:500 13px/1 var(--dsw-font-family);color:var(--dsw-alias-label-primary);white-space:nowrap;cursor:pointer}",
      ".rq-cfg-preview:hover:not(:disabled),.rq-cfg-reset:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
      ".rq-cfg-preview i{width:7px;height:7px;background:var(--dsw-static-deepseek-500);clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}",
      ".rq-cfg-preview:disabled,.rq-cfg-reset:disabled{opacity:.45;cursor:default}",
      // Accent swatches
      ".rq-cfg-swatches{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px}",
      ".rq-cfg-swatch{display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 10px 0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:transparent;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}",
      ".rq-cfg-swatch:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".rq-cfg-swatch:focus-visible{outline:1.5px solid var(--dsw-static-deepseek-500)}",
      ".rq-cfg-swatch:disabled{opacity:.5}",
      ".rq-cfg-swatch[aria-checked=true]{border-color:var(--rq-swatch,var(--dsw-alias-border-l3));box-shadow:inset 0 0 0 .5px var(--rq-swatch,var(--dsw-alias-border-l3));color:var(--dsw-alias-label-primary)}",
      ".rq-cfg-swatch-chip{width:10px;height:10px;flex-shrink:0;border-radius:0;background:var(--rq-swatch)}",
      ".rq-cfg-swatch[data-accent=custom] .rq-cfg-swatch-chip{background:var(--rq-swatch,repeating-linear-gradient(45deg,transparent 0 2px,var(--dsw-alias-label-tertiary) 2px 3px))}",
      ".rq-cfg-color{display:inline-flex;gap:8px;align-items:center}",
      ".rq-cfg-color input[type=color]{width:28px;height:28px;border:0;padding:0;background:none;cursor:pointer;border-radius:var(--dsw-radius-xs)}",
      ".rq-cfg-color input[type=color]::-webkit-color-swatch-wrapper{padding:0}",
      ".rq-cfg-color input[type=color]::-webkit-color-swatch{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xs)}",
      '.rq-cfg-color-hex{font-size:12px;font-family:ui-monospace,"SF Mono",Menlo,monospace;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}',
      // Resume effect layer
      ".rq-resume{position:fixed;inset:0;z-index:2147483646;pointer-events:none}",
      ".rq-resume--scan{background:transparent}",
      ".rq-rs-line{position:absolute;left:0;right:0;height:2px;background:var(--dsw-static-deepseek-500);box-shadow:0 0 12px var(--dsw-static-deepseek-500);animation:rq-rs-scan .84s cubic-bezier(.65,0,.35,1) both}",
      ".rq-rs-c{position:absolute;width:18px;height:18px;border:0 solid var(--dsw-static-deepseek-500);opacity:0;animation:rq-rs-corner .42s cubic-bezier(.16,1,.3,1) .12s both}",
      ".rq-rs-c--tl{top:24px;left:24px;border-top-width:1px;border-left-width:1px}",
      ".rq-rs-c--tr{top:24px;right:24px;border-top-width:1px;border-right-width:1px}",
      ".rq-rs-c--bl{bottom:24px;left:24px;border-bottom-width:1px;border-left-width:1px}",
      ".rq-rs-c--br{bottom:24px;right:24px;border-bottom-width:1px;border-right-width:1px}",
      ".rq-rs-tag{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:inline-flex;align-items:center;gap:8px;padding:6px 18px;border:1px solid var(--dsw-static-deepseek-500);font:600 11px/1 ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:.22em;color:var(--dsw-static-deepseek-500);opacity:0;animation:rq-rs-tag .42s cubic-bezier(.16,1,.3,1) .28s both}",
      ".rq-rs-tag b{width:6px;height:6px;background:var(--dsw-static-deepseek-500);animation:rq-rs-blink 1.2s ease-in-out infinite}",
      "@keyframes rq-rs-scan{0%{top:0;opacity:0}10%{opacity:1}90%{opacity:1}100%{top:100%;opacity:0}}",
      "@keyframes rq-rs-corner{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:none}}",
      "@keyframes rq-rs-tag{from{opacity:0;transform:translate(-50%,-50%) scale(.9)}to{opacity:1;transform:translate(-50%,-50%) none}}",
      "@keyframes rq-rs-blink{50%{opacity:.3}}",
      // Iris resume
      ".rq-resume--iris{background:radial-gradient(circle at 50% 50%,transparent 0,transparent 40%,rgba(0,0,0,.7) 100%);animation:rq-ri-veil 1.3s cubic-bezier(.65,0,.35,1) both}",
      ".rq-ri-veil{position:absolute;inset:0;display:grid;place-items:center}",
      ".rq-ri-emblem{width:160px;height:160px;color:var(--dsw-static-deepseek-500);animation:rq-ri-spin 1.3s cubic-bezier(.65,0,.35,1) both}",
      ".rq-ri-hex{stroke:currentColor;stroke-width:3;fill:none;stroke-dasharray:1;stroke-dashoffset:1;animation:rq-ri-draw .8s cubic-bezier(.65,0,.35,1) .2s both}",
      ".rq-ri-seal{stroke:var(--dsw-static-deepseek-500);stroke-width:2;fill:none;stroke-dasharray:1;stroke-dashoffset:1;animation:rq-ri-draw .5s cubic-bezier(.65,0,.35,1) .5s both}",
      ".rq-ri-emblem rect{fill:var(--dsw-static-deepseek-500);opacity:0;animation:rq-ri-core .3s cubic-bezier(.34,1.56,.64,1) .7s both}",
      ".rq-ri-ring{position:absolute;left:50%;top:50%;width:200px;height:200px;margin:-100px 0 0 -100px;fill:none;stroke:var(--dsw-static-deepseek-500);stroke-width:1.5;opacity:0;animation:rq-ri-ping .6s cubic-bezier(.16,1,.3,1) .4s both}",
      "@keyframes rq-ri-veil{0%{opacity:0}20%{opacity:1}80%{opacity:1}100%{opacity:0}}",
      "@keyframes rq-ri-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}",
      "@keyframes rq-ri-draw{to{stroke-dashoffset:0}}",
      "@keyframes rq-ri-core{from{opacity:0;transform:scale(0)}to{opacity:1;transform:none}}",
      "@keyframes rq-ri-ping{0%{opacity:.8;transform:scale(.3)}100%{opacity:0;transform:scale(var(--rq-ri-max,3))}}",
      // Glitch resume
      ".rq-resume--glitch{--rq-rs-ink:var(--dsw-alias-label-primary)}",
      ".rq-rg-flash{position:absolute;inset:0;background:var(--dsw-static-deepseek-500);opacity:0;animation:rq-rg-flash .54s steps(1) both}",
      ".rq-rg-s{position:absolute;left:0;right:0;top:var(--y);height:var(--h);opacity:0;animation:rq-rg-slice .54s steps(1) var(--d,0s) both}",
      ".rq-rg-s--hi{background:rgba(255,255,255,.12);transform:translateX(var(--a))}",
      ".rq-rg-s--dim{background:rgba(0,0,0,.18);transform:translateX(var(--a))}",
      ".rq-rg-s--inv{background:var(--dsw-static-deepseek-500);mix-blend-mode:difference;transform:translateX(var(--a))}",
      ".rq-rg-s--blk{background:#000;transform:translateX(var(--a))}",
      ".rq-rg-l{position:absolute;left:var(--x);top:var(--y);width:var(--w);height:var(--h);background:var(--lc,var(--dsw-static-deepseek-500));opacity:0;animation:rq-rg-line .54s steps(1) var(--d,0s) both}",
      "@keyframes rq-rg-flash{0%{opacity:0}8%{opacity:.7}16%{opacity:0}24%{opacity:.3}40%{opacity:0}100%{opacity:0}}",
      "@keyframes rq-rg-slice{0%{opacity:0}10%{opacity:.9}25%{opacity:.3}45%{opacity:.8}70%{opacity:.2}100%{opacity:0}}",
      "@keyframes rq-rg-line{0%{opacity:0}15%{opacity:1}35%{opacity:.4}60%{opacity:.9}100%{opacity:0}}",
      "@media (prefers-reduced-motion:reduce){.rq-resume *{animation:none!important;transition:none!important}}",
      // Hero backgrounds for the blank conversation page
      ".rq-hero-bg{position:absolute;inset:0;pointer-events:none;z-index:0;opacity:.35}",
      ".rq-hero-bg--hex{background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='97' viewBox='0 0 56 97'%3E%3Cpath d='M28 1 54.5 16v33L28 64 1.5 49V16Z M28 65 54.5 80v16' fill='none' stroke='%23808080' stroke-opacity='.5'/%3E%3C/svg%3E\");background-size:56px 97px}",
      ".rq-hero-bg--scanlines{background:repeating-linear-gradient(to bottom,rgba(200,16,46,.03) 0 1px,transparent 1px 3px)}",
      ".rq-hero-bg--full{background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='97' viewBox='0 0 56 97'%3E%3Cpath d='M28 1 54.5 16v33L28 64 1.5 49V16Z M28 65 54.5 80v16' fill='none' stroke='%23808080' stroke-opacity='.5'/%3E%3C/svg%3E\");background-size:56px 97px;opacity:.5}",
    ].join("");

    function specs() {
      const number = P.settingsNumberField("duration");
      return [
        ...switches.map((field) => ({ field,
          format: (value) => String(typeof value === "boolean" ? value : CONFIG[field] ?? true),
          parse: (text) => ["true", "false"].includes(text) ? { kind: "set", value: text === "true" } : undefined
        })),
        ...[ ["exit", exits], ["intro", intros], ["theme", themes], ["logo", logos],
             ["accent", accents], ["base", bases],
             ["heroBackground", heroBackgrounds], ["resumeEffect", resumeEffects], ["resumeTrigger", resumeTriggers]
        ].map(([field, choices]) => ({ field,
          format: (value) => value ?? CONFIG[field] ?? choices[0],
          parse: (text) => choices.includes(text) ? { kind: "set", value: text } : undefined
        })),
        ...["accentColor", ...texts].map(P.settingsTextField),
        { ...number, parse: (text) => {
          const parsed = number.parse(text);
          return parsed?.kind === "set" && (parsed.value < 0 || parsed.value > 15000) ? undefined : parsed;
        } },
      ];
    }

    // ---- brand slots -------------------------------------------------------

    function Mark({ size }) {
      return CONFIG.brand !== false && BRAND.mark ? jsx("span", {
        className: "rq-brand rq-brand-mark", style: { display: "inline-flex", width: size, height: size },
        dangerouslySetInnerHTML: { __html: BRAND.mark }
      }) : jsx(P.FishLogo, { size });
    }

    function Name() {
      return CONFIG.brand !== false && BRAND.name ? jsx("span", {
        className: "rq-brand rq-brand-name",
        dangerouslySetInnerHTML: { __html: BRAND.name }
      }) : jsx(P.BrandWordmark, { includeMark: false });
    }

    function Hero({ size, className }) {
      return jsx("span", { className: `${className || ""} rq-brand rq-brand-hero`,
        style: { display: "inline-flex", width: size, height: size }, dangerouslySetInnerHTML: { __html: BRAND.hero }
      });
    }

    // ---- settings page ------------------------------------------------------

    function Card(props) {
      const { t } = props;
      const state = props.useRedqueenSplash((snapshot) => snapshot);
      React.useEffect(() => {
        if (props.view !== "summary") return () => props.scheduleSave(0);
      }, []);
      if (props.view === "summary") return t("summary");
      if (!state.available) return jsx("p", { className: "rq-cfg-note", role: "status", children: t("unavailable") });
      const disabled = !state.writable;
      const overriddenKeys = Object.keys(state.fields).filter((key) => state.fields[key].overridden);
      const field = (key) => {
        const value = state.fields[key];
        const id = `redqueen-splash-${key}`;
        const onEdit = (text) => props.edit(key, text);
        if (key === "accent") {
          const current = value.text || CONFIG.accent || "crimson";
          return jsxs("div", { className: "rq-cfg-row", children: [
            jsx("span", { className: "rq-cfg-label", children: t("accent") }),
            jsxs("div", { className: "rq-cfg-swatches", children: accents.map((a) => {
              const color = a === "custom" ? (CONFIG.accentColor || "#c8102e") : ACCENT_COLORS[a];
              return jsx("button", { type: "button", className: "rq-cfg-swatch", "data-accent": a,
                "aria-checked": current === a, style: { "--rq-swatch": color }, disabled,
                onClick: () => { onEdit(a); props.scheduleSave(0); },
                children: [jsx("i", { className: "rq-cfg-swatch-chip" }), t(`ac_${a}`)]
              }, a);
            }) }),
          ] }, key);
        }
        if (key === "accentColor" && (state.fields.accent?.text || CONFIG.accent) !== "custom") return null;
        if (switches.includes(key) || ["exit", "intro", "theme", "logo", "base", "heroBackground", "resumeEffect", "resumeTrigger"].includes(key)) {
          return jsxs("div", { className: "rq-cfg-row", children: [
            jsx("span", { className: "rq-cfg-label", children: t(key) }),
            switches.includes(key) ? jsx(P.Switch, { checked: value.text === "true", label: t(key), disabled,
              onChange: (checked) => { onEdit(String(checked)); props.scheduleSave(0); }
            }) : jsx(P.SegmentedControl, { id, value: value.text, label: t(key), disabled,
              options: (key === "exit" ? exits : key === "intro" ? intros : key === "logo" ? logos : key === "accent" ? accents : key === "base" ? bases : key === "heroBackground" ? heroBackgrounds : key === "resumeEffect" ? resumeEffects : key === "resumeTrigger" ? resumeTriggers : themes).map((choice) => ({ value: choice, label: t(choice) })),
              onChange: (text) => { onEdit(text); props.scheduleSave(0); }
            })
          ] }, key);
        }
        if (key === "accentColor") {
          return jsxs("div", { className: "rq-cfg-field", onBlur: () => props.scheduleSave(0),
            onKeyDown: (event) => { if (event.key === "Enter") props.scheduleSave(0); },
            children: [
              jsx("div", { className: "rq-cfg-row", children: [
                jsx("span", { className: "rq-cfg-label", children: t("accentColor") }),
                jsxs("div", { className: "rq-cfg-color", children: [
                  jsx("input", { type: "color", value: validColor(value.text) ? expandColor(value.text) : "#c8102e",
                    onChange: (e) => { onEdit(e.target.value); props.scheduleSave(0); } }),
                  jsx("span", { className: "rq-cfg-color-hex", children: (value.text || "#c8102e").toUpperCase() }),
                ] }),
              ] }),
            ]
          }, key);
        }
        return jsx("div", { className: "rq-cfg-field", onBlur: () => props.scheduleSave(0),
          onKeyDown: (event) => { if (event.key === "Enter") props.scheduleSave(0); },
          children: jsx(P.SettingsValueField, { id, label: t(key), disabled, ...value, overridden: false,
            numeric: key === "duration",
            invalidLabel: t("invalidNumber"), onEdit
          })
        }, key);
      };
      const group = (title, keys, hint) => jsxs("section", { className: "rq-cfg-section", children: [
        jsx("h3", { className: "rq-cfg-h", children: t(title) }),
        ...keys.map(field).filter(Boolean),
        ...(hint ? [jsx("p", { className: "rq-cfg-hint", children: t(hint) })] : [])
      ] }, title);
      return jsxs("div", { className: "rq-cfg", children: [
        !state.writable && jsx("p", { className: "rq-cfg-note", children: t("readOnly") }),
        group("splash", ["enabled", "intro", "exit", "theme", "duration", "skippable", "replayOnReload"]),
        group("text", ["title", "subtitle", "code", "whisper"], "whisperHint"),
        group("color", ["accentLight", "accentDark"]),
        group("appearance", ["uiTheme", "brand", "logo", "accent", "accentColor", "base", "heroBackground"], "appearanceNote"),
        group("motion", ["resumeEffect", "resumeTrigger"]),
        jsxs("div", { className: "rq-cfg-actions", children: [
          jsxs("button", { type: "button", className: "rq-cfg-preview", onClick: () => props.preview(), children: [jsx("i", {}), t("preview")] }),
          jsxs("button", { type: "button", className: "rq-cfg-preview", onClick: () => props.previewResume?.(), children: [jsx("i", {}), t("previewResume")] }),
          jsx("button", { type: "button", className: "rq-cfg-reset", disabled: !state.writable || !overriddenKeys.length,
            onClick: () => { overriddenKeys.forEach((key) => props.resetField(key)); props.scheduleSave(0); }, children: t("resetAll") }),
          jsx("p", { className: "rq-cfg-hint", children: t("restart") })
        ] }),
        state.failed && jsx("p", { className: "rq-cfg-note", role: "alert", children: t("saveFailed") })
      ] });
    }

    // ---- module body --------------------------------------------------------

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }));
      const t = ctx.locale.bind(NS);

      ctx.effect(() => {
        const style = document.createElement("style");
        style.textContent = CSS;
        document.head.append(style);
        return () => style.remove();
      });

      ctx.slots.inject("sidebar.brand.mark", () => ctx.slots.inject("sidebar.brand.name", function* () {
        yield ctx.slots.register({ name: "sidebar.brand.mark" }, Mark);
        yield ctx.slots.register({ name: "sidebar.brand.name" }, Name);
      }));
      if (CONFIG.brand !== false && BRAND.hero) ctx.slots.inject("conversation.hero.brand.mark", function* () {
        yield ctx.slots.register({ name: "conversation.hero.brand.mark" }, Hero);
      });

      // ---- resume effect ----------------------------------------------------
      const playResume = (kind) => {
        const actual = kind === "random" ? (["scan", "iris", "glitch"])[Math.floor(Math.random() * 3)] : kind;
        if (actual === "off" || !actual) return;
        const ms = RESUME_MS[actual] || 840;
        const layer = resumeLayer(document, actual);
        document.body.appendChild(layer);
        setTimeout(() => layer.remove(), ms + 100);
      };

      // Visibility-based resume trigger
      const resumeTrigger = CONFIG.resumeTrigger || "away";
      const resumeEffect = CONFIG.resumeEffect || "random";
      if (resumeEffect !== "off") {
        let awaySince = 0;
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "hidden") {
            awaySince = Date.now();
          } else if (document.visibilityState === "visible") {
            const awayMs = Date.now() - awaySince;
            const shouldPlay = resumeTrigger === "always"
              || (resumeTrigger === "away" && awayMs > 30000)
              || (resumeTrigger === "hidden" && awayMs > 5000);
            if (shouldPlay) playResume(resumeEffect);
          }
        });
      }

      const scope = ctx.configForms.get("redqueen-splash");
      const form = new P.SettingsFormModel(scope, specs());
      let saveTimer = 0;
      const autoSave = () => {
        clearTimeout(saveTimer);
        const shell = form.shell();
        if (shell.available && shell.writable && shell.dirty && !shell.invalid && !shell.saving && !shell.failed) form.save();
      };
      const scheduleSave = (delay = 0) => { clearTimeout(saveTimer); saveTimer = setTimeout(autoSave, delay); };
      const previewSplash = () => {
        const value = { ...CONFIG, ...(scope.getSnapshot().value || {}) };
        for (const spec of specs()) {
          const write = spec.parse(form.field(spec.field).text);
          if (write?.kind === "set") value[spec.field] = write.value;
        }
        globalThis.__redqueenSplash?.replay({ ...value, enabled: true });
      };
      const previewResume = () => {
        const effect = scope.getSnapshot().value?.resumeEffect ?? CONFIG.resumeEffect ?? "random";
        playResume(effect);
      };
      const fields = specs().map((spec) => spec.field);
      const store = form.bind(() => ({ ...form.shell(), fields: Object.fromEntries(fields.map((key) => [key, form.field(key)])) }));
      let wasSaving = false;
      ctx.effect(() => store.subscribe(() => {
        const shell = form.shell();
        if (wasSaving && !shell.saving && shell.dirty && !shell.failed) scheduleSave(0);
        wasSaving = shell.saving;
      }));
      ctx.effect(() => () => clearTimeout(saveTimer));
      ctx.effect(() => () => form.dispose());
      ctx.effect(() => ctx.configForms.whileServed(["redqueen-splash"], () => ctx.slots.inject("plugins.row.config", () => ctx.slots.register({
        name: "plugins.row.config", key: "dsh-redqueen-splash#redqueen-splash", locale: NS,
        inject: () => ({ hooks: { redqueenSplash: store }, ...form.actions(), scheduleSave, preview: () => previewSplash(), previewResume: () => previewResume() })
      }, Card))));

      const current = (field) => scope.getSnapshot().value?.[field] ?? CONFIG[field];
      const option = (id, label, group, field, value) => ({ id, label: t(label),
        group: { name: group, label: t(group) },
        ...(field ? { active: current(field) === value } : {}), detail: t("restart")
      });
      ctx.effect(() => ctx.commandUi.register({
        name: "redqueen", label: () => t("command"), description: () => t("commandDescription"), icon: P.IconPlayOutlineRegular,
        ui: { kind: "popupSelect", searchMode: "fuzzy-label",
          searchLabels: () => ({ placeholder: t("search"), empty: t("empty"), noResults: t("noResults") }),
          options: async () => {
            const rows = [option("preview", "previewNow", "actions")];
            if (scope.getSnapshot().status !== "ready" || !scope.getSnapshot().writable) return rows;
            rows.push(option("enabled:true", "on", "splash", "enabled", true), option("enabled:false", "off", "splash", "enabled", false));
            for (const intro of intros) rows.push(option(`intro:${intro}`, intro, "splash", "intro", intro));
            for (const exit of exits) rows.push(option(`exit:${exit}`, exit, "splash", "exit", exit));
            for (const field of ["uiTheme", "brand"]) for (const value of [true, false]) rows.push(option(`${field}:${value}`, `${field}${value ? "On" : "Off"}`, "appearance", field, value));
            for (const logo of logos) rows.push(option(`logo:${logo}`, `logo${logo[0].toUpperCase()}${logo.slice(1)}`, "appearance", "logo", logo));
            for (const accent of accents) rows.push(option(`accent:${accent}`, `ac_${accent}`, "appearance", "accent", accent));
            for (const base of bases) rows.push(option(`base:${base}`, `bs_${base}`, "appearance", "base", base));
            return rows;
          },
          onSelect: async (selected) => {
            if (selected.id === "preview") { previewSplash(); return; }
            const [field, raw] = selected.id.split(":");
            const enumFields = { exit: exits, intro: intros, logo: logos, accent: accents, base: bases };
            const boolFields = ["enabled", "uiTheme", "brand"];
            if (!(enumFields[field] ? enumFields[field].includes(raw) : boolFields.includes(field) && ["true", "false"].includes(raw))) return;
            const commandForm = new P.SettingsFormModel(scope, specs());
            try {
              commandForm.actions().edit(field, raw);
              await commandForm.save();
              if (commandForm.shell().failed || commandForm.shell().dirty) throw new Error(t("saveFailed"));
            } finally { commandForm.dispose(); }
          }
        }
      }));
    }

    module.exports = { inject: ["slots", "locale", "configForms", "commandUi"], apply };
    return module.exports;
  }
});
