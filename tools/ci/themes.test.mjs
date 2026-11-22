import assert from 'node:assert/strict';
import test from 'node:test';

// util.js reads browser globals at import time; each test file runs in its own process.
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.location = { pathname: '/' };
globalThis.document = { documentElement: { style: {} } };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
const { THEMES, DEFAULT_DARK, DEFAULT_LIGHT, paletteVars, bakedDefaults } = await import(new URL('../../util.js', import.meta.url));
const colors = await import(new URL('../colors.js', import.meta.url));

test('the page paints exactly what the generator computes, inks included', () => {
  assert.ok(THEMES.length > 1);
  for (const theme of THEMES) {
    assert.deepEqual(Object.keys(theme.colors), colors.PALETTE_KEYS, theme.id);
    assert.deepEqual(Object.keys(theme.on), colors.ROLES, theme.id);
    assert.deepEqual(Object.entries(paletteVars(theme)), Object.entries(colors.paletteVars(theme.colors)), theme.id);
  }
});

const styleWith = (props) => ({ getPropertyValue: (name) => (name in props ? ` ${props[name]}` : '') });

test('without written-in defaults the script uses its own', () => {
  assert.deepEqual(bakedDefaults(styleWith({})), {
    scheme: 'system', dark: DEFAULT_DARK, light: DEFAULT_LIGHT, type: 'comfortable', corners: 'sharp',
  });
});

test('defaults written into the stylesheet become the script\'s', () => {
  assert.deepEqual(bakedDefaults(styleWith({
    '--vn-default-appearance': 'dark', '--vn-default-dark': 'kanagawa', '--vn-default-light': 'rose-pine',
    '--vn-default-text-size': 'compact', '--vn-default-corners': 'rounded',
  })), { scheme: 'dark', dark: 'kanagawa', light: 'rose-pine', type: 'compact', corners: 'rounded' });
});

test('anything unusable falls back, a theme of the other mode included', () => {
  assert.deepEqual(bakedDefaults(styleWith({
    '--vn-default-appearance': 'dim', '--vn-default-dark': 'catppuccin-latte', '--vn-default-light': 'nope',
    '--vn-default-text-size': 'huge', '--vn-default-corners': '',
  })), { scheme: 'system', dark: DEFAULT_DARK, light: DEFAULT_LIGHT, type: 'comfortable', corners: 'sharp' });
});
