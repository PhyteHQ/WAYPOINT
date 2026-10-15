import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', root)));
test('the installable app is confined to this Pages project and has actual PNG icons', () => {
  assert.equal(manifest.id, './'); assert.equal(manifest.start_url, './'); assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  for (const size of [192, 512]) assert(manifest.icons.some(icon => icon.sizes === `${size}x${size}`));
  for (const icon of [...manifest.icons, { src: './assets/apple-touch-icon.png', sizes: '180x180' }]) {
    const png = readFileSync(new URL(icon.src, root));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
});

function worker() {
  const handlers = new Map(), cacheStores = new Map(), deleted = [], network = [];
  const shell = ['./index.html', './src/app.mjs', './src/worker.mjs', './data/navigation.json'];
  let skipped = 0, claimed = 0;
  const absolute = path => new URL(path, 'https://phytehq.github.io/WAYPOINT/').href;
  const caches = {
    async open(key) {
      if (!cacheStores.has(key)) cacheStores.set(key, {
        files: new Map(),
        async addAll(requests) {
          for (const request of requests) { assert.equal(request.cache, 'reload'); this.files.set(request.url, new Response(`installed:${request.url}`)); }
        },
        async match(request) { return this.files.get(typeof request === 'string' ? request : request.url)?.clone(); },
      });
      return cacheStores.get(key);
    },
    async keys() { return [...cacheStores.keys()]; },
    async delete(key) { deleted.push(key); return cacheStores.delete(key); },
  };
  const self = { location: { href: absolute('sw.js') }, addEventListener: (type, handler) => handlers.set(type, handler),
    clients: { async claim() { claimed++; } }, skipWaiting() { skipped++; } };
  const source = readFileSync(new URL('sw.js', root), 'utf8').replace('__WAYPOINT_REVISION__', 'test-release')
    .replace('/* __WAYPOINT_SHELL__ */ []', JSON.stringify(shell));
  vm.runInNewContext(source, { self, caches, URL, Request, fetch: async request => { network.push(request); throw new Error('offline'); } });
  const dispatch = async type => { let task; handlers.get(type)({ waitUntil: p => { task = p; } }); await task; };
  function get(path, extras = {}) {
    let response;
    handlers.get('fetch')({ request: { url: absolute(path), method: 'GET', mode: 'cors', ...extras }, respondWith: value => { response = value; } });
    return response;
  }
  return { caches, cacheStores, deleted, network, self, handlers, dispatch, get,
    skipped: () => skipped, claimed: () => claimed };
}
test('the installed shell, worker and navigation remain usable offline with one release', async () => {
  const w = worker(); await w.dispatch('install');
  for (const path of ['?opened=app', 'index.html?updated=1', 'src/app.mjs', 'src/worker.mjs', 'data/navigation.json']) {
    const response = await w.get(path, { mode: path.startsWith('?') || path.startsWith('index') ? 'navigate' : 'cors' });
    assert.equal(response.status, 200); assert.match(await response.text(), /^installed:/);
  }
  assert.equal(w.network.length, 0);
});
test('the app never intercepts other Pages projects or caches live market requests', async () => {
  const w = worker(); await w.dispatch('install');
  for (const [path, extras] of [['../RHW/', { mode: 'navigate' }], ['../DTR/src/app.js', {}],
    ['https://darkstat.dd84ai.com/api/pobs', {}], ['https://darkstat.dd84ai.com/api/commodities', { method: 'POST' }], ['unknown.json', {}]])
    assert.equal(w.get(path, extras), undefined);
});
test('activation cleans only this app scope and updating requires the explicit restart message', async () => {
  const w = worker();
  await w.caches.open('rhw-v4.0.2-pwa-existing'); await w.caches.open('waypoint-app:/OTHER/:old');
  await w.caches.open('waypoint-app:/WAYPOINT/:old');
  await w.dispatch('install'); await w.dispatch('activate');
  assert.deepEqual(w.deleted, ['waypoint-app:/WAYPOINT/:old']); assert.equal(w.claimed(), 1); assert.equal(w.skipped(), 0);
  w.handlers.get('message')({ data: { type: 'SKIP_WAITING' } }); assert.equal(w.skipped(), 1);
});
