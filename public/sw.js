/* Halstead Bay service worker (2026-09-24): the game plays offline.
   - the page (navigations): network first, the cached copy when offline --
     so a deploy is picked up on the next load, never held back;
   - /assets/* (content-hashed bundles): cache first, forever;
   - everything else same-origin (models, textures, the district file):
     cache first. Each page load checks /offline.json; a new build's version
     empties the cache, so a deploy never leaves stale models behind and a
     normal load never re-downloads what is already cached.
   SAVE OFFLINE on the title card fills the cache from /offline.json. */
const CACHE = 'hb-offline-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('hb-offline-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
async function checkVersion() {
  try {
    const res = await fetch('/offline.json', { cache: 'no-store' });
    if (!res.ok) return;
    const { version } = await res.clone().json();
    const cache = await caches.open(CACHE);
    const old = await cache.match('/__version');
    const had = old ? await old.text() : null;
    if (had !== version) {
      if (had !== null) for (const k of await cache.keys()) { const p = new URL(k.url).pathname; if (p !== '/') await cache.delete(k); }
      await cache.put('/__version', new Response(version));
    }
  } catch { /* offline: keep everything */ }
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.headers.has('range')) return;            // partial (audio) requests go straight to the network
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(CACHE)).put('/', res.clone());
        e.waitUntil(checkVersion());
        return res;
      } catch {
        return (await caches.match('/')) || (await caches.match(req)) || Response.error();
      }
    })());
    return;
  }
  const hashed = url.pathname.startsWith('/assets/');
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic' && (hashed || !url.pathname.endsWith('offline.json'))) cache.put(req, res.clone());
    return res;
  })());
});
