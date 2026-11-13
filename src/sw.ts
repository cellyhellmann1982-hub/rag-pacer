// Service Worker: lädt beim Installieren die komplette App in den Cache und
// beantwortet danach alle Anfragen aus dem Cache (offline nutzbar).
// Der Platzhalter wird beim Build durch "Version|Datei1|Datei2|…" ersetzt (siehe vite.config.ts).

const sw = self as unknown as ServiceWorkerGlobalScope;

const [VERSION, ...FILES] = '__PRECACHE_MANIFEST__'.split('|');
const PREFIX = 'rag-pacer-';
const CACHE = `${PREFIX}${VERSION}`;

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['./', ...FILES.filter((f) => f !== 'index.html')]))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== sw.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await cache.match('./');
        if (shell) return shell;
      }
      return fetch(req);
    }),
  );
});
