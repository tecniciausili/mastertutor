// Service Worker - Mastertutor
// Strategia: prima la rete per i file dell'app (stessa origine), cache senza rete.
// I dati (audio, video, impostazioni) NON passano di qui: stanno in
// localStorage e IndexedDB. YouTube e le chiamate /api vanno sempre in rete.
// Tutte le cache dell'app iniziano con PREFISSO: sullo stesso dominio (per esempio
// assistivetech.it/webapp/) ci sono altre app, e le loro cache non vanno toccate.
const PREFISSO = 'mastertutor_';
const CACHE_NAME = `${PREFISSO}v1.0.16`;
const URLS_TO_CACHE = [
  './',
  './index.html',
  './css/styles.css',
  './js/lib/lame.min.js',
  './js/util.js',
  './js/archivio.js',
  './js/elabora-audio.js',
  './js/presa.js',
  './js/presa-webpubsub.js',
  './js/presa-nativa.js',
  './js/scheda-presa.js',
  './js/configura-prese.js',
  './js/riproduttore.js',
  './js/ordinabile.js',
  './js/educatore.js',
  './js/utente.js',
  './js/app.js',
  './manifest.json',
  './assets/audio/anticipatore.mp3',
  './assets/fonts/bootstrap-icons/bootstrap-icons.css',
  './assets/fonts/bootstrap-icons/bootstrap-icons.woff',
  './assets/fonts/bootstrap-icons/bootstrap-icons.woff2',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-192.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(URLS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // Si cancellano solo le versioni vecchie di questa app
      .then((nomi) => Promise.all(nomi
        .filter((n) => n.startsWith(PREFISSO) && n !== CACHE_NAME)
        .map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Altre origini (YouTube, miniature) e API: gestione normale del browser
  if (url.origin !== self.location.origin || url.pathname.includes('/api/') || request.method !== 'GET') {
    return;
  }

  // Prima la rete: con la connessione si usano sempre i file aggiornati (niente
  // versioni vecchie dopo un aggiornamento); senza rete si usa la copia in cache.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && !response.redirected) {
          const copia = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copia)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((cached) => {
        if (cached) {
          return cached;
        }
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return Response.error();
      }))
  );
});
