// Recorder — captures the game canvas + audio mix to a .webm file.
//
// Usage:
//   • Press R to start recording, R again to stop (file downloads on stop).
//   • Or load with ?record to auto-start, optionally ?record&rec_secs=15 to
//     auto-stop after N seconds (handy for scripted/headless capture).
//
// Video: canvas.captureStream(fps) — captures exactly the frames the GPU
// paints, so on a real GPU you get true high-fps footage with no screen
// chrome, cursor, or crop guesswork. Audio: the game's music + SFX mix,
// tapped from the Web Audio graph via getRecordingAudioStream() (audio.js).

// NOTE: must match the version query main.js uses so we share the same
// audio.js module instance (and thus the live AudioContext), not a second copy.
import { getRecordingAudioStream } from "./audio.js?v=151";

let mediaRecorder = null;
let chunks = [];
let recording = false;
let indicator = null;
let seconds = 0;
let secTimer = null;
let pendingSnapshot = false; // set by P, consumed by flushSnapshot() in the render loop
let recBtn = null; // HUD record button (optional, shown with ?capture)

function ensureIndicator() {
  if (indicator) return indicator;
  indicator = document.createElement("div");
  indicator.style.cssText = [
    "position:fixed", "top:14px", "right:16px", "z-index:99999",
    "display:none", "align-items:center", "gap:8px",
    "padding:6px 12px", "border-radius:999px",
    "background:rgba(0,0,0,0.6)", "color:#fff",
    "font:600 13px/1 system-ui,sans-serif", "pointer-events:none",
    "backdrop-filter:blur(4px)",
  ].join(";");
  const dot = document.createElement("span");
  dot.style.cssText = "width:10px;height:10px;border-radius:50%;background:#ff3b30;box-shadow:0 0 8px #ff3b30;animation:jagadRecPulse 1s infinite";
  const label = document.createElement("span");
  label.className = "jagad-rec-label";
  label.textContent = "REC";
  const style = document.createElement("style");
  style.textContent = "@keyframes jagadRecPulse{0%,100%{opacity:1}50%{opacity:.25}}";
  document.head.appendChild(style);
  indicator.appendChild(dot);
  indicator.appendChild(label);
  document.body.appendChild(indicator);
  return indicator;
}

function showIndicator(on) {
  const el = ensureIndicator();
  el.style.display = on ? "flex" : "none";
  if (on) {
    seconds = 0;
    updateLabel();
    secTimer = setInterval(() => { seconds++; updateLabel(); }, 1000);
  } else if (secTimer) {
    clearInterval(secTimer);
    secTimer = null;
  }
}

