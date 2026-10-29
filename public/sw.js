const CACHE = 'nstore-next-static-v1'
self.addEventListener('install', event => { self.skipWaiting(); event.waitUntil(caches.open(CACHE).then(cache => cache.add('/offline.html'))) })
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('nstore-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())) })
self.addEventListener('fetch', event => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/') || req.headers.has('rsc') || url.searchParams.has('_rsc')) return
  if (req.mode === 'navigate') event.respondWith(fetch(req).catch(() => caches.match('/offline.html')))
})
