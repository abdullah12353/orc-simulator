// ORC NONSENSE service worker (#42): makes the PWA installable, shows pushes, and opens the story a
// push is about when it's tapped. Plain JS in public/ so it's served as-is at /sw.js (scope /).
// No caching of app assets: the game is live data, so offline it just says so.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const OFFLINE = `<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ORC NONSENSE</title><body style="background:#1c1917;color:#f5f5f4;font-family:system-ui,sans-serif;padding:2rem">
<h1>ORC NONSENSE</h1><p>The orcs are out of reach. Check your signal and try again.</p></body></html>`;

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(OFFLINE, { headers: { 'content-type': 'text/html; charset=utf-8' } })),
  );
});

// The server sends { title, body, url, tag } (packages/server/src/pushes.ts PushPayload). Never gold.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'ORC NONSENSE', {
      body: data.body || '',
      tag: data.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' },
    }),
  );
});

// Tapping a push opens its story: reuse an open window if there is one, else open the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ('navigate' in client) return client.navigate(url);
        return;
      }
      return self.clients.openWindow(url);
    })(),
  );
});
