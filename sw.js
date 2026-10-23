// Keeps Hand Magic working offline. The hand-tracking files are saved first;
// the page saves the rest in the background once the game is running.
const CACHE = "hand-magic-v2";
const CORE = ["./", "index.html", "manifest.json", "icon-192.png", "icon-512.png", "hands.js", "hands.binarypb", "hands_solution_packed_assets_loader.js", "hands_solution_packed_assets.data", "hands_solution_simd_wasm_bin.js", "hands_solution_simd_wasm_bin.wasm", "hand_landmark_full.tflite"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(f => c.add(f).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok && new URL(e.request.url).origin === location.origin) {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy));
    }
    return res;
  })));
});
