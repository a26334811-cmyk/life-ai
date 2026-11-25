/* life-ai service worker.
   - Keeps the app shell so the planner, habits and timer open without a network.
   - Network first: when online you get the newest files; the cache is the fallback (also when the network takes over 3 seconds).
   - Never touches Netlify functions or other origins (live job / exam data must stay live).
   - Shows the "focus finished" notification and opens the app when it is tapped. */
const CACHE = 'life-ai-shell-v2';
const NETWORK_TIMEOUT_MS = 3000;
// Must all be saved: if one fails the install fails and the browser tries again later.
const CORE = ['./', 'index.html', 'logic.js', 'manifest.json'];
// Nice to have: a missing icon must not block the install.
const OPTIONAL = ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE).then(() => Promise.allSettled(OPTIONAL.map(url => cache.add(url)))))
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
      // waitUntil keeps the worker alive until the copy is really stored (it may otherwise be stopped half-way)
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {}));
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
    if (result.response) {
      const answer = result.response;
      if (answer.ok) return answer;
      // The server answered with an error (502, 503, 404...). Prefer the saved copy; show the error only when there is none.
      return caches.match(request, { ignoreSearch: true }).then(hit =>
        hit || (answer.status >= 500 && request.mode === 'navigate' ? caches.match('index.html') : null)
      ).then(hit => hit || answer);
    }
    return saved().then(hit => hit || (result.slow ? network.catch(() => Response.error()) : Response.error()));
  }));
});

/* A reminder pushed by the server (see netlify/functions/push-send.mjs) arrives even when the app is closed.
   It carries only a short title and the screen to open - never the text of a daily record. */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  if (!data || typeof data !== 'object') data = {};
  const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim().slice(0, 80) : '오늘 하루는 어땠나요?';
  const body = typeof data.body === 'string' ? data.body.slice(0, 160) : '';
  const screen = ['calendar', 'journal'].includes(data.screen) ? data.screen : 'journal';
  // One tag: a second reminder replaces the first instead of piling up.
  event.waitUntil(self.registration.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'life-ai-journal', data: { screen } }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  // A notification can name the screen it belongs to (the daily-record reminder asks for 'journal').
  const data = event.notification.data;
  const screen = data && ['calendar', 'journal'].includes(data.screen) ? data.screen : 'calendar';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const open = clients.find(client => 'focus' in client);
      if (open) {
        try { open.postMessage({ type: 'open-screen', screen }); } catch (e) {}
        return open.focus();
      }
      return self.clients.openWindow('./index.html?screen=' + screen);
    })
  );
});