function timeStr() {
  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function updateLabel() {
  const el = indicator && indicator.querySelector(".jagad-rec-label");
  if (el) el.textContent = `REC ${timeStr()}`;
  if (recBtn) recBtn.querySelector(".jagad-rec-btn-label").textContent = recording ? `Stop ${timeStr()}` : "Record";
}

// Reflect recording state on the HUD record button (red while recording).
function reflectRecording(on) {
  if (!recBtn) return;
  const dot = recBtn.querySelector(".jagad-rec-btn-dot");
  const label = recBtn.querySelector(".jagad-rec-btn-label");
  if (on) {
    dot.style.borderRadius = "2px"; // square = stop
    dot.style.animation = "jagadRecPulse 1s infinite";
    label.textContent = `Stop ${timeStr()}`;
    recBtn.style.background = "rgba(255,59,48,0.85)";
  } else {
    dot.style.borderRadius = "50%"; // circle = record
    dot.style.animation = "none";
    label.textContent = "Record";
    recBtn.style.background = "rgba(0,0,0,0.6)";
  }
}

function pickMime() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm",
  ];
  for (const m of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

// Share-friendly H.264 MP4 (hardware-encoded where available). Supported in
// Chrome 126+ and Safari; vanilla Chromium (no proprietary codecs) returns "".
function pickMp4Mime() {
  const candidates = [
    "video/mp4;codecs=avc1.640028,mp4a.40.2",
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4;codecs=avc1,opus",
    "video/mp4;codecs=avc1",
    "video/mp4",
  ];
  for (const m of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

let mp4Recorder = null;
let mp4Chunks = [];
let mp4Bytes = 0;
let mp4Canvas = null;
let mp4Ctx = null;
let fileBase = "jagad";

// Discord's upload limit is 10 MB — keep the mp4 safely under it. The webm
// stays full-res/full-rate; the mp4 is the small shareable companion.
const MP4_MAX_BYTES = 9_600_000;
const MP4_MAX_WIDTH = 960;
const MP4_BUDGET_SECS = 100; // full round (90s) + countdown + tail

function start(canvas, fps) {
  if (recording) return;
  if (!window.MediaRecorder) {
    console.warn("[recorder] MediaRecorder not supported");
    return;
  }
  const videoStream = canvas.captureStream(fps);
  const stream = new MediaStream();
  videoStream.getVideoTracks().forEach((t) => stream.addTrack(t));

  const audioStream = getRecordingAudioStream();
  if (audioStream) {
    audioStream.getAudioTracks().forEach((t) => stream.addTrack(t));
  } else {
    console.warn("[recorder] no audio stream yet — recording video only. Click/press a key first to unlock audio.");
  }

  const mimeType = pickMime();
  try {
    mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 16_000_000,
      audioBitsPerSecond: 192_000,
    });
  } catch (e) {
    console.warn("[recorder] failed to create MediaRecorder:", e);
    return;
  }
  fileBase = `jagad-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  chunks = [];
  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  mediaRecorder.onstop = save;
  mediaRecorder.start(250);

  // Simultaneous H.264 MP4 for easy sharing, sized for Discord's 10 MB limit:
  // downscaled to ≤960px/30fps on a side canvas, bitrate budgeted for a full
  // round, and hard-capped just under 10 MB if a recording runs long.
  const mp4Mime = pickMp4Mime();
  mp4Recorder = null;
  if (mp4Mime) {
    try {
      const scale = Math.min(1, MP4_MAX_WIDTH / canvas.width);
      mp4Canvas = document.createElement("canvas");
      mp4Canvas.width = Math.round((canvas.width * scale) / 2) * 2; // h264 wants even dims
      mp4Canvas.height = Math.round((canvas.height * scale) / 2) * 2;
      mp4Ctx = mp4Canvas.getContext("2d");
      const mp4Stream = mp4Canvas.captureStream(30);
      if (audioStream) audioStream.getAudioTracks().forEach((t) => mp4Stream.addTrack(t.clone()));

      const audioKbps = 96;
      const videoBps = Math.floor((MP4_MAX_BYTES * 8) / MP4_BUDGET_SECS) - audioKbps * 1000;
      mp4Recorder = new MediaRecorder(mp4Stream, {
        mimeType: mp4Mime,
        videoBitsPerSecond: videoBps,
        audioBitsPerSecond: audioKbps * 1000,
      });
      mp4Chunks = [];
      mp4Bytes = 0;
      mp4Recorder.ondataavailable = (e) => {
        if (!e.data || !e.data.size) return;
        mp4Chunks.push(e.data);
        mp4Bytes += e.data.size;
        // Hard cap: close the mp4 before it can cross 10 MB (webm keeps going)
        if (mp4Bytes >= MP4_MAX_BYTES && mp4Recorder && mp4Recorder.state === "recording") {
          console.warn("[recorder] mp4 reached the 10 MB share cap — closing it (webm continues)");
          mp4Recorder.stop();
        }
      };
      mp4Recorder.onstop = saveMp4;
      mp4Recorder.start(250);
      console.log(`[recorder] mp4 companion: ${mp4Canvas.width}x${mp4Canvas.height}@30, ~${Math.round(videoBps / 1000)}kbps video`);
    } catch (e) {
      mp4Recorder = null;
      mp4Ctx = null;
      console.warn("[recorder] mp4 recorder failed, webm only:", e);
    }
  } else {
    console.log("[recorder] H.264 mp4 not supported in this browser — webm only");
  }

  recording = true;
  showIndicator(true);
  reflectRecording(true);
  console.log(`[recorder] recording at ${fps}fps (${mimeType || "default"})${mp4Recorder ? ` + mp4 (${mp4Mime})` : ""}${audioStream ? " + audio" : ""}`);
}

function stop() {
  if (!recording) return;
  recording = false;
  showIndicator(false);
  reflectRecording(false);
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  if (mp4Recorder && mp4Recorder.state !== "inactive") mp4Recorder.stop();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return url;
}

function save() {
  const blob = new Blob(chunks, { type: "video/webm" });
  chunks = [];
  // expose for headless retrieval
  window.__jagadLastRecording = { blob, url: downloadBlob(blob, `${fileBase}.webm`) };
  console.log(`[recorder] saved webm ${(blob.size / 1e6).toFixed(1)} MB`);
}

function saveMp4() {
  const blob = new Blob(mp4Chunks, { type: "video/mp4" });
  mp4Chunks = [];
  window.__jagadLastRecordingMp4 = { blob, url: downloadBlob(blob, `${fileBase}.mp4`) };
  console.log(`[recorder] saved mp4 ${(blob.size / 1e6).toFixed(1)} MB`);
}

export function toggleRecording(canvas, fps) {
  if (recording) stop(); else start(canvas, fps);
}

// Called from the render loop right after render (fresh WebGL buffer):
// mirrors the game canvas into the small mp4 canvas while recording.
export function updateRecorderStreams(canvas) {
  if (!recording || !mp4Ctx || !mp4Recorder || mp4Recorder.state !== "recording") return;
  mp4Ctx.drawImage(canvas, 0, 0, mp4Canvas.width, mp4Canvas.height);
}

export function startRecording(canvas, fps) { start(canvas, fps || 60); }
export function stopRecording() { stop(); }
export function isRecording() { return recording; }

// --- Snapshot (still PNG of the current canvas) ---------------------------
// On a WebGL canvas with preserveDrawingBuffer:false, toBlob() only returns
// pixels if read in the same task as the draw. So P just flags a request and
// flushSnapshot(canvas) — called from the render loop right after render —
// does the actual grab on a freshly-drawn buffer.

export function requestSnapshot() {
  pendingSnapshot = true;
}

export function flushSnapshot(canvas) {
  if (!pendingSnapshot) return;
  pendingSnapshot = false;
  try {
    canvas.toBlob((blob) => {
      if (!blob) {
        console.warn("[snapshot] empty blob");
        return;
      }
      const url = URL.createObjectURL(blob);
      window.__jagadLastSnapshot = { blob, url };
      const a = document.createElement("a");
      a.href = url;
      a.download = `jagad-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      console.log(`[snapshot] saved ${canvas.width}x${canvas.height} (${(blob.size / 1e3).toFixed(0)} KB)`);
    }, "image/png");
  } catch (e) {
    console.warn("[snapshot] failed:", e);
  }
}

