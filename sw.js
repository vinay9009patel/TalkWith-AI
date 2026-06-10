// SW Version: 3.2 (Added roles_data.js to cache)
const CACHE_NAME = 'cw-v3.2';
const ASSETS = [
  './',
  './index.html',
  './roles_data.js',
  './manifest.json',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS).catch(err => {
        console.warn("SW Cache error:", err);
      });
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = event.request.url;

  if (url.includes('cloudflareinsights.com') || url.includes('/cdn-cgi/rum') || url.includes('google-analytics')) {
    event.respondWith(new Response(null, { status: 200 }));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) return response;
        return caches.match(event.request).then(cached => cached || response);
      })
      .catch(() => {
        return caches.match(event.request).then(cached => {
          return cached || new Response('', { status: 404, statusText: 'Offline' });
        });
      })
  );
});
