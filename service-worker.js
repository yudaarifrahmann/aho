const CACHE_NAME = 'AHOv4-cache-v4'; // Naikkan versi cache
const urlsToCache = [
  '/index.html?v=4',
  '/public/home.html?v=4',
  '/public/attendance.html?v=4',
  '/public/history.html?v=4',
  '/manifest.json?v=4',
  '/service-worker.js?v=4',
  '/assets/img/iconapp.png?v=4',
  '/assets/img/logonew.png?v=4',
  '/assets/css/tailwind.css?v=4' // Pastikan CSS ikut di-refresh!
];

// Install Event - Cache ulang file
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[Service Worker] Caching all files...');
      return cache.addAll(urlsToCache);
    }).then(() => self.skipWaiting()) // Paksa aktifkan SW baru langsung
  );
});

// Activate Event - Hapus cache lama
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Menghapus cache lama:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => {
      console.log('[Service Worker] Cache baru siap digunakan:', CACHE_NAME);
      return self.clients.claim(); // Terapkan SW baru langsung
    })
  );
});

// Fetch Event - Ambil dari cache dulu, lalu update dari network jika perlu
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(response => {
      return response || fetch(event.request).then(networkResponse => {
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, networkResponse.clone()); // Simpan update terbaru
          return networkResponse;
        });
      });
    }).catch(() => caches.match('/index.html')) // Fallback jika offline
  );
});
