// Păstrează aplicația pe telefon, ca să se deschidă și fără internet.
// Strategie: întâi rețeaua (ca versiunile noi să apară imediat), copia locală doar fără internet.
// Nu atinge niciodată cererile către Google (date, autentificare).
const CACHE = 'jm-1.2.0';
const SHELL = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest',
  'fonts/Lora.woff2', 'fonts/Lora-Italic.woff2',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => fetch(new Request(u, { cache: 'reload' })).then(r => r.ok && c.put(u, r)))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  const key = e.request.mode === 'navigate' ? 'index.html' : e.request;
  e.respondWith(
    fetch(u.href, { cache: 'no-cache' })
      .then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(key, c)); } return r; })
      .catch(() => caches.match(key, { ignoreSearch: true }))
  );
});
