// GetTogether service worker – gør appen installerbar og hurtig. Chatdata caches aldrig.
const CACHE = 'gt-faelles-v1';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'config.js', 'privatliv.html', 'privatliv.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Supabase m.m. går altid direkte på nettet
  // Netværk først (altid nyeste version), cache som reserve når man er offline
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
