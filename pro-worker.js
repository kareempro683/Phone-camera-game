// Hand Magic Pro (laptop): hands, face and background are all worked out here, in the background,
// so the game screen never freezes. Runs on the processor only, offline after the first load.
(() => {
"use strict";
const base = new URL("./", self.location.href).href;
let H = null, hHands = null, hFace = null, hBody = null, tf = null, lm = null, busy = false;
let maxHands = 2, tracks = [], nextId = 1, lastFind = -1e9, frameNo = 0;
let src = null, sctx = null, crop = null, cctx = null;
const SZ = 224;
const say = (m, t) => self.postMessage(m, t || []);
const why = e => String((e && (e.message || e.name)) || e);
self.addEventListener("error", e => say({ type: "error", msg: e.message || "worker error" }));
self.addEventListener("unhandledrejection", e => say({ type: "error", msg: why(e.reason) }));

const OFF = { filter: { enabled: false }, body: { enabled: false }, object: { enabled: false }, gesture: { enabled: false } };
function handConfig(backend) {
  return Object.assign({ backend, wasmPath: base + "lib/", modelBasePath: base + "models/", debug: false, async: true, warmup: "none", cacheSensitivity: 0,
    face: { enabled: false }, segmentation: { enabled: false },
    hand: { enabled: true, maxDetected: 2, minConfidence: 0.5, iouThreshold: 0.2, skipFrames: 0, skipTime: 0, landmarks: true, rotation: true,
      detector: { modelPath: "handtrack.json" }, skeleton: { modelPath: "handlandmark-lite.json" } } }, OFF);
}
function faceConfig(backend) {
  return Object.assign({ backend, wasmPath: base + "lib/", modelBasePath: base + "models/", debug: false, async: true, warmup: "none",
    hand: { enabled: false },
    face: { enabled: true, detector: { modelPath: "blazeface.json", rotation: false, maxDetected: 1 }, mesh: { enabled: true, modelPath: "facemesh.json" },
      iris: { enabled: false }, emotion: { enabled: false }, description: { enabled: false }, antispoof: { enabled: false }, liveness: { enabled: false }, attention: { enabled: false }, gear: { enabled: false } },
    segmentation: { enabled: true, modelPath: "selfie.json" } }, OFF);
}

async function load() {
  try { importScripts(base + "lib/human.js"); } catch (e) { say({ type: "fail", msg: "couldn't load lib/human.js: " + why(e) }); return; }
  H = self.Human && (self.Human.Human || self.Human.default || self.Human);
  for (const backend of ["wasm", "cpu"]) {
    try {
      say({ type: "progress", msg: "Starting the hand tracker..." });
      hHands = new H(handConfig(backend));
      await hHands.load();
      tf = hHands.tf; await tf.ready();
      lm = await tf.loadGraphModel(base + "models/handlandmark-lite.json");
      if (typeof OffscreenCanvas !== "undefined") {
        src = new OffscreenCanvas(2, 2); sctx = src.getContext("2d", { willReadFrequently: true });
        crop = new OffscreenCanvas(SZ, SZ); cctx = crop.getContext("2d", { willReadFrequently: true });
      }
      await hHands.detect(new ImageData(64, 64));
      say({ type: "ready", backend, cores: self.crossOriginIsolated ? "all" : "one" });
      // face + background load quietly afterwards
      try { hFace = new H(faceConfig(backend)); await hFace.load(); say({ type: "extras" }); }
      catch (e) { hFace = null; say({ type: "error", msg: "avatar/worlds didn't load: " + why(e) }); }
      try {
        hBody = new H(Object.assign({ backend, wasmPath: base + "lib/", modelBasePath: base + "models/", debug: false, async: true, warmup: "none",
          face: { enabled: false }, hand: { enabled: false }, segmentation: { enabled: false },
          body: { enabled: true, modelPath: "movenet-lightning.json", maxDetected: 1, minConfidence: 0.2, skipFrames: 0 } },
          { filter: { enabled: false }, object: { enabled: false }, gesture: { enabled: false } }));
        await hBody.load(); say({ type: "body" });
      } catch (e) { hBody = null; say({ type: "error", msg: "whole body didn't load: " + why(e) }); }
      return;
    } catch (e) { say({ type: "progress", msg: backend + " didn't work: " + why(e) }); hHands = null; }
  }
  say({ type: "fail", msg: "the tracker couldn't start" });
}

// ---- hands: find once, then follow with the quick step
function frameOf(p) {
  const a = Math.atan2(p[9][1] - p[0][1], p[9][0] - p[0][0]) + Math.PI / 2;
  const c = Math.cos(-a), s = Math.sin(-a);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of p) { const u = x * c - y * s, v = x * s + y * c; x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
  const cu = (x0 + x1) / 2, cv = (y0 + y1) / 2, ci = Math.cos(a), si = Math.sin(a);
  return { a, cx: cu * ci - cv * si, cy: cu * si + cv * ci, size: Math.max(x1 - x0, y1 - y0) * 2.0 };
}
async function follow(t) {
  const f = frameOf(t.pts);
  if (!(f.size > 8)) return false;
  cctx.setTransform(1, 0, 0, 1, 0, 0); cctx.fillStyle = "#000"; cctx.fillRect(0, 0, SZ, SZ);
  cctx.translate(SZ / 2, SZ / 2); cctx.rotate(-f.a); cctx.scale(SZ / f.size, SZ / f.size); cctx.translate(-f.cx, -f.cy);
  cctx.drawImage(src, 0, 0);
  const img = cctx.getImageData(0, 0, SZ, SZ);
  const input = tf.tidy(() => tf.expandDims(tf.div(tf.cast(tf.browser.fromPixels(img), "float32"), 255), 0));
  const out = lm.execute(input, ["Identity", "Identity_1"]);
  input.dispose();
  const [kp, sc] = await Promise.all(out.map(o => o.data()));
  out.forEach(o => o.dispose());
  if (!(sc[0] > 0.5)) return false;
  const k = f.size / SZ, ca = Math.cos(f.a), sa = Math.sin(f.a), pts = [];
  for (let i = 0; i < 21; i++) {
    const dx = (kp[i * 3] - SZ / 2) * k, dy = (kp[i * 3 + 1] - SZ / 2) * k;
    pts.push([f.cx + dx * ca - dy * sa, f.cy + dx * sa + dy * ca]);
  }
  t.pts = pts;
  return true;
}
const palm = p => [(p[0][0] + p[5][0] + p[9][0] + p[17][0]) / 4, (p[0][1] + p[5][1] + p[9][1] + p[17][1]) / 4];
const span = p => Math.hypot(p[0][0] - p[9][0], p[0][1] - p[9][1]) || 1;
// two hands only count as the same hand if they are almost on top of each other (so two fists held together both stay)
const overlaps = (a, b) => { const pa = palm(a), pb = palm(b); return Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) < Math.max(span(a), span(b)) * 0.35; };
async function hands(f) {
  if (!cctx) {
    const r = await hHands.detect(f);
    return (r.hand || []).filter(h => h.keypoints && h.keypoints.length >= 21).slice(0, maxHands).map((h, i) => ({ id: i + 1, pts: h.keypoints.slice(0, 21).map(p => [p[0], p[1]]) }));
  }
  if (src.width !== f.width || src.height !== f.height) { src.width = f.width; src.height = f.height; }
  sctx.putImageData(f, 0, 0);
  const kept = [];
  for (const t of tracks) if (await follow(t)) kept.push(t);
  tracks = [];
  for (const t of kept) if (!tracks.some(o => overlaps(o.pts, t.pts))) tracks.push(t);
  const now = performance.now();
  if (tracks.length < maxHands && now - lastFind > (tracks.length ? 600 : 150)) {
    lastFind = now;
    const r = await hHands.detect(f);
    for (const h of (r.hand || [])) {
      if (!h.keypoints || h.keypoints.length < 21 || h.score < 0.45) continue;
      const pts = h.keypoints.slice(0, 21).map(p => [p[0], p[1]]);
      if (tracks.length < maxHands && !tracks.some(o => overlaps(o.pts, pts))) tracks.push({ id: nextId++, pts });
    }
  }
  return tracks.map(t => ({ id: t.id, pts: t.pts }));
}

// ---- face: 6 points the avatar uses (eyes, nose, mouth, ears)
async function face(f) {
  const r = await hFace.detect(f);
  const m = r.face && r.face[0] && r.face[0].mesh;
  if (!m || m.length < 455) return null;
  const mid = (a, b) => [(m[a][0] + m[b][0]) / 2, (m[a][1] + m[b][1]) / 2];
  return [mid(33, 133), mid(362, 263), [m[1][0], m[1][1]], [m[13][0], m[13][1]], [m[234][0], m[234][1]], [m[454][0], m[454][1]]];
}
// ---- whole body: 17 points (nose, eyes, ears, shoulders, elbows, wrists, hips, knees, ankles)
async function body(f) {
  const r = await hBody.detect(f);
  const b = r.body && r.body[0];
  if (!b || !b.keypoints) return null;
  const order = ["nose", "leftEye", "rightEye", "leftEar", "rightEar", "leftShoulder", "rightShoulder", "leftElbow", "rightElbow", "leftWrist", "rightWrist", "leftHip", "rightHip", "leftKnee", "rightKnee", "leftAnkle", "rightAnkle"];
  const by = {}; for (const k of b.keypoints) by[k.part] = k;
  return order.map(n => by[n] ? [by[n].position[0] / f.width, by[n].position[1] / f.height, by[n].score] : [0, 0, 0]);
}
// ---- background: a see-through picture where you are solid
async function background(f) {
  const t = await hFace.segmentation(f);
  if (!t || !t.shape) return null;
  const [h, w, ch] = t.shape;
  const d = await t.data(); t.dispose && t.dispose();
  const img = new ImageData(w, h), px = img.data;
  for (let i = 0, j = 0; i < w * h; i++, j += ch) { const o = i * 4; px[o] = px[o + 1] = px[o + 2] = 255; px[o + 3] = d[j + ch - 1]; }
  try { return await createImageBitmap(img); } catch (e) { return img; }
}

self.onmessage = async e => {
  const m = e.data || {};
  if (m.maxHands) maxHands = m.maxHands;
  if (!m.frame) return;
  const f = m.frame;
  if (!hHands || busy) { say({ type: "result", skipped: true }); return; }
  busy = true; frameNo++;
  const res = { type: "result", w: f.width, h: f.height };
  try {
    const t0 = performance.now();
    res.hands = (await hands(f)).map(h => ({ id: h.id, pts: h.pts.map(([x, y]) => [x / f.width, y / f.height]) }));
    // face, background and whole body take turns, so hand tracking stays quick
    const jobs = [];
    if (hFace && m.face) jobs.push("face");
    if (hFace && m.seg) jobs.push("seg");
    if (hBody && m.body) jobs.push("body", "body");
    if (jobs.length) {
      const job = jobs[frameNo % jobs.length];
      if (job === "face") { const p = await face(f); res.face = p ? p.map(([x, y]) => [x / f.width, y / f.height]) : null; }
      else if (job === "seg") res.mask = await background(f);
      else res.body = await body(f);
    }
    res.ms = Math.round(performance.now() - t0);
  } catch (err) { tracks = []; say({ type: "error", msg: why(err) }); res.hands = []; }
  busy = false;
  say(res, res.mask && !(res.mask instanceof ImageData) ? [res.mask] : []);
};
load();
})();
