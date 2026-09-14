// Scope all offline storage to this app, including GitHub Pages project paths.
const PREFIX = 'farm-cost-planner-';
const CACHE = `${PREFIX}${self.registration.scope}-v2`;
const appUrl = (path) => new URL(path, self.registration.scope).href;
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([
    appUrl('./'), appUrl('index.html'), appUrl('manifest.webmanifest'), appUrl('favicon.svg'),
  ])));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith(`${PREFIX}${self.registration.scope}-`) && key !== CACHE)
    .map((key) => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.registration.scope)) return;
  // Refresh online so deployments do not leave users on a stale app shell.
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    if (event.request.mode === 'navigate') {
      const shell = await caches.match(appUrl('index.html'));
      if (shell) return shell;
    }
    return Response.error();
  }));
});
