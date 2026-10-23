// sw.js
const VERSION = 'v1'; // ⚠️ CAMBIA ESTO cada vez que subas cambios importantes
const CACHE_ESTATICO = `gestor-estatico-${VERSION}`;
const CACHE_EXTERNO = `gestor-externo-${VERSION}`;

// Archivos propios que deben estar disponibles offline sí o sí.
const APP_SHELL = [
  './',
  './index.html',
  './css/base.css',
  './css/temas.css',
  './css/layout.css',
  './css/componentes.css',
  './css/modulos/tareas.css',
  './css/modulos/imagenes.css',
  './css/modulos/gastos.css',
  './js/nucleo/util.js',
  './js/nucleo/dom.js',
  './js/nucleo/almacen.js',
  './js/nucleo/app.js',
  './js/nucleo/blobstore.js',
  './js/modulos/tareas.js',
  './js/modulos/imagenes.js',
  './js/modulos/gastos.js',
  './js/vendor/masonry.pkgd.min.js',
  './manifest.json'
];

// --- INSTALL: Precachear el App Shell ---
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Fuerza a que el nuevo SW se active cuanto antes
  event.waitUntil(
    caches.open(CACHE_ESTATICO).then((cache) => {
      console.log('[SW] Precacheando App Shell');
      return cache.addAll(APP_SHELL);
    })
  );
});

// --- ACTIVATE: Limpiar cachés antiguas ---
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_ESTATICO && key !== CACHE_EXTERNO) {
            console.log('[SW] Borrando caché antigua:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim()) // Toma el control de las pestañas abiertas
  );
});

// --- FETCH: Estrategias de red ---
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Navegación (HTML) -> Network First
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => {
        return caches.match(request).then((cached) => {
          return cached || caches.match('./index.html'); // Fallback
        });
      })
    );
    return;
  }

  // 2. Chart.js desde CDN -> Cache First
  if (url.origin === 'https://cdn.jsdelivr.net' && url.pathname.includes('chart.js')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        return cached || fetch(request).then((response) => {
          // Clonamos la respuesta para guardarla en caché
          const responseToCache = response.clone();
          caches.open(CACHE_EXTERNO).then((cache) => {
            cache.put(request, responseToCache);
          });
          return response;
        });
      })
    );
    return;
  }

  // 3. Recursos locales (CSS, JS, Imágenes) -> Stale-While-Revalidate
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetched = fetch(request).then((response) => {
          // Actualizamos la caché en segundo plano
          const responseToCache = response.clone();
          caches.open(CACHE_ESTATICO).then((cache) => {
            cache.put(request, responseToCache);
          });
          return response;
        }).catch(() => cached); // Si falla la red, devolvemos lo que haya en caché

        return cached || fetched;
      })
    );
  }
});