const CACHE = 'wfw-v3';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './script.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => k!==CACHE && caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  // Network-first for HTML and JS to avoid stale pages on updates
  const isHtml = req.destination === 'document' || url.pathname.endsWith('.html') || url.pathname === '/';
  const isScript = req.destination === 'script' || url.pathname.endsWith('.js');

  if (isHtml || isScript) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(()=> caches.match(req))
    );
    return;
  }

  // Cache-first for other static assets
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }).catch(()=>cached))
  );
});
