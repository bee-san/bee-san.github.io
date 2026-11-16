// Video Transcriber: decode a local file to 16 kHz mono, transcribe with Whisper in a worker.
const $ = (id) => document.getElementById(id);

/* ---------- Theme ---------- */
const root = document.documentElement;
const themeBtn = $("theme-toggle");
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const isDark = () => root.dataset.theme ? root.dataset.theme === "dark" : darkQuery.matches;
function paintThemeButton() {
  const dark = isDark();
  themeBtn.classList.toggle("is-dark", dark);
  themeBtn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  themeBtn.querySelector(".theme-label").textContent = dark ? "Light" : "Dark";
}
themeBtn.addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  root.dataset.theme = next;
  try { localStorage.setItem("bee-theme", next); } catch {}
  paintThemeButton();
});
darkQuery.addEventListener?.("change", paintThemeButton);
paintThemeButton();

/* ---------- Elements ---------- */
const fileInput = $("file");
const dropZone = $("drop");
const statusCard = $("status-card");
const statusEl = $("status");
const bar = $("bar");
const barFill = $("bar-fill");
const errorEl = $("error");
const cancelBtn = $("cancel");
const resultCard = $("result");
const outPlain = $("out-plain");
const outTimes = $("out-times");

const hasWebGPU = "gpu" in navigator;
$("device-note").textContent = hasWebGPU
  ? "Uses your GPU (WebGPU) when it can, otherwise your CPU."
  : "Running on your CPU (WebGPU isn't available in this browser), so larger models are slow.";

/* ---------- State ---------- */
let worker = null;
let busy = false;
let timer = null;
let current = { name: "transcript", text: "", chunks: [], duration: 0 };
const files = new Map(); // per-file download progress

function makeWorker() {
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  worker.addEventListener("message", onWorkerMessage);
  worker.addEventListener("error", (e) => {
    fail(`The speech engine failed to start${e.message ? `: ${e.message}` : ""}. Check your connection and try again.`);
  });
}

