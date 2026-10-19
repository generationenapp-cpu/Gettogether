// Nur offline: gemmer appen og sprogfiler, så den virker uden internet.
const V = "nur-v2";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(CORE))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/") || u.pathname.endsWith(".mp3")) return;
  // Fællesskabet har sin egen service worker og må aldrig gemmes her
  if (u.pathname.startsWith("/faellesskab/") || u.pathname === "/faellesskab") return;
  // Netværk først for siden (så opdateringer kommer med), cache som reserve. Cache først for sprog og ikoner.
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then(r => { caches.open(V).then(c => c.put("./index.html", r.clone())); return r; })
      .catch(() => caches.match("./index.html")));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); }
    return r;
  })));
});
