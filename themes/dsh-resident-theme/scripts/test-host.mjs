/**
 * Offline checks for dsh-redqueen-splash. No network, no build step.
 *
 *  1. Syntax-check every shipped JS file the way Node parses it.
 *  2. Import lib/index.js and unit-test config resolution and injection
 *     building against a mock Cordis context (real asset files on disk).
 *  3. Run lib/client.js inside a mocked module loader and verify the
 *     registrations (brand slots, config page, /redqueen command, locale).
 *  4. Assert the BEAT block in lib/splash.js matches --B/--G/--R in
 *     lib/splash.css.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lib = join(root, 'lib');
let failures = 0;
const ok = (label, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) failures++;
};

// ---- 1. syntax checks ------------------------------------------------------
// In-process only: no child processes, so the check also runs in restricted
// environments. index.js is ESM and is proven parseable by the dynamic
// import below; the two injected scripts compile via new Function.

const host = await import(new URL(`file:///${join(lib, 'index.js').replace(/\\/g, '/')}`));

const sourceOf = (file) => readFileSync(join(root, file), 'utf8');
ok('syntax: lib/index.js (via import)', typeof host.buildInjections === 'function');
for (const file of ['lib/splash.js', 'lib/client.js']) {
  try {
    // Compiles without executing — a SyntaxError throws here.
    new Function(sourceOf(file));
    ok(`syntax: ${file}`, true);
  } catch (error) {
    ok(`syntax: ${file}`, false);
    console.error(error);
  }
}

// ---- 2. host half ----------------------------------------------------------

ok('host: plugin name', host.name === 'redqueen-splash');
ok('host: defaults frozen', Object.isFrozen(host.DEFAULTS));
ok('host: config schema optional', host.Config === undefined);

const resolved = host.resolveConfig({
  logo: 'eye',
  exit: 'iris',
  intro: 'lockdown',
  whisper: '  TEST  ',
  duration: 99999,
  maxWait: 10,
  accentLight: 'nope',
  unknownKey: true,
});
ok('host: logo normalized', resolved.logo === 'eye');
ok('host: intro normalized', resolved.intro === 'lockdown');
ok('host: bad intro rejected',
  host.resolveConfig({ intro: 'bogus' }).intro === host.DEFAULTS.intro);
ok('host: text trimmed', resolved.whisper === 'TEST');
ok('host: duration clamped', resolved.duration === 15000);
ok('host: maxWait >= duration', resolved.maxWait >= resolved.duration);
ok('host: bad color rejected', resolved.accentLight === host.DEFAULTS.accentLight);
ok('host: unknown key dropped', !('unknownKey' in resolved));

const injections = host.buildInjections(
  { ...host.DEFAULTS, uiTheme: true },
  { css: '/*splash*/', js: '/*boot*/', themeCss: '/*theme*/', brand: { mark: '<svg/>', hero: '<svg/>', name: '<b/>' } }
);
ok('host: three injection rows', injections.length === 3);
ok('host: theme row first', injections[0].kind === 'style' && injections[0].text === '/*theme*/');
const scriptRow = injections[2];
ok('host: script row shape', scriptRow.kind === 'script' && scriptRow.placement === 'body');
ok('host: brand global present', scriptRow.text.startsWith('globalThis.__RQ_BRAND__='));
ok('host: splash config present', scriptRow.text.includes('__RQ_SPLASH__='));
ok('host: html terminators escaped', !scriptRow.text.includes('</script'));
ok('host: no raw config injection without uiTheme',
  host.buildInjections({ ...host.DEFAULTS, uiTheme: false }, { css: 'c', js: 'j', themeCss: 't' }).length === 2);

// ---- 2b. brand markup allowlist (D-01) -------------------------------------
// The brand HTML reaches dangerouslySetInnerHTML in the browser half, so the
// host validates it against an allowlist and fails closed (asset becomes '').

ok('brand: shipped SVG mark accepted',
  host.isAllowedBrandMarkup('<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M0 0" fill="currentColor"/></svg>'));
ok('brand: shipped name.html markup accepted',
  host.isAllowedBrandMarkup('<b style="font-weight:800">DEEPSEEK</b><span>HARNESS</span><i style="display:inline-block"></i>'));
