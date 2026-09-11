const CACHE = 'fieldflow-v12';
const ASSETS = ['./', './index.html', './manifest.json', './icon.svg', './icon-192.png', './icon-512.png', './icon-512-maskable.png'];

async function cacheAppShell() {
  const cache = await caches.open(CACHE);
  const indexResponse = await fetch('./index.html', { cache:'reload' });
  const html = await indexResponse.clone().text();
  const linkedAssets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map(match => new URL(match[1], self.location.href))
    .filter(url => url.origin === self.location.origin)
    .map(url => url.href);
  await cache.put('./index.html', indexResponse);
  await cache.addAll([...new Set([...ASSETS, ...linkedAssets])]);
}

self.addEventListener('install', event => event.waitUntil(cacheAppShell().then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => {
  const earlier = keys.filter(key => key.startsWith('fieldflow-') && key !== CACHE).at(-1);
  return Promise.all(keys.filter(key => key.startsWith('fieldflow-') && key !== CACHE && key !== earlier).map(key => caches.delete(key)));
}).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && response.type === 'basic') {
      const clone = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, clone));
    }
    return response;
  }).catch(() => caches.match(event.request).then(hit => hit || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
