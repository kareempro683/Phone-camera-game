// Hand Magic Simple: saves everything on the phone so it works offline,
// and turns on "all cores" mode (the headers below) so tracking can use every processor core.
const CACHE = "hand-magic-simple-3-pro-2";
const FILES = ["./", "index.html", "worker.js?v=simple-3", "manifest.json", "icon-192.png", "icon-512.png", "lib/human.js",
  "lib/tfjs-backend-wasm.wasm", "lib/tfjs-backend-wasm-simd.wasm", "lib/tfjs-backend-wasm-threaded-simd.wasm",
  "models/handtrack.json", "models/handtrack.bin", "models/handlandmark-lite.json", "models/handlandmark-lite.bin",
  "laptop.html", "pro-worker.js?v=pro-2", "models/blazeface.json", "models/blazeface.bin", "models/facemesh.json", "models/facemesh.bin", "models/selfie.json", "models/selfie.bin", "models/movenet-lightning.json", "models/movenet-lightning.bin"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
function isolate(res) {
  if (!res || res.type === "opaque" || res.status === 0) return res;
  const h = new Headers(res.headers);
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Embedder-Policy", "require-corp");
  h.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  const keep = res => { if (res && res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)).catch(() => {}); } return res; };
  const path = new URL(req.url).pathname;
  if (/\/models\/|\.wasm$/.test(path)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(keep)).then(isolate));
    return;
  }
  e.respondWith(fetch(req).then(keep).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match("index.html"))).then(isolate));
});
