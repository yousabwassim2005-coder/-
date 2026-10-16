const CACHE_NAME = 'didymus-shell-v1';
const SHELL = ['./', './index.html', './styles.css', './app.js', './config.js', './manifest.webmanifest', './logo.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('didymus-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(caches.match(request).then(cached => {
    const update = fetch(request).then(response => {
      if (response.ok && response.type === 'basic') return caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone())).then(() => response);
      return response;
    });
    if (cached) { update.catch(() => undefined); return cached; }
    return update.catch(() => request.mode === 'navigate' ? caches.match('./index.html') : Promise.reject(new Error('offline')));
  }));
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'CACHE_URL' || typeof event.data.url !== 'string') return;
  const target = new URL(event.data.url, self.location.href);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(caches.open(CACHE_NAME).then(cache => fetch(target.href).then(response => {
    if (!response.ok) throw new Error('download failed');
    return cache.put(target.href, response);
  })).catch(() => undefined));
});
