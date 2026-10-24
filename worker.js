// Hand Magic Simple: the hand tracker runs here, in the background.
// It uses the phone's processor only (no graphics chip), so it can't freeze the screen.
// Fast mode: the slow "find a hand" step runs only when needed; between those,
// each hand is followed with the quick finger-reading step.
(() => {
"use strict";
const base = new URL("./", self.location.href).href;
let human = null, tf = null, lm = null, busy = false;
let maxHands = 2;
let tracks = [];          // each: { pts: [[x,y] x21] in frame pixels }
let lastFind = -1e9;
let src = null, sctx = null, crop = null, cctx = null;
const S = 224;

function say(m) { self.postMessage(m); }
function why(e) { return String((e && (e.message || e.name)) || e); }
self.addEventListener("error", e => say({ type: "error", msg: e.message || "worker error" }));
self.addEventListener("unhandledrejection", e => say({ type: "error", msg: why(e.reason) }));

async function load() {
  try { importScripts(base + "lib/human.js"); }
  catch (e) { say({ type: "fail", msg: "couldn't load lib/human.js: " + why(e) }); return; }
  const H = self.Human && (self.Human.Human || self.Human.default || self.Human);
  const config = {
    backend: "wasm", wasmPath: base + "lib/", modelBasePath: base + "models/",
    debug: false, async: true, warmup: "none", cacheSensitivity: 0,
    filter: { enabled: false }, face: { enabled: false }, body: { enabled: false },
    object: { enabled: false }, gesture: { enabled: false }, segmentation: { enabled: false },
    hand: { enabled: true, maxDetected: 2, minConfidence: 0.5, iouThreshold: 0.2, skipFrames: 0, skipTime: 0, landmarks: true, rotation: true,
      detector: { modelPath: "handtrack.json" }, skeleton: { modelPath: "handlandmark-lite.json" } },
  };
  for (const backend of ["wasm", "cpu"]) {
    try {
      say({ type: "progress", msg: backend === "wasm" ? "Starting the tracker..." : "Trying the slower backup tracker..." });
      config.backend = backend;
      human = new H(config);
      await human.load();
      tf = human.tf;
      await tf.ready();
      lm = await tf.loadGraphModel(base + "models/handlandmark-lite.json");
      if (typeof OffscreenCanvas !== "undefined") {
        src = new OffscreenCanvas(2, 2); sctx = src.getContext("2d", { willReadFrequently: true });
        crop = new OffscreenCanvas(S, S); cctx = crop.getContext("2d", { willReadFrequently: true });
      }
      await human.detect(new ImageData(64, 64));
      say({ type: "ready", backend, fast: !!cctx });
      return;
    } catch (e) {
      say({ type: "progress", msg: backend + " didn't work: " + why(e) });
      human = null;
    }
  }
  say({ type: "fail", msg: "the tracker couldn't start on this phone" });
}

// --- follow one hand with the quick step
function frameOf(pts) {
  const a = Math.atan2(pts[9][1] - pts[0][1], pts[9][0] - pts[0][0]) + Math.PI / 2; // turn so the hand points up
  const c = Math.cos(-a), s = Math.sin(-a);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of pts) { const u = x * c - y * s, v = x * s + y * c; x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
  const cu = (x0 + x1) / 2, cv = (y0 + y1) / 2;
  const ci = Math.cos(a), si = Math.sin(a);
  const cx = cu * ci - cv * si, cy = cu * si + cv * ci;
  const size = Math.max(x1 - x0, y1 - y0) * 2.0;
  return { a, cx, cy, size };
}
async function follow(t) {
  const f = frameOf(t.pts);
  if (!(f.size > 8)) return false;
  cctx.setTransform(1, 0, 0, 1, 0, 0);
  cctx.fillStyle = "#000"; cctx.fillRect(0, 0, S, S);
  cctx.translate(S / 2, S / 2); cctx.rotate(-f.a); cctx.scale(S / f.size, S / f.size); cctx.translate(-f.cx, -f.cy);
  cctx.drawImage(src, 0, 0);
  const img = cctx.getImageData(0, 0, S, S);
  const input = tf.tidy(() => tf.expandDims(tf.div(tf.cast(tf.browser.fromPixels(img), "float32"), 255), 0));
  const out = lm.execute(input, ["Identity", "Identity_1"]);
  input.dispose();
  const [kp, sc] = await Promise.all(out.map(o => o.data()));
  out.forEach(o => o.dispose());
  const score = sc[0];
  if (!(score > 0.5)) return false;
  const k = f.size / S, ca = Math.cos(f.a), sa = Math.sin(f.a);
  const pts = [];
  for (let i = 0; i < 21; i++) {
    const dx = (kp[i * 3] - S / 2) * k, dy = (kp[i * 3 + 1] - S / 2) * k;
    pts.push([f.cx + dx * ca - dy * sa, f.cy + dx * sa + dy * ca]);
  }
  t.pts = pts; t.score = score;
  return true;
}
const palm = p => [(p[0][0] + p[5][0] + p[9][0] + p[17][0]) / 4, (p[0][1] + p[5][1] + p[9][1] + p[17][1]) / 4];
const span = p => Math.hypot(p[0][0] - p[9][0], p[0][1] - p[9][1]) || 1;
function overlaps(a, b) { const pa = palm(a), pb = palm(b); return Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) < Math.max(span(a), span(b)) * 0.9; }

async function track(f) {
  const t0 = performance.now();
  if (!cctx) { // no quick path on this phone: use the full tracker every time
    const r = await human.detect(f);
    return { hands: (r.hand || []).filter(h => h.keypoints && h.keypoints.length >= 21).slice(0, maxHands).map(h => h.keypoints.slice(0, 21).map(p => [p[0], p[1]])), ms: performance.now() - t0, found: true };
  }
  if (src.width !== f.width || src.height !== f.height) { src.width = f.width; src.height = f.height; }
  sctx.putImageData(f, 0, 0);
  // follow the hands we already have
  const kept = [];
  for (const t of tracks) { if (await follow(t)) kept.push(t); }
  tracks = [];
  for (const t of kept) if (!tracks.some(o => overlaps(o.pts, t.pts))) tracks.push(t);
  // look for new hands only when we're missing one (and not too often)
  let found = false;
  const now = performance.now();
  const wait = tracks.length === 0 ? 0 : 1500;
  if (tracks.length < maxHands && now - lastFind > wait) {
    lastFind = now; found = true;
    const r = await human.detect(f);
    for (const h of (r.hand || [])) {
      if (!h.keypoints || h.keypoints.length < 21 || h.score < 0.45) continue;
      const pts = h.keypoints.slice(0, 21).map(p => [p[0], p[1]]);
      if (tracks.length < maxHands && !tracks.some(o => overlaps(o.pts, pts))) tracks.push({ pts });
    }
  }
  return { hands: tracks.map(t => t.pts), ms: performance.now() - t0, found };
}

self.onmessage = async e => {
  const m = e.data || {};
  if (m.maxHands) maxHands = m.maxHands;
  if (!m.frame) return;
  if (!human || busy) { say({ type: "result", hands: [], skipped: true }); return; }
  busy = true;
  try {
    const f = m.frame;
    const r = await track(f);
    say({ type: "result", hands: r.hands.map(h => h.map(([x, y]) => [x / f.width, y / f.height])), ms: Math.round(r.ms), found: r.found });
  } catch (err) {
    tracks = [];
    say({ type: "error", msg: why(err) });
    say({ type: "result", hands: [] });
  }
  busy = false;
};

load();
})();
