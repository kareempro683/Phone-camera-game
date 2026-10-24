// Hand Magic Simple: saves everything on the phone so it works offline.
// Page and code: internet first (so updates show), saved copy when offline. Models: saved copy first.
const CACHE = "hand-magic-simple-1";
const FILES = ["./", "index.html", "worker.js?v=simple-1", "manifest.json", "icon-192.png", "icon-512.png", "lib/human.js", "lib/tfjs-backend-wasm.wasm", "lib/tfjs-backend-wasm-simd.wasm", "models/handtrack.json", "models/handtrack.bin", "models/handlandmark-lite.json", "models/handlandmark-lite.bin"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  const keep = res => { if (res && res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)).catch(() => {}); } return res; };
  if (/\/models\/|\.wasm$/.test(new URL(req.url).pathname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(keep)));
    return;
  }
  e.respondWith(fetch(req).then(keep).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match("index.html"))));
});
