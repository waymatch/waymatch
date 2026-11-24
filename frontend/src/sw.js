import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

precacheAndRoute(self.__WB_MANIFEST);

// Le pagine dell'app (BrowserRouter) sono tutte servite da index.html: offline, ricaricando
// /login o /i-miei-viaggi si usa la copia in cache. Escluse le API e i file del server.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), {
  denylist: [/^\/api\//, /^\/uploads\//, /^\/manifest\.webmanifest$/, /\.[a-z0-9]+$/i],
}));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* payload non JSON */ }

  const title = data.title || 'WayMatch';
  const options = {
    body: data.body || '',
    icon: data.icon || '/brand/icon-192.png',
    badge: '/brand/badge-96.png',
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const finestre = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of finestre) {
      if (!('focus' in client) || !('navigate' in client)) continue;
      // navigate() rifiuta per le finestre non controllate da questo service worker: in quel
      // caso si prova la finestra successiva, e alla fine se ne apre una nuova.
      try {
        const navigata = await client.navigate(url);
        return (navigata || client).focus();
      } catch (e) { /* finestra non navigabile */ }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
