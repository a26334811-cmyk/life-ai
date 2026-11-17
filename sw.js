/* life-ai service worker.
   - Keeps the app shell so the planner, habits and timer open without a network.
   - Network first: when online you get the newest files; the cache is the fallback (also when the network takes over 3 seconds).
   - Never touches Netlify functions or other origins (live job / exam data must stay live).
   - Shows the "focus finished" notification and opens the app when it is tapped. */
const CACHE = 'life-ai-shell-v2';
const NETWORK_TIMEOUT_MS = 3000;
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
  // Ask the network first, but on a weak signal do not leave a blank screen: after NETWORK_TIMEOUT_MS show the
  // saved copy right away and let the download finish in the background so the next open has the newest files.
  const network = fetch(request).then(response => {
    /* Addresses with a query (e.g. a shared job link: index.html?title=..&url=..) are never stored. */
    if (response && response.ok && response.type === 'basic' && !url.search) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
    }
    return response;
  });
  const saved = () => caches.match(request, { ignoreSearch: true }).then(hit =>
    hit || (request.mode === 'navigate' ? caches.match('index.html') : null));
  let timer;
  const first = Promise.race([
    network.then(response => ({ response }), () => ({ failed: true })),
    new Promise(resolve => { timer = setTimeout(() => resolve({ slow: true }), NETWORK_TIMEOUT_MS); })
  ]);
  event.waitUntil(network.catch(() => {}));
  event.respondWith(first.then(result => {
    clearTimeout(timer);
    if (result.response) return result.response;
    return saved().then(hit => hit || (result.slow ? network.catch(() => Response.error()) : Response.error()));
  }));
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
