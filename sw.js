/* Build replaces these values with a content revision and complete app shell. */
const REVISION = '__WAYPOINT_REVISION__';
const APP_SHELL = /* __WAYPOINT_SHELL__ */ [];
const ROOT = new URL('./', self.location.href);
const CACHE_PREFIX = `waypoint-app:${ROOT.pathname}:`;
const CACHE_NAME = `${CACHE_PREFIX}${REVISION}`;
const urls = new Set(APP_SHELL.map(path => new URL(path, ROOT).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL.map(path => new Request(new URL(path, ROOT), { cache: 'reload' })));
    // Updated releases wait until the user chooses to restart the app.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  // Other Pages projects, external fonts, and live Darkstat requests bypass this cache.
  if (request.method !== 'GET' || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  const home = request.mode === 'navigate' && [ROOT.pathname, `${ROOT.pathname}index.html`].includes(url.pathname);
  url.search = ''; url.hash = '';
  const resource = home ? new URL('index.html', ROOT).href : url.href;
  if (!urls.has(resource)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(resource) || fetch(request);
  })());
});