for (const asset of ['mark-octagon.svg', 'mark-eye.svg', 'mark-seal.svg', 'name.html']) {
  ok(`brand: shipped ${asset} passes allowlist`,
    host.isAllowedBrandMarkup(readFileSync(join(lib, 'brand', asset), 'utf8')));
}
ok('brand: script tag rejected', !host.isAllowedBrandMarkup('<svg><script>alert(1)</script></svg>'));
ok('brand: event handler rejected', !host.isAllowedBrandMarkup('<svg onload="alert(1)"/>'));
ok('brand: foreignObject rejected', !host.isAllowedBrandMarkup('<svg><foreignObject><img src="x"/></foreignObject></svg>'));
ok('brand: unknown tag rejected', !host.isAllowedBrandMarkup('<iframe src="https://x.example"></iframe>'));
ok('brand: javascript: URL rejected', !host.isAllowedBrandMarkup('<svg><use href="javascript:alert(1)"/></svg>'));
ok('brand: entity-encoded scheme rejected',
  !host.isAllowedBrandMarkup('<svg><use href="java&#115;cript:alert(1)"/></svg>'));
ok('brand: external CSS url rejected',
  !host.isAllowedBrandMarkup('<span style="background:url(https://x.example/a.png)"></span>'));
ok('brand: unparseable markup rejected', !host.isAllowedBrandMarkup('<svg><g></svg> trailing <'));
const dirty = host.buildInjections(
  { ...host.DEFAULTS },
  { css: 'c', js: 'j', brand: { mark: '<svg onload="x()"/>', hero: '<svg/>', name: '<script>x()</script>' } }
);
const dirtyBrand = JSON.parse(/__RQ_BRAND__=(.*?);globalThis.__RQ_SPLASH__/.exec(dirty.at(-1).text)[1]);
ok('brand: unsafe mark dropped at injection', dirtyBrand.mark === '');
ok('brand: unsafe name dropped at injection', dirtyBrand.name === '');
ok('brand: safe hero kept at injection', dirtyBrand.hero === '<svg/>');

