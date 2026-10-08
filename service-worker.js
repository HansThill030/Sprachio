const CACHE_NAME = 'sprachio-v5';
const SHELL_FILES = [
  '/',
  '/trainer-hub',
  '/trainer',
  '/aufgabe-turma',
  '/login',
  '/historico',
  '/vokabeln',
  '/freie-korrektur',
  '/professor',
  '/minhas-turmas',
  '/assets/mark.png',
  '/datenschutz',
  '/nutzungsbedingungen',
  '/css/styles.css',
  '/js/app.js',
  '/js/config.js',
  '/js/theme.js',
  '/js/consent.js',
  '/assets/mark.png',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first para tudo que envolve API (Supabase, Gemini) — nunca cachear dados dinâmicos.
// Cache-first apenas para o "shell" estático (HTML/CSS/JS/ícones).
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // não intercepta chamadas externas (Supabase etc.)
  if (event.request.method !== 'GET') return;

  // HTML/JS precisam sempre tentar a versão atual do servidor primeiro.
  // Caso contrário, uma versão antiga do app.js pode continuar sendo usada
  // mesmo depois de um deploy e quebrar o fluxo de entregas.
  const isAppCode =
    event.request.destination === 'document' ||
    event.request.destination === 'script' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js');

  event.respondWith(
    (isAppCode
      ? fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        }).catch(() => caches.match(event.request))
      : caches.match(event.request).then((cached) => {
          const fetchPromise = fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.ok) {
                const clone = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
              }
              return networkResponse;
            })
            .catch(() => cached);
          return cached || fetchPromise;
        })
    )
  );
});
