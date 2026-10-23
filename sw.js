// Keeps Hand Magic working offline (version 6).
// The page and small files: internet first, saved copy when offline.
// Big tracker files (from Google's servers): saved copy first, they never change.
const CACHE = "hand-magic-v6";
const CORE = ["./", "index.html", "hm-worker.js?v=6", "manifest.json", "icon-192.png", "icon-512.png"];
const BIG_HOSTS = ["cdn.jsdelivr.net", "storage.googleapis.com"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(f => c.add(f).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
function keep(req, res) {
  if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
  return res;
}
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const big = BIG_HOSTS.includes(url.hostname) || /\.(wasm|task|tflite|data|binarypb|png)$/.test(url.pathname);
  if (big) {
    e.respondWith(caches.match(req, { ignoreVary: true }).then(hit => hit || fetch(req).then(res => keep(req, res))));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(fetch(req).then(res => keep(req, res)).catch(() =>
    caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match("index.html"))));
});