const events = [];
const warnings = [];
const ctx = {
  on(event, handler) { events.push([event, handler]); },
  inject() {},
  logger() { return { warn: (message) => warnings.push(message) }; },
};
host.apply(ctx, {});
const injectHandlers = events.filter(([event]) => event === 'webserver/index-inject');
ok('host: index-inject subscribed', injectHandlers.length === 1);
ok('host: no asset warnings', warnings.length === 0);
const table = [];
injectHandlers[0][1](table);
ok('host: injections pushed', table.length === 3 && table[2].text.includes('__RQ_BRAND__'));
ok('host: brand name.html loaded', /__RQ_BRAND__=(\{)/.test(table[2].text));

// ---- 3. client half ---------------------------------------------------------

const registrations = [];
const slots = [];
const registeredEntries = [];
const localeBundles = [];
let localeBound = null;
const commandRegistrations = [];
const styles = [];
const effects = [];

const reactStub = {
  useState: () => [undefined, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useCallback: (fn) => fn,
  useSyncExternalStore: () => undefined,
};
const jsxRuntimeStub = {
  jsx: (type, props) => ({ type, props }),
  jsxs: (type, props) => ({ type, props }),
};
// A SettingsFormModel stub with just the surface client.js touches.
const formStub = () => ({
  shell: () => ({ available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }),
  field: (key) => ({ text: '', overridden: false }),
  bind: (read) => ({ subscribe: () => () => {}, getSnapshot: read }),
  actions: () => ({ edit: () => {}, resetField: () => {} }),
  save: async () => {},
  dispose: () => {},
});
const primitivesStub = new Proxy({}, {
  get(target, key) {
    if (key === 'settingsNumberField' || key === 'settingsTextField') {
      return (field) => ({ field, parse: () => undefined });
    }
    if (key === 'SettingsFormModel') return function () { return formStub(); };
    return target[key] ?? function () {};
  },
});
const ctxClient = {
  effect(fn) { effects.push(fn(() => {})); },
  locale: {
    register: (ns, bundle) => localeBundles.push([ns, bundle]),
    bind: (ns) => { localeBound = ns; return (key) => key; },
  },
  slots: {
    inject(path, factory) {
      slots.push(path);
      const value = factory();
      if (value && typeof value.next === 'function') {
        for (const step of value) {
          if (step?.options) registeredEntries.push([path, step.options]);
        }
      } else if (value?.options) {
        registeredEntries.push([path, value.options]);
      }
    },
    register: (options) => ({ options }),
    entries: () => [],
  },
  configForms: {
    get: () => ({
      getSnapshot: () => ({ status: 'ready', writable: true, value: {} }),
    }),
    whileServed: (ids, register) => register(),
  },
  commandUi: { register: (registration) => commandRegistrations.push(registration) },
};

const clientSource = readFileSync(join(lib, 'client.js'), 'utf8');
// The style effect touches document at apply time; stub it for the test.
const realDocument = globalThis.document;
globalThis.document = { createElement: () => ({ textContent: '' }), head: { append: () => {} } };
const loaderStubs = {
  react: reactStub,
  'react/jsx-runtime': jsxRuntimeStub,
  '@deepseek-ai/dsh-client-ui-primitives': primitivesStub,
};
const windowMock = {
  __ModuleLoader__: {
    load: (registration) => {
      registrations.push(registration);
      return registration.factory((name) => {
        if (!(name in loaderStubs)) throw new Error(`unexpected require: ${name}`);
        return loaderStubs[name];
      });
    },
  },
};
new Function('window', 'globalThis', clientSource)(windowMock, globalThis);

ok('client: one registration', registrations.length === 1);
ok('client: registration id', registrations[0]?.id === 'dsh-redqueen-splash');
const clientExports = registrations[0]?.factory;
ok('client: factory returns exports', typeof clientExports === 'function');
const exported = (() => {
  let captured;
  const loader = { __ModuleLoader__: { load: (registration) => { captured = registration.factory((name) => loaderStubs[name]); } } };
  new Function('window', 'globalThis', clientSource)(loader, globalThis);
  return captured;
})();
ok('client: inject list', Array.isArray(exported.inject) && exported.inject.includes('slots'));
ok('client: apply export', typeof exported.apply === 'function');

exported.apply(ctxClient);
globalThis.document = realDocument;
ok('client: locale registered', localeBundles.length === 1 && localeBundles[0][0] === 'redqueenSplash');
const [, bundle] = localeBundles[0];
ok('client: zh/en dictionaries', typeof bundle.zh === 'object' && typeof bundle.en === 'object');
ok('client: locale key parity',
  Object.keys(bundle.zh).length > 0 && Object.keys(bundle.zh).join() === Object.keys(bundle.en).join());
ok('client: locale bound', localeBound === 'redqueenSplash');

const slotPaths = [...new Set(slots)];
for (const expected of ['sidebar.brand.mark', 'sidebar.brand.name', 'plugins.row.config']) {
  ok(`client: slot ${expected}`, slotPaths.includes(expected));
}
// The mock environment injects no brand data, so the hero slot must stay
// unregistered (it only appears when the host provided __RQ_BRAND__.hero).
ok('client: hero slot requires injected brand data', !slotPaths.includes('conversation.hero.brand.mark'));
ok('client: /redqueen command', commandRegistrations.length === 1 && commandRegistrations[0].name === 'redqueen');
const command = commandRegistrations[0];
const options = await command.ui.options();
ok('client: command has preview option', options.some((row) => row.id === 'preview'));
ok('client: command exit options', options.some((row) => row.id === 'exit:iris'));
ok('client: command intro options', options.some((row) => row.id === 'intro:lockdown'));
ok('client: command seal logo option', options.some((row) => row.id === 'logo:seal'));

// ---- 4. beat sync -----------------------------------------------------------

const splashJs = readFileSync(join(lib, 'splash.js'), 'utf8');
const splashCss = readFileSync(join(lib, 'splash.css'), 'utf8');
const beatJs = JSON.parse('{' + splashJs.match(/const BEAT = \{([^}]+)\}/)[1]
  .replace(/(\w+):/g, '"$1":') + '}');
const cssValue = (name) => {
  const match = splashCss.match(new RegExp(`--${name}:\\s*(\\d+)`));
  return match ? Number(match[1]) : null;
};
ok('beats: --B matches BEAT.b', cssValue('B') === beatJs.b);
ok('beats: --G matches BEAT.uplink', cssValue('G') === beatJs.uplink);
ok('beats: --R matches BEAT.ready', cssValue('R') === beatJs.ready);
ok('beats: exit registry complete', ['wipe', 'blast', 'purge', 'signal', 'iris'].every((name) => splashJs.includes(`${name}:`)));
ok('exit: wipe bands bind in css', splashCss.includes('rq-wipe-band') && splashCss.includes('.rq-wipe i'));
ok('acts: finished acts leave the paint tree',
  splashJs.includes('is-seal-done') && splashJs.includes('is-actb')
  && splashCss.includes('is-seal-done .rq-seal') && splashCss.includes('is-actb .rq-access'));
ok('intro: registry complete', ['hive', 'scan', 'system', 'lockdown'].every((name) => splashJs.includes(`${name}: {`)));
ok('intro: rotation excludes the previous one', splashJs.includes('redqueen-splash:last-intro'));
ok('intro: seal mark present', splashJs.includes('rq-wedge') && splashJs.includes('function sealSvg'));
ok('intro: all variants bind in css',
  ['rq-radar', 'rq-boot', 'rq-alert', 'rq-seal'].every((name) => splashCss.includes(name)));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
