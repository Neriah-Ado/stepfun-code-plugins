/**
 * Build preview/standalone.html — a single self-contained offline preview.
 * Inlines lib/splash.css and lib/splash.js into the preview page so it can
 * be opened directly from disk (file://) or shared as one file.
 *
 * Run: node scripts/build-preview.mjs   (or: npm run preview:build)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const css = read('lib/splash.css');
const js = read('lib/splash.js').replace(/<\/script/gi, '<\\/script');

const html = read('preview/index.html')
  .replace('<title>红后开屏 · 本地预览</title>', '<title>红后开屏 · 离线预览</title>')
  .replace('<link rel="stylesheet" href="../lib/splash.css">', () => `<style>\n${css}\n  </style>`)
  .replace('<script src="../lib/splash.js"></script>', () => `<script>\n${js}\n</script>`);

if (html.includes('../lib/')) throw new Error('lib references left unresolved');

const out = join(root, 'preview', 'standalone.html');
writeFileSync(out, html);
console.log(`written: ${out} (${html.length} bytes)`);
