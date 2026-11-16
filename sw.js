/* life-ai service worker.
   - Keeps the app shell so the planner, habits and timer open without a network.
   - Network first: when online you always get the newest files; the cache is only the fallback.
   - Never touches Netlify functions or other origins (live job / exam data must stay live).
   - Shows the "focus finished" notification and opens the app when it is tapped. */
const CACHE = 'life-ai-shell-v1';
const SHELL = ['./', 'index.html', 'logic.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/.netlify/')) return;
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true }).then(hit =>
          hit || (request.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const open = clients.find(client => 'focus' in client);
      if (open) return open.focus();
      return self.clients.openWindow('./index.html?screen=calendar');
    })
  );
});
