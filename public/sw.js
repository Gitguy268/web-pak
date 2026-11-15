// Offline support and the share target. Network first for the page and the build (so updates
// arrive), the cache when offline. Files shared to web-pak from another app arrive as a POST to
// ./share: they're parked in a cache, and the page picks them up from ?shared=1.
const CACHE = 'web-pak-v1';
const BASE = new URL('./', self.location).pathname;

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll([BASE, BASE + 'index.html'])).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'web-pak-share').map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (e.request.method === 'POST' && url.pathname === BASE + 'share') {
    e.respondWith((async () => {
      const form = await e.request.formData(), inbox = await caches.open('web-pak-share');
      for (const f of form.getAll('files')) if (f instanceof File) await inbox.put(new Request(`${BASE}shared/${Date.now()}/${encodeURIComponent(f.name)}`), new Response(f));
      return Response.redirect(`${BASE}?shared=1`, 303);
    })());
    return;
  }
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request).then(r => r || caches.match(BASE))));
});
