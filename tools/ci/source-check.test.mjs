import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkAssets, checkFlatImports, defaultPalettesMatch, readThemes, jsFiles } from './source-check.mjs';

const themes = 'export const DEFAULT_DARK = "night";\nexport const DEFAULT_LIGHT = "day";\n\nexport const THEMES = [\n' +
  '  {"id":"day","name":"Day","mode":"light","colors":{"background":"#ffffff","foreground":"#000000"}},\n' +
  '  {"id":"night","name":"Night","mode":"dark","colors":{"background":"#000000","foreground":"#ffffff"}},\n];\n';
const css = '/* BEGIN GENERATED OMARCHY PALETTES (tools/gen-themes.mjs) */\n:root {\n  color-scheme: dark;\n  --om-background: #000000;\n  --om-foreground: #ffffff;\n}\n\n' +
  '@media (prefers-color-scheme: light) {\n  :root:not([data-vn-theme]) {\n    color-scheme: light;\n    --om-background: #ffffff;\n    --om-foreground: #000000;\n  }\n}\n/* END GENERATED OMARCHY PALETTES */\n';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hacker-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries({
    'extension.yaml': 'format_version: 1\ncss: style.css\njs: main.js\n',
    'style.css': css, 'themes.js': themes, 'main.js': 'export {};',
    'local.example.json': '{"nodeAccents":{},"nodeIcons":{}}',
    LICENSE: 'MIT License',
  })) fs.writeFileSync(path.join(root, file), text);
  return root;
}
test('valid assets and default palettes', (t) => assert.doesNotThrow(() => checkAssets(fixture(t))));
test('the entry imports every statically imported module', (t) => {
  const root = fixture(t);
  const write = (file, text) => fs.writeFileSync(path.join(root, file), text);
  write('util.js', 'import { THEMES } from "./themes.js";\nexport const x = THEMES;\n');
  write('nav.js', 'import {\n  x,\n} from "./util.js";\nexport const later = () => import("./routines.js");\n');
  write('main.js', 'import { later } from "./nav.js";\nimport { x } from "./util.js";\n');
  assert.throws(() => checkFlatImports(root), /util\.js imports themes\.js/);
  write('main.js', 'import { later } from "./nav.js";\nimport { x } from "./util.js";\nimport "./themes.js";\n');
  assert.doesNotThrow(() => checkFlatImports(root));
});
test('themes.js reads as data', () => {
  const { themes: list, defaults } = readThemes(themes);
  assert.deepEqual(list.map((t) => t.id), ['day', 'night']);
  assert.deepEqual(defaults, { DEFAULT_DARK: 'night', DEFAULT_LIGHT: 'day' });
});
test('palette drift or absent blocks fail', () => {
  assert.equal(defaultPalettesMatch(css, themes), true);
  assert.equal(defaultPalettesMatch(css.replace('--om-foreground: #000000;', '--om-foreground: #111111;'), themes), false);
  assert.equal(defaultPalettesMatch(css.replace('color-scheme: dark;', 'color-scheme: light;'), themes), false);
  assert.equal(defaultPalettesMatch(css, themes.replace('"night"', '"dusk"')), false);
  assert.equal(defaultPalettesMatch('', themes), false);
  assert.equal(defaultPalettesMatch(css, ''), false);
});
test('example defaults name real choices', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'local.example.json'),
    '{"nodeAccents":{},"nodeIcons":{},"defaults":{"appearance":"dark","darkTheme":"night","lightTheme":"day","textSize":"compact","corners":"rounded"}}');
  assert.doesNotThrow(() => checkAssets(root));
});
for (const [name, file, text] of [
  ['malformed JSON', 'local.example.json', '{'],
  ['bad map', 'local.example.json', '{"nodeAccents":[],"nodeIcons":{}}'],
  ['defaults not an object', 'local.example.json', '{"nodeAccents":{},"nodeIcons":{},"defaults":[]}'],
  ['a dark default that is a light theme', 'local.example.json', '{"nodeAccents":{},"nodeIcons":{},"defaults":{"darkTheme":"day"}}'],
  ['an unknown default', 'local.example.json', '{"nodeAccents":{},"nodeIcons":{},"defaults":{"font":"mono"}}'],
  ['missing asset', 'extension.yaml', 'format_version: 1\ncss: missing.css\njs: main.js\n'],
  ['path traversal', 'extension.yaml', 'format_version: 1\ncss: ../outside.css\njs: main.js\n'],
  ['missing license', 'LICENSE', ''],
]) test(name, (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, file), text);
  assert.throws(() => checkAssets(root));
});
test('syntax scan skips dependencies and artifacts', (t) => {
  const root = fixture(t);
  for (const dir of ['node_modules', 'out', '.ci-runtime']) {
    fs.mkdirSync(path.join(root, dir));
    fs.writeFileSync(path.join(root, dir, 'ignored.js'), 'bad');
  }
  assert.deepEqual(jsFiles(root).sort(), [path.join(root, 'main.js'), path.join(root, 'themes.js')]);
});
