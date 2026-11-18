// Service worker: app disponibile senza rete + mappe e caratteri già visti tenuti in memoria
const CACHE = 'copilota-v6';
const FILES = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/pacenotes.js', 'js/cars.js', 'vendor/maplibre/maplibre-gl.js', 'vendor/maplibre/maplibre-gl.css', 'vendor/jszip.min.js', 'manifest.webmanifest', 'icon-192.png', 'nosleep.mp4'];
const TILES = 'copilota-mappe';
const TILE_HOSTS = /(^|\.)tile\.openstreetmap\.org$|(^|\.)tile\.opentopomap\.org$|^server\.arcgisonline\.com$|^fonts\.(googleapis|gstatic)\.com$/;
const MAX_TILES = 4000;
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== TILES).map(k => caches.delete(k))))); self.clients.claim(); });
let puts = 0;
async function trim(c) {
  const keys = await c.keys();
  if (keys.length > MAX_TILES) for (const k of keys.slice(0, keys.length - MAX_TILES + 300)) await c.delete(k);
}
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  // pezzi di mappa e caratteri: prima la memoria, poi la rete (così funzionano anche senza campo)
  if (TILE_HOSTS.test(u.hostname)) {
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      try {
        const r = await fetch(e.request);
        if (r.ok) { c.put(e.request, r.clone()); if (++puts % 100 === 0) trim(c); }
        return r;
      } catch (err) { return Response.error(); }
    }));
    return;
  }
  if (u.origin !== location.origin) return;
  // file dell'app: prima la rete (aggiornamenti), poi la memoria
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
