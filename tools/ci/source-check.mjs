#!/usr/bin/env node
// Dependency-free source checks. No application imports or browser startup.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// themes.js lists one theme per line as JSON (tools/gen-themes.mjs), so it can
// be read here without importing application code.
export function readThemes(js) {
  const defaults = Object.fromEntries([...js.matchAll(/export const (DEFAULT_DARK|DEFAULT_LIGHT) = "([a-z0-9-]+)";/g)]
    .map(([, key, id]) => [key, id]));
  const themes = [...js.matchAll(/^ {2}(\{.*\}),$/gm)].map(([, line]) => JSON.parse(line));
  return { themes, defaults };
}

// The stylesheet's pre-JS palettes (the generated block) must be the default
// dark and light themes exactly as themes.js has them.
export function defaultPalettesMatch(css, js) {
  const { themes, defaults } = readThemes(js);
  if (!themes.length || !defaults.DEFAULT_DARK || !defaults.DEFAULT_LIGHT) return false;
  const block = css.match(/BEGIN GENERATED OMARCHY PALETTES[^\n]*\n([\s\S]*?)\/\* END GENERATED OMARCHY PALETTES \*\//)?.[1];
  if (!block) return false;
  const dark = block.match(/^:root \{([\s\S]*?)\n\}/m)?.[1];
  const light = block.match(/:root:not\(\[data-vn-theme\]\) \{([\s\S]*?)\n {2}\}/)?.[1];
  const matches = (body, id) => {
    const theme = themes.find((t) => t.id === id);
    if (!body || !theme || !body.includes(`color-scheme: ${theme.mode};`)) return false;
    return Object.entries(theme.colors).every(([key, value]) =>
      body.includes(`--om-${key.replace(/_/g, '-')}: ${value};`));
  };
  return matches(dark, defaults.DEFAULT_DARK) && matches(light, defaults.DEFAULT_LIGHT);
}

export function checkAssets(root) {
  const manifest = fs.readFileSync(path.join(root, 'extension.yaml'), 'utf8');
  if (!/^format_version: 1\s*$/m.test(manifest)) throw new Error('Unsupported extension format');
  for (const key of ['css', 'js']) {
    const values = [...manifest.matchAll(new RegExp(`^${key}: (.+)$`, 'gm'))];
    if (values.length !== 1) throw new Error(`Expected one ${key} asset`);
    const name = values[0][1].trim();
    const file = path.resolve(root, name);
    if (path.isAbsolute(name) || !file.startsWith(`${path.resolve(root)}${path.sep}`) ||
        !fs.statSync(file).isFile() || !fs.realpathSync(file).startsWith(`${fs.realpathSync(root)}${path.sep}`)) {
      throw new Error(`Unsafe ${key} asset: ${name}`);
    }
  }
  const example = JSON.parse(fs.readFileSync(path.join(root, 'local.example.json'), 'utf8'));
  if (!example || Array.isArray(example) || typeof example !== 'object') throw new Error('Expected example object');
  for (const key of ['nodeAccents', 'nodeIcons']) {
    const map = example[key];
    if (!map || Array.isArray(map) || typeof map !== 'object' || Object.values(map).some((v) => typeof v !== 'string')) {
      throw new Error(`Expected ${key} string map`);
    }
  }
  if (!fs.readFileSync(path.join(root, 'LICENSE'), 'utf8').includes('MIT License')) throw new Error('Missing MIT license');
  if (!defaultPalettesMatch(fs.readFileSync(path.join(root, 'style.css'), 'utf8'), fs.readFileSync(path.join(root, 'themes.js'), 'utf8'))) {
    throw new Error('Pre-JS palettes drifted from themes.js (re-run tools/gen-themes.mjs)');
  }
}

// The entry module must import every module the others import statically, so
// the browser requests them all in one batch: each extra level of nested
// imports is one more round trip before the theme paints on every page load.
export function checkFlatImports(root) {
  const manifest = fs.readFileSync(path.join(root, 'extension.yaml'), 'utf8');
  const entry = manifest.match(/^js: (.+)$/m)[1].trim();
  const staticImports = (file) => [...fs.readFileSync(path.join(root, file), 'utf8')
    .matchAll(/^import\s+(?:[^'"]*?\s+from\s+)?["']\.\/([\w.-]+\.js)["']/gm)].map((m) => m[1]);
  const direct = new Set(staticImports(entry));
  for (const file of fs.readdirSync(root).filter((name) => name.endsWith('.js') && name !== entry)) {
    for (const dep of staticImports(file)) {
      if (!direct.has(dep)) throw new Error(`${file} imports ${dep}; import it from ${entry} too, so it loads in the first batch`);
    }
  }
}

export function jsFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (['.git', 'node_modules', 'out', '.ci-runtime'].includes(entry.name)) return [];
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) return jsFiles(file);
    return entry.isFile() && /\.(m?js)$/.test(entry.name) ? [file] : [];
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  checkAssets(root);
  checkFlatImports(root);
  const files = jsFiles(root);
  for (const file of files) {
    // stdin with module mode supports the browser ESM files without a root package.json.
    const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
      input: fs.readFileSync(file), encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(`${path.relative(root, file)}: ${result.stderr || result.error}`);
  }
  console.log(`Source checks passed (${files.length} JavaScript files; assets, examples, licenses, default palettes, flat imports)`);
}
