/* Offline shell for radio.sala.company: the app's own files are kept in the browser, so the site opens
   instantly and still opens with no network (your lists, favorites and songs are already in IndexedDB).
   Streams, Radio Browser, the relay and other outside services are never cached.
     page (index.html)   network first, cached copy when offline
     app files           cached copy first, refreshed in the background
     player libraries    cached once from the CDN */
const CACHE = 'radio-shell-v1';
const SHELL = ['./', 'index.html', 'style.css', 'favicon.svg', 'favicon-48.png', 'apple-touch-icon.png', 'manifest.webmanifest',
  'js/core.js', 'js/lists.js', 'js/health.js', 'js/guide.js', 'js/radio.js', 'js/player.js', 'js/nowplaying.js', 'js/car.js', 'js/ipod.js', 'js/app.js'];
const LIBS = /^https:\/\/(cdn\.jsdelivr\.net\/npm\/(hls\.js|country-flag-emoji-polyfill)|fonts\.(googleapis|gstatic)\.com)/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const sameOrigin = url => url.origin === self.location.origin;
const isPage = req => req.mode === 'navigate' || (req.destination === 'document');

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (isPage(req)) return e.respondWith(networkFirst(req));
  if (sameOrigin(url)) return e.respondWith(staleWhileRevalidate(req));
  if (LIBS.test(req.url)) return e.respondWith(cacheFirst(req));
  // everything else (streams, Radio Browser, relay, mirrors): straight to the network
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    // a slow network shouldn't hold the page back: after 4 s the cached copy is used
    const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 4000))]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req)) || (await cache.match('index.html')) || Response.error();
  }
}
async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const refresh = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  return cached || (await refresh) || Response.error();
}
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  } catch {
    return Response.error();
  }
}
