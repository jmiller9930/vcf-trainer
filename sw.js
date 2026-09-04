/* VCF 9 Trainer — service worker: network-first for app shell so deploys win. */

const CACHE_NAME = 'vcf-trainer-v29';

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
  './data/figures.json',
  './data/acronyms.json'
];

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

function isAppShell(url, req) {
  if (req.mode === 'navigate') return true;
  const p = url.pathname;
  return /\.(html|js|css|json)$/i.test(p) || p.endsWith('/') || p.endsWith('/vcf-trainer');
}

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
  if (event.data === 'skipWaiting' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    /* App shell: network-first so GitHub Pages deploys appear without manual hard refresh. */
    if (isAppShell(url, req)) {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
          return fresh;
        }
      } catch (err) { /* fall through to cache */ }
      const cachedShell = await caches.match(req, { ignoreSearch: true });
      if (cachedShell) return cachedShell;
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      return new Response('Offline and this resource is not cached.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    /* Images / icons: cache-first. */
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
      return new Response('Offline and this resource is not cached.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  })());
});
