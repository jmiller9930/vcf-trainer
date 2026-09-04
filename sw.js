/* VCF 9 Trainer — service worker: cache-first offline shell. */

const CACHE_NAME = 'vcf-trainer-v7';

/* Files the app cannot run without — a failure here fails the install. */
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/data-loader.js',
  './js/quiz-engine.js',
  './js/ai-trainer.js',
  './js/app.js',
  './data/modules.json',
  './data/questions.json',
  './data/delta91.json',
  './data/figures.json'
];

/* Nice-to-have files; cached individually so a missing icon can't break install. */
const OPTIONAL_ASSETS = [
  './icons/icon-192.png',
  './icons/icon-512.png',
  './assets/landing-hero-cloud-automation.jpg',
  './data/figures/fig-design-decision-process.png',
  './data/figures/fig-business-initiatives.png',
  './data/figures/fig-independent-vsphere.png',
  './data/figures/fig-dc-topology.png',
  './data/figures/fig-logical-design-template.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    await Promise.all(OPTIONAL_ASSETS.map(url => cache.add(url).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(name => (name === CACHE_NAME ? null : caches.delete(name))));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;

    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      /* Offline and uncached: fall back to the app shell for navigations. */
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      return new Response('Offline and this resource is not cached.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  })());
});
