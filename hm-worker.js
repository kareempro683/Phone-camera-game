// Hand Magic background tracker (version 6).
// Runs Google's MediaPipe Tasks in a background worker, so the screen never freezes.
// Downloaded once from the internet, then kept on the phone by the offline helper.
(() => {
"use strict";
const LIB = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21";
const MODELS = {
  hands: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  seg: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
  face: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite",
};
let V = null, files = null;
const tasks = {};
const loading = {};

function say(m, transfer) { self.postMessage(m, transfer || []); }
function why(e) { return String((e && (e.message || e.name)) || e); }

function loadLibrary() {
  if (V) return;
  self.exports = {};
  self.module = { exports: self.exports };
  importScripts(LIB + "/vision_bundle.cjs");
  V = self.module.exports && self.module.exports.FilesetResolver ? self.module.exports : self.exports;
  if (!V || !V.FilesetResolver) throw new Error("tracking library didn't load");
}

async function make(name) {
  loadLibrary();
  if (!files) files = await V.FilesetResolver.forVisionTasks(LIB + "/wasm");
  const base = { modelAssetPath: MODELS[name], delegate: "CPU" };
  if (name === "hands") return V.HandLandmarker.createFromOptions(files, { baseOptions: base, runningMode: "VIDEO", numHands: 2, minHandDetectionConfidence: .55, minHandPresenceConfidence: .5, minTrackingConfidence: .5 });
  if (name === "seg") return V.ImageSegmenter.createFromOptions(files, { baseOptions: base, runningMode: "VIDEO", outputConfidenceMasks: true, outputCategoryMask: false });
  if (name === "face") return V.FaceDetector.createFromOptions(files, { baseOptions: base, runningMode: "VIDEO", minDetectionConfidence: .5 });
  throw new Error("unknown tracker " + name);
}

async function start(name) {
  if (tasks[name] || loading[name]) return;
  loading[name] = true;
  try {
    tasks[name] = await make(name);
    say({ tracker: name, type: "ready" });
  } catch (e) {
    say({ tracker: name, type: "error", msg: why(e) });
  }
  loading[name] = false;
}

let lastTs = 0;
function stamp() { const t = Math.max(lastTs + 1, Math.round(performance.now())); lastTs = t; return t; }

function run(name, frame) {
  const task = tasks[name];
  if (!task) { if (frame.close) frame.close(); say({ tracker: name, type: "done", skipped: true }); return; }
  try {
    const ts = stamp();
    if (name === "hands") {
      const r = task.detectForVideo(frame, ts);
      say({
        tracker: name, type: "result",
        hands: (r.landmarks || []).map(l => l.map(p => [p.x, p.y])),
        labels: (r.handedness || r.handednesses || []).map(h => (h && h[0] && (h[0].categoryName || h[0].displayName)) || ""),
      });
    } else if (name === "face") {
      const r = task.detectForVideo(frame, ts);
      const d = r.detections && r.detections[0];
      say({ tracker: name, type: "result", face: d && d.keypoints && d.keypoints.length >= 6 ? d.keypoints.map(p => [p.x, p.y]) : null });
    } else if (name === "seg") {
      const r = task.segmentForVideo(frame, ts);
      const m = r.confidenceMasks && r.confidenceMasks[0];
      if (m) {
        const w = m.width, h = m.height, f = m.getAsFloat32Array();
        const img = new ImageData(w, h);
        const px = img.data;
        for (let i = 0, j = 0; i < f.length; i++, j += 4) { px[j] = px[j + 1] = px[j + 2] = 255; px[j + 3] = f[i] * 255; }
        if (r.close) r.close(); else r.confidenceMasks.forEach(x => x.close && x.close());
        createImageBitmap(img).then(bmp => say({ tracker: name, type: "result", mask: bmp }, [bmp]))
          .catch(() => say({ tracker: name, type: "result", maskData: img }));
      }
    }
  } catch (e) {
    say({ tracker: name, type: "error", msg: why(e) });
  }
  if (frame.close) frame.close();
  say({ tracker: name, type: "done" });
}

self.onmessage = e => {
  const m = e.data || {};
  if (m.start) start(m.start);
  else if (m.frame && m.to) run(m.to, m.frame);
};
say({ type: "alive" });
})();
