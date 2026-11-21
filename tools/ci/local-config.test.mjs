import assert from 'node:assert/strict';
import test from 'node:test';

// util.js reads browser globals at import time; each test file runs in its own process.
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
globalThis.location = { pathname: '/node/alpha/' };
globalThis.document = { documentElement: { style: {} } };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
let respond = null;
globalThis.fetch = async () => respond();
const reply = (body, status = 200) => () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const { restoreLocalConfig, loadLocalConfig, nodeAccent, KEYS, NODE_ACCENTS, NODE_ICONS, NODE_IMAGES } =
  await import(new URL('../../util.js', import.meta.url));
const state = () => ({ accents: { ...NODE_ACCENTS }, icons: { ...NODE_ICONS }, images: Object.keys(NODE_IMAGES) });
const clear = () => { for (const map of [NODE_ACCENTS, NODE_ICONS, NODE_IMAGES]) for (const k of Object.keys(map)) delete map[k]; };
const config = { nodeAccents: { alpha: 'green' }, nodeIcons: { alpha: 'server', beta: 'nope' }, nodeImages: { beta: 'local/b.png', up: '../x.png' } };
const applied = { accents: { alpha: 'green' }, icons: { alpha: 'server' }, images: ['beta'] };

test('local.json applies, is kept, and reports a change only when it differs', async () => {
  respond = reply(config);
  assert.equal(await loadLocalConfig(), true);
  assert.deepEqual(state(), applied);
  assert.equal(nodeAccent('alpha'), 'green');
  assert.equal(await loadLocalConfig(), false);
});
test('the kept copy applies synchronously on the next page load', () => {
  clear();
  restoreLocalConfig();
  assert.deepEqual(state(), applied);
});
test('sections that are null or not objects count as empty', async () => {
  respond = reply({ nodeAccents: null, nodeIcons: null, nodeImages: 'x' });
  assert.equal(await loadLocalConfig(), true);
  assert.deepEqual(state(), { accents: {}, icons: {}, images: [] });
});
test('offline keeps the kept copy; a missing or broken file means defaults', async () => {
  respond = reply(config);
  await loadLocalConfig();
  respond = () => { throw new TypeError('Failed to fetch'); };
  assert.equal(await loadLocalConfig(), false);
  assert.deepEqual(state(), applied);
  respond = reply('Extension asset unavailable.', 410); // what a missing asset returns
  assert.equal(await loadLocalConfig(), true);
  assert.deepEqual(state(), { accents: {}, icons: {}, images: [] });
  assert.equal(store.get(KEYS.local), 'null');
  respond = reply(config);
  await loadLocalConfig();
  respond = reply('{ nope');
  assert.equal(await loadLocalConfig(), true);
  assert.deepEqual(NODE_ACCENTS, {});
});
test('a damaged kept copy is ignored', () => {
  store.set(KEYS.local, '{damaged');
  assert.doesNotThrow(() => restoreLocalConfig());
});
test('a local.json too big for localStorage applies but is not kept', async () => {
  respond = reply({ nodeImages: { alpha: `data:image/png;base64,${'A'.repeat(70 * 1024)}` } });
  assert.equal(await loadLocalConfig(), true);
  assert.deepEqual(Object.keys(NODE_IMAGES), ['alpha']);
  assert.equal(store.get(KEYS.local), 'null');
});
