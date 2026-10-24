// Hand Magic Simple: the hand tracker runs here, in the background.
// It uses the phone's processor only (no graphics chip), so it can't freeze the screen.
(() => {
"use strict";
const base = new URL("./", self.location.href).href;
let human = null, busy = false;

function say(m) { self.postMessage(m); }
function why(e) { return String((e && (e.message || e.name)) || e); }

self.addEventListener("error", e => say({ type: "error", msg: e.message || "worker error" }));
self.addEventListener("unhandledrejection", e => say({ type: "error", msg: why(e.reason) }));

async function load() {
  try {
    importScripts(base + "lib/human.js");
  } catch (e) { say({ type: "fail", msg: "couldn't load lib/human.js: " + why(e) }); return; }
  const H = self.Human && (self.Human.Human || self.Human.default || self.Human);
  const config = {
    backend: "wasm",
    wasmPath: base + "lib/",
    modelBasePath: base + "models/",
    debug: false, async: true, warmup: "none", cacheSensitivity: 0,
    filter: { enabled: false }, face: { enabled: false }, body: { enabled: false },
    object: { enabled: false }, gesture: { enabled: false }, segmentation: { enabled: false },
    hand: {
      enabled: true, maxDetected: 2, minConfidence: 0.5, iouThreshold: 0.2, skipFrames: 3, skipTime: 400,
      landmarks: true, rotation: true,
      detector: { modelPath: "handtrack.json" }, skeleton: { modelPath: "handlandmark-lite.json" },
    },
  };
  for (const backend of ["wasm", "cpu"]) {
    try {
      say({ type: "progress", msg: backend === "wasm" ? "Starting the tracker..." : "Trying the slower backup tracker..." });
      config.backend = backend;
      human = new H(config);
      await human.load();
      // one test run so the first real frame is quick
      await human.detect(new ImageData(64, 64));
      say({ type: "ready", backend });
      return;
    } catch (e) {
      say({ type: "progress", msg: backend + " didn't work: " + why(e) });
      human = null;
    }
  }
  say({ type: "fail", msg: "the tracker couldn't start on this phone" });
}

self.onmessage = async e => {
  const m = e.data || {};
  if (!m.frame) return;
  if (!human || busy) { say({ type: "result", hands: [], skipped: true }); return; }
  busy = true;
  try {
    const f = m.frame;
    const r = await human.detect(f);
    const hands = (r.hand || []).filter(h => h.keypoints && h.keypoints.length >= 21 && h.score >= 0.4)
      .map(h => h.keypoints.slice(0, 21).map(p => [p[0] / f.width, p[1] / f.height]));
    say({ type: "result", hands });
  } catch (err) {
    say({ type: "error", msg: why(err) });
    say({ type: "result", hands: [] });
  }
  busy = false;
};

load();
})();
