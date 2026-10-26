/**
 * Red Queen splash for DeepSeek Harness — injected body script.
 *
 * Runs before the harness shell boots: mounts a fixed overlay, plays the
 * boot sequence (uplink handshake → welcome board), then leaves once the
 * shell has rendered. Pure self-contained script, no imports.
 *
 * Conventions: elements `rq-*`, states `is-playing/is-leaving/is-reduced`,
 * keyframes `rq-*`, custom properties `--rq-*`. The beat block below must
 * stay in sync with the `--B/--G/--R` constants in splash.css.
 */
(() => {
  const doc = document;
  const ID = 'redqueen-splash';
  const BASE_MS = 4500;
  const REDUCED_HOLD_MS = 700;
  const FADE_MS = 280;

  // Timeline beats (ms on the BASE_MS timeline); keep in sync with splash.css.
  // `done` is the moment act B has fully landed: the client UI is never
  // revealed before it, whatever the configured duration.
  const BEAT = { b: 1280, uplink: 1000, grid: 2040, welcome: 2360, ready: 2640, done: 2800 };
  // Loading % follows the same beats instead of a free-running curve.
  const PROGRESS = [[0, 0], [300, 0.05], [BEAT.uplink, 0.24], [BEAT.grid, 0.56], [BEAT.welcome, 0.8], [BEAT.ready, 0.97]];
  // The uplink meter under the module tiles runs from the grid to ready.
  const LINK = [[BEAT.grid, 0], [BEAT.welcome, 0.55], [BEAT.ready, 0.97]];

  const EXITS = {
    wipe: { ms: 1100 }, // opaque curtain lifts top-down, app appears band by band
    blast: { ms: 700 },
    purge: { ms: 950, run: purgeExit },
    signal: { ms: 640, run: signalExit },
    iris: { ms: 950 }, // 240 ms prime + 700 ms aperture
  };

  // Boot intro variants, rotated like the exits (`intro: 'random'` never
  // repeats the previous one). All share the seal → grant → welcome flow.
  const INTROS = {
    hive: { scramble: 'ESTABLISHING UPLINK', grant: 'UPLINK ESTABLISHED', build: hiveExtras },
    scan: { scramble: 'IDENTITY SCAN', grant: 'IDENTITY VERIFIED', build: scanExtras },
    system: { scramble: 'BOOT SEQUENCE', grant: 'ALL SYSTEMS NOMINAL', build: systemExtras },
    lockdown: { scramble: 'CONTAINMENT CHECK', grant: 'CONTAINMENT SECURE', build: lockdownExtras },
  };

  const DEFAULTS = {
    title: 'DEEPSEEK HARNESS',
    subtitle: 'RED QUEEN MAINFRAME · SECURITY & SURVEILLANCE DIVISION',
    code: 'RQ-DSH/0.1',
    whisper: 'YOU ARE ALL GOING TO DIE DOWN HERE.',
    accentLight: '#c8102e',
    accentDark: '#ff3348',
    theme: 'auto',
    exit: 'wipe',
    intro: 'random',
    duration: 4000,
    maxWait: 8000,
    skippable: true,
    replayOnReload: false,
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  /** Per-segment ease-in-out, so every meter leg glides instead of linear. */
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2);

  /** Value of a piecewise-eased curve `[fromMs, to01]` at `ms`. */
  function along(curve, ms) {
    if (ms <= curve[0][0]) return curve[0][1];
    for (let i = 1; i < curve.length; i++) {
      const [to, value] = curve[i];
      const [from, previous] = curve[i - 1];
      if (ms <= to) {
        const span = to - from || 1;
        return previous + (value - previous) * easeInOut((ms - from) / span);
      }
    }
    return curve[curve.length - 1][1];
  }

  /** Storage helpers that never throw (private mode, quota, disabled). */
  const store = {
    get(key) { try { return window.localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { window.localStorage.setItem(key, value); } catch { /* ignore */ } },
    sessionGet(key) { try { return window.sessionStorage.getItem(key); } catch { return null; } },
    sessionSet(key, value) { try { window.sessionStorage.setItem(key, value); } catch { /* ignore */ } },
  };

  /** Random exit that never repeats the previous one. */
  function pickExit() {
    const names = Object.keys(EXITS);
    const last = store.get('redqueen-splash:last-exit');
    const pool = names.filter((name) => name !== last);
    const pick = pool[Math.floor(Math.random() * pool.length)] || names[0];
    store.set('redqueen-splash:last-exit', pick);
    return pick;
  }

  /** Random boot intro that never repeats the previous one. */
  function pickIntro() {
    const names = Object.keys(INTROS);
    const last = store.get('redqueen-splash:last-intro');
    const pool = names.filter((name) => name !== last);
    const pick = pool[Math.floor(Math.random() * pool.length)] || names[0];
    store.set('redqueen-splash:last-intro', pick);
    return pick;
  }

  /** FNV-1a over a string, seeding the hex data strip. */
  function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  }

  /** Deterministic hex byte strip derived from the code string. */
  function hexStrip(code) {
    let state = fnv1a(code) || 1;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
    const bytes = Array.from({ length: 12 }, () => (next() & 0xff).toString(16).padStart(2, '0'));
    return bytes.join('').replace(/(.{8})/g, '$1 ').trim();
  }

  /** Deterministic barcode for the specimen tag, seeded by the code string. */
  function barcodeSvg(code) {
    const bars = Array.from({ length: 24 }, (_, i) => {
      const hash = fnv1a(`${code}:${i}`);
      return `<rect x="${i * 4}" y="0" width="${1 + (hash % 3)}" height="10" fill="currentColor"/>`;
    }).join('');
    return `<svg class="rq-tag-barcode" viewBox="0 0 96 10" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>`;
  }

  /** Escape user-editable text before inline interpolation. */
  function esc(text) {
    return String(text).replace(/[&<>"]/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    }[ch]));
  }

  /** Split text into per-glyph spans so CSS can stagger and scramble them. */
  function spell(text) {
    return [...String(text)].map((ch, i) => ch === ' '
      ? '<i class="rq-sp"> </i>'
      : `<i class="rq-ch" style="--i:${i}" data-final="${esc(ch)}">${esc(ch)}</i>`)
      .join('');
  }

  /** Radial iris spokes for the eye emblem. */
  function spokes(count, radiusInner, radiusOuter) {
    const points = [];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      points.push(`M${(100 + radiusInner * cos).toFixed(2)} ${(100 + radiusInner * sin).toFixed(2)}`
        + `L${(100 + radiusOuter * cos).toFixed(2)} ${(100 + radiusOuter * sin).toFixed(2)}`);
    }
    return points.join('');
  }

  /** The Queen's eye: segmented outer ring, iris spokes, red pupil. */
  function eyeSvg(uid) {
    return `<svg class="rq-eye-svg" viewBox="0 0 200 200" fill="none" aria-hidden="true">
      <g class="rq-eye-spin">
        <circle cx="100" cy="100" r="94" stroke="currentColor" stroke-width="1" stroke-dasharray="1.2 7.4" opacity=".5"/>
        <circle cx="100" cy="100" r="86" stroke="currentColor" stroke-width="2.4" stroke-dasharray="72 468" opacity=".9"/>
      </g>
      <g class="rq-eye-iris">
        <circle cx="100" cy="100" r="58" stroke="currentColor" stroke-width="1.6"/>
        <circle cx="100" cy="100" r="52" stroke="currentColor" stroke-width=".8" opacity=".55" stroke-dasharray="2 4.2"/>
        <path d="${spokes(16, 30, 52)}" stroke="currentColor" stroke-width="1.1" opacity=".8"/>
      </g>
      <circle class="rq-eye-pupil" cx="100" cy="100" r="24" fill="currentColor"/>
      <circle cx="100" cy="100" r="24" stroke="var(--rq-bg,#0b0b0e)" stroke-width="2" opacity=".35"/>
      <circle class="rq-eye-core" cx="100" cy="100" r="7" fill="var(--rq-bg,#0b0b0e)"/>
      <circle class="rq-eye-sweep" cx="100" cy="100" r="86" stroke="var(--rq-accent,#ff3348)" stroke-width="3"
        stroke-dasharray="40 500" stroke-dashoffset="40" opacity="0"/>
    </svg>`;
  }

  /**
   * The lab-company seal: an octagon of eight alternating red / white
   * sectors meeting at the centre — an original vector rendering of the
   * protective-umbrella mark. Sectors light up in sequence, then the intro
   * variant takes the stage.
   */
  function sealSvg() {
    const pt = (r, deg) => {
      const a = ((deg - 90) * Math.PI) / 180;
      return `${(100 + r * Math.cos(a)).toFixed(2)} ${(100 + r * Math.sin(a)).toFixed(2)}`;
    };
    const wedges = Array.from({ length: 8 }, (_, i) => {
      const a = pt(82, 22.5 + i * 45);
      const b = pt(82, 22.5 + (i + 1) * 45);
      return `<path class="rq-wedge ${i % 2 ? 'rq-wedge--paper' : 'rq-wedge--accent'}" style="--i:${i}"
        d="M100 100 L${a} L${b} Z"/>`;
    }).join('');
    const frame = Array.from({ length: 8 }, (_, i) => pt(84, 22.5 + i * 45)).join(' ');
    return `<svg class="rq-seal-svg" viewBox="0 0 200 200" fill="none" aria-hidden="true">
      <circle cx="100" cy="100" r="96" stroke="currentColor" stroke-width="1" stroke-dasharray="1.2 7.4" opacity=".45"/>
      <circle cx="100" cy="100" r="90" stroke="currentColor" stroke-width="1.6" opacity=".8"/>
      <polygon points="${frame}" stroke="var(--rq-line,#444)" stroke-width="1.2"/>
      ${wedges}
    </svg>`;
  }

  /** hive: the eye wakes over the containment diagnostics. */
  function hiveExtras(uid) {
    return `
      <div class="rq-eye">${eyeSvg(uid)}</div>
      <ul class="rq-diag">
        <li class="rq-diag-row" style="--i:0"><span>HIVE INTEGRITY</span><b>STABLE</b></li>
        <li class="rq-diag-row" style="--i:1"><span>CONTAINMENT FIELD</span><b>SECURE</b></li>
        <li class="rq-diag-row" style="--i:2"><span>RED QUEEN CORE</span><b>ONLINE</b></li>
      </ul>`;
  }

  /** scan: biometric rings under a rotating radar sweep. */
  function scanExtras(uid) {
    return `
      <div class="rq-radar">
        <div class="rq-radar-sweep"></div>
        <i class="rq-radar-ring" style="--i:0"></i>
        <i class="rq-radar-ring" style="--i:1"></i>
        <i class="rq-radar-ring" style="--i:2"></i>
        <div class="rq-eye">${eyeSvg(uid)}</div>
      </div>
      <ul class="rq-bio">
        <li class="rq-bio-row" style="--i:0"><span>RETINA</span><i></i></li>
        <li class="rq-bio-row" style="--i:1"><span>GAIT</span><i></i></li>
        <li class="rq-bio-row" style="--i:2"><span>VOICE</span><i></i></li>
      </ul>`;
  }

  /** system: a terminal boot log typing itself out. */
  function systemExtras() {
    const lines = [
      'UMBRELLA OS 9.3.1 // RED QUEEN HOST',
      'LOADING HIVE MODULES ......... OK',
      'MEMORY INTEGRITY ............. OK',
      'SECTOR 7 UPLINK .............. OK',
      'PURGE PROTOCOL ........... ARMED',
    ];
    return `
      <div class="rq-boot">
        ${lines.map((line, i) => `<span class="rq-boot-line" style="--i:${i}"><b>&gt;</b> ${esc(line)}</span>`).join('')}
        <span class="rq-boot-cursor"></span>
      </div>`;
  }

  /** lockdown: hazard stripes and a flashing WARNING band. */
  function lockdownExtras() {
    return `
      <div class="rq-alert">
        <i class="rq-alert-stripes"></i>
        <b>WARNING</b>
        <i class="rq-alert-stripes rq-alert-stripes--r"></i>
      </div>`;
  }

  /** Tile hexagon codes for the welcome board: [code, caption]. */
  const TILES = [['RN', 'RENDER'], ['SB', 'SIDEBAR'], ['SS', 'SESSION'], ['CM', 'COMMAND'], ['UI', 'MODULE']];

  function template(cfg, variant) {
    const uid = Math.random().toString(36).slice(2, 7);
    return `
      <div class="rq-backdrop" aria-hidden="true">
        <div class="rq-grid"></div>
        <div class="rq-floor"></div>
        <i class="rq-orbit rq-orbit--a"></i>
        <i class="rq-orbit rq-orbit--b"></i>
        <i class="rq-orbit-sat"><i></i></i>
        <div class="rq-glow"></div>
        <div class="rq-scanlines"></div>
        <div class="rq-sweepbar"></div>
        <div class="rq-vignette"></div>
      </div>
      <div class="rq-hud" aria-hidden="true">
        <i class="rq-corner rq-corner--tl"></i><i class="rq-corner rq-corner--tr"></i>
        <i class="rq-corner rq-corner--bl"></i><i class="rq-corner rq-corner--br"></i>
        <i class="rq-reg rq-reg--a"></i><i class="rq-reg rq-reg--b"></i>
        <header class="rq-top">
          <span class="rq-top-l">RED QUEEN <b>//</b> MAINFRAME</span>
          <span class="rq-clock">--:--:--</span>
          <span class="rq-top-r">SECTOR 7 · SECURITY &amp; SURVEILLANCE</span>
        </header>
        <span class="rq-tag"><i class="rq-tag-redact"></i>${barcodeSvg(cfg.code)}<b>SPECIMEN</b> ${esc(cfg.code)}</span>
        <aside class="rq-rail">
          <span class="rq-rail-id">${esc(cfg.code)}</span>
          <span class="rq-rail-data">${hexStrip(cfg.code)}</span>
        </aside>
        <i class="rq-caution"></i>
        <div class="rq-scope">
          <i class="rq-scope-cross"></i>
          <i class="rq-scope-scan"></i>
          <span class="rq-scope-data">BIO-SIGN 98.2</span>
          <i class="rq-scope-scale"></i>
        </div>
        <footer class="rq-bottom">
          <span class="rq-bottom-code">${esc(cfg.code)}</span>
          <span class="rq-progress"><i class="rq-progress-bar"></i><b class="rq-progress-pct">00%</b></span>
          <span class="rq-hint">CLICK TO SKIP</span>
        </footer>
        <span class="rq-watermark">RQ</span>
      </div>
      <main class="rq-stage">
        <section class="rq-access">
          <div class="rq-seal" aria-hidden="true">${sealSvg()}</div>
          ${variant.build(uid)}
          <div class="rq-access-plate">
            <p class="rq-access-line" data-scramble>${spell(variant.scramble)}</p>
            <p class="rq-access-grant">${spell(variant.grant)}</p>
          </div>
        </section>
        <section class="rq-welcome">
          <p class="rq-overline">WELCOME TO</p>
          <h1 class="rq-title">${spell(cfg.title)}</h1>
          <p class="rq-subtitle">${esc(cfg.subtitle)}</p>
          <div class="rq-tiles">
            ${TILES.map(([tile, label], i) => `<span class="rq-tile${i === 0 ? ' rq-tile--hot' : ''}" style="--i:${i}"><span class="rq-tile-hex"><b>${tile}</b></span><i class="rq-tile-label">${label}</i></span>`).join('')}
          </div>
          <div class="rq-link"><span class="rq-link-label">UPLINK</span><i class="rq-link-track"><i class="rq-link-fill"></i><b class="rq-link-readhead"></b></i></div>
        </section>
        ${cfg.whisper ? `<p class="rq-whisper">${esc(cfg.whisper)}</p>` : ''}
      </main>
      <div class="rq-exits" aria-hidden="true">
        <div class="rq-wipe">${Array.from({ length: 8 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
        <div class="rq-blast"><i class="rq-blast-seam"></i><i class="rq-blast-half rq-blast-half--t"></i><i class="rq-blast-half rq-blast-half--b"></i></div>
        <div class="rq-signal"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
        <div class="rq-iris-exit"><i class="rq-iris-ping" style="--i:0"></i><i class="rq-iris-ping" style="--i:1"></i><div class="rq-iris-core">${eyeSvg(uid + 'x')}</div></div>
        <canvas class="rq-purge"></canvas>
      </div>`;
  }

  /** Signal loss: the live stage is torn into offset, aberrated slices. */
  function signalExit(root) {
    try {
      const stage = root.querySelector('.rq-stage');
      const layer = root.querySelector('.rq-signal');
      if (!stage || !layer) return;
      const height = root.clientHeight;
      const width = root.clientWidth;
      if (!width || !height) return;
      const rows = 6;
      for (let i = 0; i < rows; i++) {
        const topPct = (i / rows) * 100;
        const slice = doc.createElement('i');
        slice.className = 'rq-signal-slice';
        slice.style.top = `${topPct}%`;
        slice.style.height = `${100 / rows + 0.4}%`;
        slice.style.setProperty('--i', String(i));
        const clone = stage.cloneNode(true);
        clone.style.cssText = `position:absolute;left:0;width:100%;height:${height}px;top:${(-topPct / 100) * height}px;`;
        slice.appendChild(clone);
        layer.appendChild(slice);
      }
    } catch { /* the flicker stripes alone still sell the effect */ }
  }

  /** Character purge: the board dissolves into hex, then wipes away. */
  function purgeExit(root, exitMs) {
    try {
      const canvas = root.querySelector('.rq-purge');
      if (!canvas || !canvas.getContext) return;
      const context = canvas.getContext('2d');
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = root.clientWidth;
      const height = root.clientHeight;
      if (!width || !height) return;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.scale(ratio, ratio);

      const size = 14;
      const columns = Math.ceil(width / size);
      const rows = Math.ceil(height / size);
      const glyphs = '0123456789ABCDEF';
      const accent = root.style.getPropertyValue('--rq-accent').trim() || '#ff3348';
      // Ragged clear front: base sweep plus two sine wobbles, per column.
      const front = (x) => {
        const u = x / Math.max(columns - 1, 1);
        return clamp(0.48 + 0.34 * u
          + Math.sin(u * Math.PI * 3.1) * 0.05
          + Math.sin(u * 11.7) * 0.022, 0.48, 0.99);
      };
      // Per-cell state: cached glyph re-rolled every ~70ms, own alpha.
      const cells = Array.from({ length: columns * rows }, () => ({
        glyph: glyphs[(Math.random() * glyphs.length) | 0],
        born: 0,
        alpha: 0.35 + Math.random() * 0.4,
      }));
      const started = performance.now();
      const draw = (now) => {
        const t = clamp((now - started) / exitMs, 0, 1);
        context.clearRect(0, 0, width, height);
        context.font = '11px ui-monospace, Consolas, monospace';
        // Phase 1 (0–0.45): the screen crystallises into hex characters.
        // Phase 2: the ragged front erases it, accent cells riding the edge.
        const fill = clamp(t / 0.45, 0, 1);
        const visibleColumns = Math.ceil(columns * easeInOut(fill));
        for (let x = 0; x < visibleColumns; x++) {
          if (t >= front(x)) continue;
          const near = t >= front(x) - 0.07;
          for (let y = 0; y < rows; y++) {
            const cell = cells[y * columns + x];
            if (now - cell.born > 70) {
              cell.glyph = glyphs[(Math.random() * glyphs.length) | 0];
              cell.born = now;
            }
            context.globalAlpha = near ? 0.95 : cell.alpha;
            context.fillStyle = near || (x + y) % 9 === 0 ? accent : 'rgb(150,150,158)';
            context.fillText(cell.glyph, x * size, y * size + size);
          }
        }
        context.globalAlpha = 1;
        if (t < 1) requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
    } catch { /* the fade-out below still removes the splash */ }
  }

  /** Resolve `theme: auto` the way the host renders it. */
  function pickTheme(cfg) {
    if (cfg.theme === 'dark' || cfg.theme === 'light') return cfg.theme;
    const body = doc.body;
    if (body && body.dataset.dsThemeSource !== undefined) {
      return body.dataset.dsDarkTheme !== undefined ? 'dark' : 'light';
    }
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return 'dark';
    }
  }

  function mount(overrides = {}) {
    if (!doc.body || doc.getElementById(ID)) return;
    const cfg = Object.assign({}, DEFAULTS, globalThis.__RQ_SPLASH__ || {}, overrides);
    if (cfg.enabled === false) return;

    const reduced = cfg.reducedMotion === true || (() => {
      try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
    })();
    const exitName = reduced ? 'fade' : (EXITS[cfg.exit] ? cfg.exit : pickExit());
    const exitMs = reduced ? FADE_MS : EXITS[exitName].ms;
    const introName = reduced ? 'hive' : (INTROS[cfg.intro] ? cfg.intro : pickIntro());
    const variant = INTROS[introName];
    const speed = clamp((cfg.duration || 0) / BASE_MS, 0.45, 2);

    const root = doc.createElement('div');
    root.id = ID;
    root.className = 'rq-root';
    root.dataset.theme = pickTheme(cfg);
    root.dataset.exit = exitName;
    root.dataset.intro = introName;
    root.setAttribute('aria-hidden', 'true');
    root.style.setProperty('--rq-accent', root.dataset.theme === 'dark' ? cfg.accentDark : cfg.accentLight);
    root.style.setProperty('--rq-k', String(speed));
    root.innerHTML = template(cfg, variant);
    doc.body.appendChild(root);

    // ---- per-frame meters -------------------------------------------------
    let progress = 0;
    let link = 0;
    let rafId = 0;
    const pct = root.querySelector('.rq-progress-pct');
    const tick = (now) => {
      if (left) { rafId = 0; return; }
      const elapsed = (now - startedAt) / speed;
      progress = along(PROGRESS, elapsed);
      link = along(LINK, elapsed);
      if (elapsed > BEAT.ready) {
        const creep = clamp((elapsed - BEAT.ready) / 4000, 0, 1);
        progress = 0.97 + creep * 0.02;
        link = 0.97 + creep * 0.02;
      }
      root.style.setProperty('--rq-p', progress.toFixed(4));
      root.style.setProperty('--rq-q', link.toFixed(4));
      if (pct) pct.textContent = `${String(Math.round(progress * 100)).padStart(3, '0')}%`;
      // Semantic phase for the top-bar status swap (CSS reads data-phase).
      const phase = elapsed < BEAT.uplink ? 'requesting' : elapsed < BEAT.ready ? 'granted' : 'ready';
      if (root.dataset.phase !== phase) root.dataset.phase = phase;
      rafId = requestAnimationFrame(tick);
    };

    // ---- glyph scramble ---------------------------------------------------
    let scrambleTimer = 0;
    const startScramble = () => {
      const glyphs = 'ABCDEFGHKMNPRSTUVWXYZ023456789#/\\|<>+=';
      const targets = [...root.querySelectorAll('.rq-access-line .rq-ch')];
      if (!targets.length) return;
      const totalMs = (BEAT.uplink - 420) * speed - 100;
      const started = performance.now();
      // Per-glyph settle moments with jitter; unsettled glyphs tint raw.
      const settleAt = targets.map((_, i) => (i / targets.length) * totalMs + Math.random() * 120);
      let lastFlick = 0;
      scrambleTimer = window.setInterval(() => {
        const now = performance.now();
        const elapsed = now - started;
        let anyRaw = false;
        targets.forEach((target, i) => {
          if (elapsed >= settleAt[i]) {
            if (target.textContent !== target.dataset.final) target.textContent = target.dataset.final;
            if (target.dataset.raw) delete target.dataset.raw;
          } else {
            target.dataset.raw = '1';
            anyRaw = true;
            if (now - lastFlick >= 45) {
              target.textContent = glyphs[(Math.random() * glyphs.length) | 0];
            }
          }
        });
        if (now - lastFlick >= 45) lastFlick = now;
        if (!anyRaw) {
          window.clearInterval(scrambleTimer);
          scrambleTimer = 0;
          targets.forEach((target) => {
            target.textContent = target.dataset.final;
            if (target.dataset.raw) delete target.dataset.raw;
          });
        }
      }, 48);
    };

    // ---- lifecycle --------------------------------------------------------
    let startedAt = 0;
    let left = false;
    let destroyed = false;
    let timers = [];
    let observer = null;
    let railTimer = 0;
    let clockTimer = 0;

    const later = (fn, ms) => timers.push(window.setTimeout(fn, ms));

    const appReady = () => {
      const app = doc.getElementById('root');
      return app === null || app.childElementCount > 0;
    };

    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      timers = [];
      if (scrambleTimer) window.clearInterval(scrambleTimer);
      if (railTimer) window.clearInterval(railTimer);
      if (clockTimer) window.clearInterval(clockTimer);
      if (rafId) cancelAnimationFrame(rafId);
      if (observer) observer.disconnect();
      globalThis.removeEventListener('keydown', onKey, true);
      root.remove();
    };

    const leave = () => {
      if (left) return;
      left = true;
      root.classList.remove('is-playing');
      root.classList.add('is-leaving');
      // Complete both meters with one short eased lerp as the frame powers down.
      const fromP = progress;
      const fromQ = link;
      const t0 = performance.now();
      const finish = (now) => {
        if (destroyed) return;
        const k = clamp((now - t0) / 200, 0, 1);
        const e = easeInOut(k);
        root.style.setProperty('--rq-p', (fromP + (1 - fromP) * e).toFixed(4));
        root.style.setProperty('--rq-q', (fromQ + (1 - fromQ) * e).toFixed(4));
        if (k < 1) requestAnimationFrame(finish);
      };
      requestAnimationFrame(finish);
      let name = exitName;
      if (!reduced && EXITS[exitName]?.run) {
        try { EXITS[exitName].run(root, EXITS[exitName].ms); }
        catch { name = 'fade'; root.dataset.exit = 'fade'; }
      }
      later(destroy, (name === 'fade' ? FADE_MS : EXITS[exitName].ms) + 60);
    };

    function onKey(event) {
      if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') leave();
    }

    const exitWhenReady = () => {
      if (appReady()) return leave();
      const app = doc.getElementById('root');
      if (!app) return leave();
      observer = new MutationObserver(() => { if (appReady()) leave(); });
      observer.observe(app, { childList: true });
    };

    const begin = () => {
      startedAt = performance.now();
      root.classList.add('is-playing');
      rafId = requestAnimationFrame(tick);
      later(startScramble, 350 * speed);
      // The rail strip streams deterministic hex; the scope read-out and the
      // clock tick alongside, so the frame never sits still.
      if (!reduced) {
        const railData = root.querySelector('.rq-rail-data');
        const scopeData = root.querySelector('.rq-scope-data');
        if (railData || scopeData) {
          let railTick = 0;
          railTimer = window.setInterval(() => {
            railTick += 1;
            if (railData) railData.textContent = hexStrip(`${cfg.code}:${railTick}`);
            if (scopeData) scopeData.textContent = `BIO-SIGN 9${7 + (railTick % 3)}.${(railTick * 7) % 10}`;
          }, 600);
        }
        const clockEl = root.querySelector('.rq-clock');
        if (clockEl) {
          const tickClock = () => {
            const d = new Date();
            const pad = (v) => String(v).padStart(2, '0');
            clockEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
          };
          tickClock();
          clockTimer = window.setInterval(tickClock, 1000);
        }
      }
      const exitAt = Math.max(cfg.duration - exitMs, 600, BEAT.done * speed);
      // Once the seal is done it leaves the paint tree for good; once act B
      // has entered, act A is hidden permanently. Neither can reappear when
      // is-playing drops at exit time, so the two acts never share the screen.
      later(() => root.classList.add('is-seal-done'), 760 * speed);
      later(() => root.classList.add('is-actb'), (BEAT.b + 420) * speed);
      later(exitWhenReady, exitAt);
      const hardCap = Math.max(cfg.maxWait || 0, exitAt);
      later(leave, hardCap);
      later(destroy, hardCap + exitMs + 2000);
      if (cfg.skippable === false) root.classList.add('is-locked');
    };

    if (cfg.skippable !== false) {
      root.addEventListener('pointerdown', leave);
      globalThis.addEventListener('keydown', onKey, true);
    }

    if (doc.visibilityState === 'visible') {
      begin();
    } else {
      const onVisible = () => {
        if (doc.visibilityState !== 'visible') return;
        doc.removeEventListener('visibilitychange', onVisible);
        globalThis.removeEventListener('focus', onVisible);
        window.clearTimeout(fallbackTimer);
        if (!destroyed && !left) begin();
      };
      const fallbackTimer = window.setTimeout(onVisible, 2500);
      doc.addEventListener('visibilitychange', onVisible);
      globalThis.addEventListener('focus', onVisible);
    }

    store.sessionSet('redqueen-splash:played', '1');
    return root;
  }

  if (store.sessionGet('redqueen-splash:played') !== '1'
    || globalThis.__RQ_SPLASH__?.replayOnReload === true) {
    mount();
  }

  globalThis.__redqueenSplash = {
    replay(options = {}) {
      doc.getElementById(ID)?.remove();
      return mount(Object.assign({ replayOnReload: true }, options));
    },
  };
})();