// On-screen capture controls. Hidden by default; shown with ?capture (or ?record)
// so public visitors never see them. Buttons mirror the R / P shortcuts.
function buildHUD(canvas, fps) {
  if (recBtn) return;
  const bar = document.createElement("div");
  bar.style.cssText = [
    "position:fixed", "bottom:16px", "left:50%", "transform:translateX(-50%)",
    "z-index:99999", "display:flex", "gap:8px", "pointer-events:auto",
  ].join(";");

  const mkBtn = (cls) => {
    const b = document.createElement("button");
    b.className = cls;
    b.style.cssText = [
      "display:flex", "align-items:center", "gap:8px",
      "padding:9px 14px", "border:0", "border-radius:999px", "cursor:pointer",
      "background:rgba(0,0,0,0.6)", "color:#fff",
      "font:600 13px/1 system-ui,sans-serif", "backdrop-filter:blur(4px)",
      "-webkit-backdrop-filter:blur(4px)",
    ].join(";");
    return b;
  };

  recBtn = mkBtn("jagad-rec-btn");
  const recDot = document.createElement("span");
  recDot.className = "jagad-rec-btn-dot";
  recDot.style.cssText = "width:11px;height:11px;border-radius:50%;background:#ff3b30;box-shadow:0 0 8px #ff3b30";
  const recLbl = document.createElement("span");
  recLbl.className = "jagad-rec-btn-label";
  recLbl.textContent = "Record";
  recBtn.append(recDot, recLbl);
  recBtn.addEventListener("click", () => { toggleRecording(canvas, fps); recBtn.blur(); });

  const snapBtn = mkBtn("jagad-snap-btn");
  snapBtn.textContent = "📷 Snapshot";
  snapBtn.addEventListener("click", () => { requestSnapshot(); snapBtn.blur(); });

  bar.append(recBtn, snapBtn);
  document.body.appendChild(bar);
}

export function initRecorder(canvas, opts = {}) {
  const fps = opts.fps || 60;
  document.addEventListener("keydown", (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      toggleRecording(canvas, fps);
    } else if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      requestSnapshot();
    }
  });

  const params = new URLSearchParams(window.location.search);
  if (params.has("capture") || params.has("record")) {
    buildHUD(canvas, fps);
  }
  if (params.has("record")) {
    const secs = parseFloat(params.get("rec_secs") || "0");
    // small delay so the scene + audio are live before we start
    setTimeout(() => {
      start(canvas, fps);
      if (secs > 0) setTimeout(stop, secs * 1000);
    }, 1200);
  }
}
