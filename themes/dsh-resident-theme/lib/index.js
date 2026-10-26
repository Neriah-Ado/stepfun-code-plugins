import { readFileSync } from 'node:fs';

let z;
try { z = (await import('@deepseek-ai/schemastery')).default } catch { z = undefined }

/** Cordis host plugin name. */
export const name = 'redqueen-splash';

/**
 * @typedef {object} SplashConfig
 * @property {boolean} enabled Whether to play on launch.
 * @property {boolean} uiTheme Whether to inject the Red Queen interface theme.
 * @property {boolean} brand Whether to replace brand artwork.
 * @property {'octagon' | 'eye' | 'seal'} logo Brand logo scheme.
 * @property {'crimson' | 'biohazard' | 't-virus' | 'umbrella' | 'custom'} accent 强调色
 * @property {string} accentColor 自定义强调色
 * @property {'clinical' | 'carbon' | 'official'} base 底色
 * @property {'random' | 'hex' | 'scanlines' | 'full' | 'off'} heroBackground Blank conversation page background.
 * @property {'random' | 'scan' | 'iris' | 'glitch' | 'off'} resumeEffect Effect played when the window comes back from the background.
 * @property {'away' | 'always' | 'hidden'} resumeTrigger When a return from the background plays the effect.
 * @property {string} title Main heading.
 * @property {string} subtitle Secondary heading.
 * @property {string} code Corner HUD identifier.
 * @property {string} whisper Ghost message flashed before the exit.
 * @property {string} accentLight Accent color for light mode.
 * @property {string} accentDark Accent color for dark mode.
 * @property {'auto' | 'light' | 'dark'} theme Theme selection.
 * @property {'random' | 'hive' | 'scan' | 'system' | 'lockdown'} intro Boot intro variant.
 * @property {'random' | 'wipe' | 'blast' | 'purge' | 'signal' | 'iris'} exit Exit animation.
 * @property {number} duration Minimum on-screen time in milliseconds.
 * @property {number} maxWait Maximum wait in milliseconds.
 * @property {boolean} skippable Whether clicking can skip the animation.
 * @property {boolean} replayOnReload Whether reloading replays the animation.
 */

/** @type {Readonly<SplashConfig>} Default configuration shared with the bundle patch. */
export const DEFAULTS = Object.freeze({
  enabled: true,
  uiTheme: true,
  brand: true,
  logo: 'octagon',
  accent: 'crimson',
  accentColor: '#c8102e',
  base: 'clinical',
  heroBackground: 'random',
  resumeEffect: 'random',
  resumeTrigger: 'away',
  title: 'DEEPSEEK HARNESS',
  subtitle: 'RED QUEEN MAINFRAME · SECURITY & SURVEILLANCE DIVISION',
  code: 'RQ-DSH/0.1',
  whisper: 'YOU ARE ALL GOING TO DIE DOWN HERE.',
  accentLight: '#c8102e',
  accentDark: '#ff3348',
  theme: 'auto',
  intro: 'random',
  exit: 'wipe',
  duration: 4000,
  maxWait: 8000,
  skippable: true,
  replayOnReload: false,
});

export const ACCENTS = Object.freeze({
  crimson: ['#c8102e', '#ff3348'],
  biohazard: ['#a4c639', '#c8e639'],
  't-virus': ['#7b2d8e', '#a855c7'],
  umbrella: ['#d42027', '#f04048'],
});

