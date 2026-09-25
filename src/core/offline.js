/**
 * Offline play (2026-09-24, moved here 2026-09-25 so the LOADING PAGE can
 * offer it). public/sw.js caches whatever the game fetches; save() fills the
 * rest from /offline.json (tools/offline-list.mjs writes it at build time),
 * so the whole city plays with no connection. Not under the dev server:
 * vite's module graph is not a cacheable site.
 *
 * main.js imports this module, and imports run before main's body -- so this
 * is live while the boot screen is still up (main awaits the GPU and the
 * district behind it). One shared state; every button (boot page, desktop
 * chip, phone drawer) subscribes to it.
 */
const CACHE = 'hb-offline-v1';
const subs = new Set();
export const offline = {
  ok: typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof caches !== 'undefined' && !import.meta.env.DEV,
  state: 'checking',   // checking | ready | saving | done | failed | off
  mb: 0, pct: 0, failed: 0,
  on(fn) { subs.add(fn); fn(offline); return () => subs.delete(fn); },
  save: async () => {},
};
const emit = () => { for (const fn of subs) { try { fn(offline); } catch { /* a UI that went away */ } } };

if (!offline.ok) { offline.state = 'off'; }
else {
  navigator.serviceWorker.register('/sw.js').catch((e) => { console.warn('sw:', e.message); offline.state = 'off'; emit(); });
  let list = null;
  (async () => {
    try {
      list = await (await fetch('/offline.json', { cache: 'no-store' })).json();
      const cache = await caches.open(CACHE);
      const keys = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
      const have = list.files.filter((f) => keys.has(f)).length;
      offline.mb = Math.round(list.bytes / 1e6);
      offline.state = have >= list.files.length ? 'done' : 'ready';
    } catch { offline.state = 'off'; }
    emit();
  })();
  offline.save = async () => {
    if (!list || offline.state === 'saving' || offline.state === 'done') return;
    offline.state = 'saving'; offline.pct = 0; offline.failed = 0; emit();
    const cache = await caches.open(CACHE);
    let done = 0;
    const todo = [...list.files];
    const worker = async () => {
      while (todo.length) {
        const f = todo.shift();
        try { if (!(await cache.match(f))) { const r = await fetch(f); if (r.ok) await cache.put(f, r); else offline.failed++; } } catch { offline.failed++; }
        done++;
        offline.pct = Math.round((done / list.files.length) * 100); emit();
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    try { await navigator.storage?.persist?.(); } catch { /* best effort: ask the browser not to evict it */ }
    offline.state = offline.failed ? 'failed' : 'done'; emit();
  };
}

/* The boot page button (index.html #bootoffline). */
if (typeof document !== 'undefined') {
  const b = document.getElementById('bootoffline');
  if (b) {
    b.addEventListener('click', (e) => { e.stopPropagation(); offline.save(); });
    offline.on((o) => {
      b.hidden = o.state === 'off' || o.state === 'checking';
      b.disabled = o.state === 'saving' || o.state === 'done';
      b.innerHTML = o.state === 'done' ? 'SAVED OFFLINE ✓ <span>plays with no internet</span>'
        : o.state === 'saving' ? `SAVING FOR OFFLINE… <b>${o.pct}%</b> <span>keep this tab open</span>`
        : o.state === 'failed' ? `${o.failed} FILES FAILED · <b>RETRY</b>`
        : `⤓ SAVE OFFLINE <span>${o.mb} MB · play with no internet</span>`;
    });
  }
}
