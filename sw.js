// Permite instalar «Mis nóminas» como app.
// Aquí SOLO se guarda la web (páginas, estilos, iconos). Las nóminas y los datos NUNCA se guardan
// en la caché: se piden siempre a Supabase con enlaces de 60 segundos.
// Si cambias la lista de archivos, sube también el número de VERSION.
const VERSION = 'v1';
const CACHE = `nominas-${VERSION}`;
const CARCASA = ['./', 'index.html', 'styles.css', 'app.js', 'leer-nominas.js', 'config.js', 'teams.js', 'manifest.json', 'logo.svg',
  'favicon-32.png', 'favicon-48.png', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(CARCASA.map(u => c.add(u)))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('nominas-') && k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
// Solo archivos de esta web (mismo origen). Red primero; sin conexión, lo guardado.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copia = res.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