export const Config = z ? z.object({
  enabled: z.boolean().default(DEFAULTS.enabled).volatile().description('开屏动画开关'),
  exit: z.union(['random', 'wipe', 'blast', 'purge', 'signal', 'iris']).default(DEFAULTS.exit).volatile().description('退场动画'),
  intro: z.union(['random', 'hive', 'scan', 'system', 'lockdown']).default(DEFAULTS.intro).volatile().description('启动动画'),
  theme: z.union(['auto', 'light', 'dark']).default(DEFAULTS.theme).volatile().description('开屏主题'),
  duration: z.number().min(0).max(15000).step(100).default(DEFAULTS.duration).volatile().description('显示时长（毫秒）'),
  maxWait: z.number().min(0).max(20000).step(100).default(DEFAULTS.maxWait).volatile().description('最长等待（毫秒）'),
  title: z.string().default(DEFAULTS.title).volatile().description('主标题'),
  subtitle: z.string().default(DEFAULTS.subtitle).volatile().description('副标题'),
  code: z.string().default(DEFAULTS.code).volatile().description('角落编号'),
  whisper: z.string().default(DEFAULTS.whisper).volatile().description('幽灵提示语（留空则不显示）'),
  accentLight: z.string().default(DEFAULTS.accentLight).volatile().description('浅色强调色'),
  accentDark: z.string().default(DEFAULTS.accentDark).volatile().description('深色强调色'),
  skippable: z.boolean().default(DEFAULTS.skippable).volatile().description('允许跳过'),
  replayOnReload: z.boolean().default(DEFAULTS.replayOnReload).volatile().description('刷新时重播'),
  uiTheme: z.boolean().default(DEFAULTS.uiTheme).volatile().description('红后界面主题'),
  brand: z.boolean().default(DEFAULTS.brand).volatile().description('品牌替换'),
  logo: z.union(['octagon', 'eye', 'seal']).default(DEFAULTS.logo).volatile().description('Logo 方案'),
  accent: z.union(['crimson', 'biohazard', 't-virus', 'umbrella', 'custom']).default(DEFAULTS.accent).volatile().description('强调色'),
  accentColor: z.string().default(DEFAULTS.accentColor).volatile().description('自定义强调色'),
  base: z.union(['clinical', 'carbon', 'official']).default(DEFAULTS.base).volatile().description('底色'),
  heroBackground: z.union(['random', 'hex', 'scanlines', 'full', 'off']).default(DEFAULTS.heroBackground).volatile().description('空白页背景'),
  resumeEffect: z.union(['random', 'scan', 'iris', 'glitch', 'off']).default(DEFAULTS.resumeEffect).volatile().description('切回动效'),
  resumeTrigger: z.union(['away', 'always', 'hidden']).default(DEFAULTS.resumeTrigger).volatile().description('切回触发'),
}) : undefined;

/** Unwrap volatile settings at the point of use. */
export function readConfig(config) {
  const values = {};
  for (const key of Object.keys(DEFAULTS)) {
    const v = config?.[key];
    values[key] = v && typeof v.get === 'function' ? v.get() : v;
  }
  return resolveConfig(values);
}

/**
 * Normalize user configuration without retaining unknown keys or mutating input.
 * Invalid types and enum/color values use defaults; finite timings are clamped.
 *
 * @param {unknown} [input] User-supplied Cordis configuration.
 * @returns {SplashConfig} A fresh, plain configuration object.
 */
