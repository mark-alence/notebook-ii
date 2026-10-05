// Lets the installed app open without a network connection. Every request
// goes to the network first, so a new version shows up as soon as it is
// published; the saved copy is used only when the network fails. The request
// asks the site whether the file has changed (no-cache) rather than taking
// the browser's own copy, which GitHub Pages lets it keep for 10 minutes; an
// unchanged file costs only a short "not modified" reply.
const CACHE = 'notebook-ii-v3';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/cp437.js', 'js/exporters.js', 'js/importers.js', 'js/model.js', 'js/platform.js',
  'js/printform.js', 'js/sample.js', 'js/search.js', 'js/storage.js', 'js/theme.js', 'js/appearance.js', 'js/pdf.js', 'js/version.js',
  'js/vendor/jspdf.umd.min.js', 'fonts/DejaVuSansMono.ttf',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit ?? caches.match('index.html'))));
});