/* ---------- Helpers ---------- */
function pad(n, w = 2) { return String(n).padStart(w, "0"); }
function clock(sec) {
  sec = Math.max(0, sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
function stamp(sec, sep) {
  sec = Math.max(0, sec || 0);
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(r, 3)}`;
}
function bytes(n) {
  if (!n) return "0 MB";
  return n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`;
}
function baseName(name) { return (name || "transcript").replace(/\.[^.]+$/, "") || "transcript"; }

function setStatus(text) { statusEl.textContent = text; }
function setBar(fraction) {
  bar.hidden = false;
  if (fraction == null) { bar.classList.add("is-indeterminate"); barFill.style.width = ""; }
  else { bar.classList.remove("is-indeterminate"); barFill.style.width = `${Math.min(100, fraction * 100).toFixed(1)}%`; }
}
function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
function fail(message) {
  stopTimer();
  busy = false;
  cancelBtn.hidden = true;
  bar.hidden = true;
  setStatus("");
  errorEl.textContent = message;
  errorEl.hidden = false;
}

/* ---------- Normalised segments ---------- */
function segments() {
  const list = (current.chunks || []).map((c) => {
    const [s, e] = c.timestamp || [];
    return { start: s ?? 0, end: e, text: (c.text || "").trim() };
  }).filter((c) => c.text);
  list.forEach((c, i) => {
    if (c.end == null || c.end < c.start) {
      const next = list[i + 1];
      c.end = next ? next.start : Math.max(c.start + 2, current.duration || c.start + 2);
    }
  });
  return list;
}

/* ---------- Audio decoding ---------- */
async function decodeTo16k(file) {
  const buf = await file.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error("This browser can't decode audio (no Web Audio support).");
  const ctx = new AC();
  let decoded;
  try {
    decoded = await new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(buf, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
  } catch {
    throw new Error(
      "Couldn't read audio from this file. It may have no audio track, or your browser can't decode this format. " +
      "Try converting it first, e.g. ffmpeg -i input -vn -ac 1 -ar 16000 audio.wav"
    );
  } finally {
    ctx.close?.();
  }
  const rate = 16000;
  const length = Math.max(1, Math.ceil(decoded.duration * rate));
  const off = new OfflineAudioContext(1, length, rate); // mono destination: browser down-mixes
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return { audio: rendered.getChannelData(0), duration: decoded.duration };
}

/* ---------- Main flow ---------- */
async function handleFile(file) {
  if (!file) return;
  if (busy) {
    errorEl.textContent = "Already working on a file. Cancel it first to start another.";
    errorEl.hidden = false;
    return;
  }
  const type = file.type || "";
  const looksMedia = /^(audio|video)\//.test(type) ||
    /\.(mp4|m4v|mov|webm|mkv|avi|mp3|m4a|aac|wav|ogg|oga|opus|flac|weba|3gp)$/i.test(file.name);
  statusCard.hidden = false;
  resultCard.hidden = true;
  errorEl.hidden = true;
  $("file-name").textContent = file.name;
  $("file-sub").textContent = `${bytes(file.size)} · reading…`;
  statusCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  if (!looksMedia) {
    fail("That doesn't look like a video or audio file. Pick something like an MP4, MOV, MP3 or WAV.");
    return;
  }

  busy = true;
  cancelBtn.hidden = false;
  current = { name: baseName(file.name), text: "", chunks: [], duration: 0 };
  setStatus("Extracting audio…");
  setBar(null);

  let audio, duration;
  try {
    ({ audio, duration } = await decodeTo16k(file));
  } catch (err) {
    $("file-sub").textContent = bytes(file.size);
    fail(err.message || String(err));
    return;
  }
  if (!busy) return; // cancelled while decoding
  current.duration = duration;
  $("file-sub").textContent = `${bytes(file.size)} · ${clock(duration)} long`;

  if (!worker) makeWorker();
  files.clear();
  setStatus("Loading speech model…");
  worker.postMessage({
    type: "transcribe",
    audio,
    model: $("model").value,
    language: $("language").value || null,
    translate: $("translate").checked,
    device: hasWebGPU ? "webgpu" : "wasm",
  }, [audio.buffer]);
}

function onWorkerMessage(e) {
  const msg = e.data;
  if (!busy) return;
  switch (msg.type) {
    case "progress": {
      const p = msg.data || {};
      if (p.file && (p.status === "progress" || p.status === "initiate" || p.status === "download" || p.status === "done")) {
        const f = files.get(p.file) || { loaded: 0, total: 0 };
        if (p.status === "progress") { f.loaded = p.loaded || 0; f.total = p.total || f.total; }
        if (p.status === "done") { f.loaded = f.total || f.loaded; }
        files.set(p.file, f);
        let loaded = 0, total = 0;
        for (const v of files.values()) { loaded += v.loaded; total += v.total; }
        if (total > 0) {
          setStatus(`Downloading speech model… ${bytes(loaded)} of ${bytes(total)} (only needed once)`);
          setBar(loaded / total);
        }
      }
      break;
    }
    case "language": {
      let name = msg.code;
      try { name = new Intl.DisplayNames(["en"], { type: "language" }).of(msg.code) || msg.code; } catch {}
      current.detected = name;
      $("file-sub").textContent += ` · detected ${name}`;
      break;
    }
    case "notice":
      setStatus(msg.message);
      break;
    case "ready": {
      const started = performance.now();
      const where = msg.device === "webgpu" ? "GPU" : "CPU";
      const tick = () => {
        const secs = (performance.now() - started) / 1000;
        setStatus(`Transcribing on your ${where}… ${clock(secs)} elapsed (audio is ${clock(current.duration)})`);
      };
      tick();
      setBar(null);
      stopTimer();
      timer = setInterval(tick, 500);
      break;
    }
    case "result": {
      stopTimer();
      busy = false;
      cancelBtn.hidden = true;
      bar.hidden = true;
      current.text = (msg.text || "").trim();
      current.chunks = msg.chunks || [];
      setStatus(current.text ? "Done." : "Done, but no speech was found.");
      render();
      break;
    }
    case "error":
      fail(`Transcription failed: ${msg.message}`);
      break;
  }
}

cancelBtn.addEventListener("click", () => {
  if (worker) { worker.terminate(); worker = null; }
  stopTimer();
  busy = false;
  cancelBtn.hidden = true;
  bar.hidden = true;
  setStatus("Cancelled.");
});

/* ---------- Output ---------- */
function render() {
  outPlain.textContent = current.text || "(no speech detected)";
  outTimes.replaceChildren();
  const segs = segments();
  if (!segs.length) outTimes.textContent = "(no timestamps)";
  for (const s of segs) {
    const line = document.createElement("div");
    const ts = document.createElement("span");
    ts.className = "ts";
    ts.textContent = `[${clock(s.start)}]`;
    line.append(ts, document.createTextNode(s.text));
    outTimes.append(line);
  }
  resultCard.hidden = false;
  resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function toSRT() {
  return segments().map((s, i) =>
    `${i + 1}\n${stamp(s.start, ",")} --> ${stamp(s.end, ",")}\n${s.text}\n`).join("\n");
}
function toVTT() {
  return "WEBVTT\n\n" + segments().map((s) =>
    `${stamp(s.start, ".")} --> ${stamp(s.end, ".")}\n${s.text}\n`).join("\n");
}
function download(text, ext, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${current.name}.${ext}`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

$("copy").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  try {
    await navigator.clipboard.writeText(current.text);
    btn.textContent = "Copied!";
  } catch {
    const r = document.createRange();
    r.selectNodeContents(outPlain);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    btn.textContent = "Selected, press Ctrl+C";
  }
  setTimeout(() => { btn.textContent = "Copy text"; }, 1800);
});
$("dl-txt").addEventListener("click", () => download(current.text + "\n", "txt", "text/plain"));
$("dl-srt").addEventListener("click", () => download(toSRT(), "srt", "application/x-subrip"));
$("dl-vtt").addEventListener("click", () => download(toVTT(), "vtt", "text/vtt"));

/* ---------- Tabs ---------- */
const tabs = [$("tab-plain"), $("tab-times")];
function selectTab(tab) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute("aria-controls")).hidden = !on;
  }
}
tabs.forEach((t, i) => {
  t.addEventListener("click", () => selectTab(t));
  t.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const next = tabs[(i + 1) % tabs.length];
      selectTab(next); next.focus();
    }
  });
});

/* ---------- File picking and drag & drop ---------- */
fileInput.addEventListener("change", () => {
  handleFile(fileInput.files[0]);
  fileInput.value = "";
});

let dragDepth = 0;
const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  document.body.classList.add("is-dragging");
  dropZone.classList.add("is-over");
});
window.addEventListener("dragover", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) { document.body.classList.remove("is-dragging"); dropZone.classList.remove("is-over"); }
});
window.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("is-dragging");
  dropZone.classList.remove("is-over");
  handleFile(e.dataTransfer.files[0]);
});

/* ---------- YouTube / link hint ---------- */
const ytOut = $("yt-out");
function showLinkHint(raw) {
  ytOut.replaceChildren();
  const url = raw.trim();
  if (!url) return;
  const p = document.createElement("p");
  const isYT = /(^|\.|\/\/)(youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(url) || /youtu\.?be/i.test(url);
  p.textContent = isYT
    ? "That's a YouTube link. This page can't download it, but this command will (then drop the .mp3 here):"
    : "This page can't download links. If yt-dlp supports that site, this command fetches the audio (then drop it here):";
  const pre = document.createElement("pre");
  pre.className = "cmd";
  const code = document.createElement("code");
  code.textContent = `yt-dlp -x --audio-format mp3 "${url.replace(/"/g, "")}"`;
  pre.append(code);
  ytOut.append(p, pre);
}
$("yt-form").addEventListener("submit", (e) => { e.preventDefault(); showLinkHint($("yt-url").value); });
$("yt-url").addEventListener("paste", (e) => {
  const text = e.clipboardData?.getData("text");
  if (text) setTimeout(() => showLinkHint($("yt-url").value || text), 0);
});

// Pasting a link anywhere else on the page (not in a field) shows the same hint.
document.addEventListener("paste", (e) => {
  if (e.target.closest && e.target.closest("input, textarea, select")) return;
  const text = e.clipboardData?.getData("text") || "";
  if (/^https?:\/\//i.test(text.trim())) {
    $("yt-url").value = text.trim();
    showLinkHint(text);
    $("yt-out").scrollIntoView({ behavior: "smooth", block: "center" });
  }
});
