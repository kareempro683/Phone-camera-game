// Keeps Hand Magic working offline: everything is saved on the phone the first time.
const CACHE = "hand-magic-v1";
const FILES = ["./", "face_detection.js", "face_detection_full.binarypb", "face_detection_full_range_sparse.tflite", "face_detection_short.binarypb", "face_detection_short_range.tflite", "face_detection_solution_simd_wasm_bin.data", "face_detection_solution_simd_wasm_bin.js", "face_detection_solution_simd_wasm_bin.wasm", "face_detection_solution_wasm_bin.js", "face_detection_solution_wasm_bin.wasm", "hand_landmark_full.tflite", "hand_landmark_lite.tflite", "hands.binarypb", "hands.js", "hands_solution_packed_assets.data", "hands_solution_packed_assets_loader.js", "hands_solution_simd_wasm_bin.data", "hands_solution_simd_wasm_bin.js", "hands_solution_simd_wasm_bin.wasm", "hands_solution_wasm_bin.js", "hands_solution_wasm_bin.wasm", "icon-192.png", "icon-512.png", "index.html", "manifest.json", "selfie_segmentation.binarypb", "selfie_segmentation.js", "selfie_segmentation.tflite", "selfie_segmentation_landscape.tflite", "selfie_segmentation_solution_simd_wasm_bin.data", "selfie_segmentation_solution_simd_wasm_bin.js", "selfie_segmentation_solution_simd_wasm_bin.wasm", "selfie_segmentation_solution_wasm_bin.js", "selfie_segmentation_solution_wasm_bin.wasm"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => {})))).then(() => self.skipWaiting()));
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