export function resolveConfig(input) {
  const source = input !== null && typeof input === 'object' && !Array.isArray(input)
    ? input
    : {};
  const resolved = { ...DEFAULTS };

  if (typeof source.logo === 'string') {
    const logo = source.logo.trim();
    if (['octagon', 'eye', 'seal'].includes(logo)) resolved.logo = logo;
  }

  if (typeof source.intro === 'string') {
    const intro = source.intro.trim();
    if (['random', 'hive', 'scan', 'system', 'lockdown'].includes(intro)) resolved.intro = intro;
  }

  for (const [key, choices] of [['accent', [...Object.keys(ACCENTS), 'custom']], ['base', ['clinical', 'carbon', 'official']]]) {
    if (typeof source[key] === 'string' && choices.includes(source[key].trim())) resolved[key] = source[key].trim();
  }
  const validColor = (value) => typeof value === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
  if (validColor(source.accentColor)) resolved.accentColor = source.accentColor;

  for (const key of ['title', 'subtitle', 'code', 'whisper']) {
    if (typeof source[key] === 'string') {
      resolved[key] = source[key].trim().slice(0, 80);
    }
  }

  for (const key of ['accentLight', 'accentDark']) {
    if (typeof source[key] === 'string') {
      const color = source[key].trim();
      if (/^#[0-9a-fA-F]{3,8}$/.test(color)) resolved[key] = color;
    }
  }

  if (typeof source.theme === 'string') {
    const theme = source.theme.trim();
    if (['auto', 'light', 'dark'].includes(theme)) resolved.theme = theme;
  }

  if (typeof source.exit === 'string') {
    const exit = source.exit.trim();
    if (['random', 'wipe', 'blast', 'purge', 'signal', 'iris'].includes(exit)) resolved.exit = exit;
  }

  if (typeof source.heroBackground === 'string') {
    const heroBackground = source.heroBackground.trim();
    if (['random', 'hex', 'scanlines', 'full', 'off'].includes(heroBackground)) resolved.heroBackground = heroBackground;
  }

  if (typeof source.resumeEffect === 'string') {
    const resumeEffect = source.resumeEffect.trim();
    if (['random', 'scan', 'iris', 'glitch', 'off'].includes(resumeEffect)) resolved.resumeEffect = resumeEffect;
  }

  if (typeof source.resumeTrigger === 'string') {
    const resumeTrigger = source.resumeTrigger.trim();
    if (['away', 'always', 'hidden'].includes(resumeTrigger)) resolved.resumeTrigger = resumeTrigger;
  }

  const duration = typeof source.duration === 'number' && Number.isFinite(source.duration)
    ? source.duration
    : DEFAULTS.duration;
  resolved.duration = Math.min(15000, Math.max(0, duration));

  const maxWait = typeof source.maxWait === 'number' && Number.isFinite(source.maxWait)
    ? source.maxWait
    : DEFAULTS.maxWait;
  resolved.maxWait = Math.min(20000, Math.max(resolved.duration, maxWait));

  for (const key of ['enabled', 'uiTheme', 'brand', 'skippable', 'replayOnReload']) {
    if (typeof source[key] === 'boolean') resolved[key] = source[key];
  }

  return resolved;
}

// The shipped brand artwork only needs this subset of SVG/HTML. Any tag or
// attribute outside it means the file changed unexpectedly (tampered remote
// install source), so the whole asset is dropped rather than injected.
const BRAND_TAGS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'path', 'circle', 'ellipse', 'rect', 'line',
  'polyline', 'polygon', 'lineargradient', 'radialgradient', 'stop', 'clippath',
  'mask', 'text', 'tspan', 'title', 'desc', 'span', 'b', 'i', 'em', 'strong',
  'small', 'u', 's', 'br',
]);
const BRAND_ATTRIBUTES = new Set([
  'viewbox', 'width', 'height', 'xmlns', 'class', 'style', 'id', 'role',
  'aria-hidden', 'aria-label', 'focusable', 'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'paint-order',
  'text-anchor', 'dominant-baseline', 'font-family', 'font-size', 'font-weight',
  'letter-spacing', 'clip-rule', 'clip-path', 'mask', 'opacity', 'transform', 'd', 'cx', 'cy', 'r',
  'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'points', 'offset', 'stop-color',
  'stop-opacity', 'gradientunits', 'gradienttransform', 'preserveaspectratio',
]);
const BRAND_TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9:-]*)((?:\s+[A-Za-z_:][-A-Za-z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
const BRAND_ATTR_RE = /([A-Za-z_:][-A-Za-z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * True when brand markup consists only of allowlisted tags/attributes.
 * Fails closed: unparseable input or any unknown construct returns false.
 *
 * @param {unknown} html Markup loaded from `lib/brand/*`.
 * @returns {boolean} Whether the markup is safe to inject.
 */
export function isAllowedBrandMarkup(html) {
  if (typeof html !== 'string') return false;
  if (html === '') return true;

  let index = 0;
  while (index < html.length) {
    const next = html.indexOf('<', index);
    if (next !== index) {
      // Text run: a stray `<` here would be interpreted as markup by the parser.
      if (html.slice(index, next === -1 ? undefined : next).includes('<')) return false;
      if (next === -1) return true;
    }
    BRAND_TAG_RE.lastIndex = next;
    const tag = BRAND_TAG_RE.exec(html);
    if (!tag) return false;
    const [, closing, rawName, rawAttributes] = tag;
    const name = rawName.toLowerCase();
    if (!BRAND_TAGS.has(name)) return false;
    if (closing) {
      if (rawAttributes.trim()) return false; // `</tag attr>` is not valid markup
      index = next + tag[0].length;
      continue;
    }

    let cursor = 0;
    let attribute;
    BRAND_ATTR_RE.lastIndex = 0;
    while ((attribute = BRAND_ATTR_RE.exec(rawAttributes))) {
      if (rawAttributes.slice(cursor, attribute.index).trim()) return false;
      cursor = attribute.index + attribute[0].length;
      const attrName = attribute[1].toLowerCase();
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
      if (!BRAND_ATTRIBUTES.has(attrName) || attrName.startsWith('on')) return false;
      // Entities could re-encode a URL scheme, so no entity references in values.
      if (value.includes('&')) return false;
      if (/(?:javascript|vbscript|data)\s*:/i.test(value)) return false;
      // Only same-document fragment references (gradients, masks) are allowed.
      if (/url\s*\(\s*['"]?(?!#)/i.test(value)) return false;
      if (attrName === 'style' && /expression|@import|behavior|javascript:/i.test(value)) return false;
    }
    if (rawAttributes.slice(cursor).trim()) return false;
    index = next + tag[0].length;
  }
  return true;
}

/**
 * Build host injection rows for both the web and desktop profiles.
 * Escape inline HTML terminators and JavaScript line separators in configuration.
 *
 * Brand markup is validated against a strict allowlist before it reaches
 * `dangerouslySetInnerHTML` in the browser half: the artwork ships inside this
 * bundle, but the bundle can be installed from a remote source, so treat it as
 * untrusted input. Anything outside the allowlist is replaced with an empty
 * string, which makes the UI fall back to the official brand marks.
 *
 * @param {SplashConfig} config Resolved configuration.
 * @param {{ css: string, js: string, themeCss?: string, brand?: {mark: string, hero: string, name: string} }} assets Loaded sources.
 * @returns {Array<{kind: 'style', text: string} | {kind: 'script', placement: 'body', text: string}>}
 */
export function buildInjections(config, assets) {
  const safeJson = (value) => JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const safeStyle = (css) => css.replace(/<\/style/gi, '<\\/style');
  const brand = assets.brand || {};
  const cleanBrand = {
    mark: isAllowedBrandMarkup(brand.mark) ? brand.mark : '',
    hero: isAllowedBrandMarkup(brand.hero) ? brand.hero : '',
    name: isAllowedBrandMarkup(brand.name) ? brand.name : '',
  };

  return [
    ...(config.uiTheme && assets.themeCss ? [{ kind: 'style', text: safeStyle(assets.themeCss) }] : []),
    { kind: 'style', text: safeStyle(assets.css) },
    {
      kind: 'script',
      placement: 'body',
      text: 'globalThis.__RQ_BRAND__=' + safeJson(cleanBrand)
        + ';globalThis.__RQ_SPLASH__=' + safeJson(config) + ';\n'
        + '(function(c){var root=document.documentElement;root.toggleAttribute("data-rq-ui",c.uiTheme!==false);root.dataset.rqAccent=c.accent||"crimson";root.dataset.rqBase=c.base||"clinical";if(c.accent==="custom")root.style.setProperty("--rq-accent-custom",c.accentColor);else root.style.removeProperty("--rq-accent-custom");})(globalThis.__RQ_SPLASH__);\n' + assets.js,
    },
  ];
}

/** Report unavailable assets while allowing hosts without a logger to start. */
function warn(ctx, message) {
  try {
    const logger = ctx.logger?.('redqueen-splash');
    if (typeof logger?.warn === 'function') {
      logger.warn(message);
      return;
    }
  } catch {
    // Logging support is optional and must not prevent host startup.
  }
  console.warn(message);
}

/**
 * Register the host half of the splash plugin. Assets are read once at apply
 * time and reused on every index injection; live config is read on each emission.
 *
 * @param {object} ctx Cordis context providing on() and an optional logger().
 * @param {unknown} [config] User-supplied configuration.
 * @returns {void}
 */
export function apply(ctx, config) {
  if (typeof ctx.inject === 'function') ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });

  let assets;
  try {
    assets = {
      css: readFileSync(new URL('./splash.css', import.meta.url), 'utf8'),
      js: readFileSync(new URL('./splash.js', import.meta.url), 'utf8'),
    };
  } catch (error) {
    warn(ctx, `Unable to load Red Queen splash assets; injection disabled. ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const missingExtras = [];
  const optionalText = (filename, { quiet = false } = {}) => {
    try { return readFileSync(new URL(filename, import.meta.url), 'utf8'); }
    catch { if (!quiet) missingExtras.push(filename); return ''; }
  };
  assets.themeCss = optionalText('./theme.css');
  // Brand files are local, but a remote install source means the shipped
  // markup must not be trusted blindly; validate once so tampering is reported.
  // buildInjections re-validates at the injection point (defense in depth).
  const rejectedBrand = [];
  const validatedBrand = (markup, filename) => {
    if (!markup || isAllowedBrandMarkup(markup)) return markup;
    rejectedBrand.push(filename);
    return '';
  };
  const marks = {
    octagon: validatedBrand(optionalText('./brand/mark-octagon.svg'), 'mark-octagon.svg'),
    eye: validatedBrand(optionalText('./brand/mark-eye.svg'), 'mark-eye.svg'),
    seal: validatedBrand(optionalText('./brand/mark-seal.svg'), 'mark-seal.svg'),
  };
  const heroes = {
    // Hero artwork is optional per scheme (the mark is reused), so its
    // absence is not worth a startup warning.
    octagon: validatedBrand(optionalText('./brand/hero-octagon.svg', { quiet: true }), 'hero-octagon.svg'),
    eye: validatedBrand(optionalText('./brand/hero-eye.svg', { quiet: true }), 'hero-eye.svg'),
    seal: validatedBrand(optionalText('./brand/hero-seal.svg', { quiet: true }), 'hero-seal.svg'),
  };
  assets.brandName = validatedBrand(optionalText('./brand/name.html'), 'name.html');
  if (missingExtras.length) warn(ctx, `Unable to load optional Red Queen UI assets: ${missingExtras.join(', ')}.`);
  if (rejectedBrand.length) warn(ctx, `Ignoring Red Queen brand assets with markup outside the allowlist: ${rejectedBrand.join(', ')}.`);

  // Append after theme bootstrap rows: do not pass Cordis's prepend option.
  ctx.on('webserver/index-inject', (table) => {
    const resolved = readConfig(config);
    const { logo } = resolved;
    const brand = { mark: marks[logo], hero: heroes[logo] || marks[logo], name: assets.brandName };
    table.push(...buildInjections(resolved, { ...assets, brand }));
  });
}
