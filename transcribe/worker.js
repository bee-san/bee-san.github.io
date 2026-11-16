// Module worker: loads Whisper with transformers.js and transcribes 16 kHz mono audio.
import { pipeline, env, Tensor } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";

env.allowLocalModels = false; // always fetch from the Hugging Face Hub (then browser cache)
env.useBrowserCache = true;

let current = null; // { key, pipe, device }

function post(type, data = {}) {
  self.postMessage({ type, ...data });
}

function dtypeFor(device) {
  // WebGPU: full-precision encoder (quality) + 4-bit decoder (speed/size).
  // WASM: 8-bit quantized weights everywhere — small and fast on CPU.
  return device === "webgpu"
    ? { encoder_model: "fp32", decoder_model_merged: "q4" }
    : "q8";
}

// navigator.gpu can exist with no usable adapter (headless, blocklisted GPUs, some Linux setups).
async function webgpuUsable() {
  try {
    if (!self.navigator || !navigator.gpu) return false;
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

async function load(model, wantDevice) {
  const key = `${model}|${wantDevice}`;
  if (current && current.key === key) return current;
  if (current) {
    try { await current.pipe.dispose(); } catch {}
    current = null;
  }

  const progress_callback = (p) => post("progress", { data: p });
  const tryDevice = async (device) => {
    const pipe = await pipeline("automatic-speech-recognition", model, {
      dtype: dtypeFor(device),
      device,
      progress_callback,
    });
    return { key, pipe, device };
  };

  if (wantDevice === "webgpu" && !(await webgpuUsable())) wantDevice = "wasm";

  if (wantDevice === "webgpu") {
    try {
      current = await tryDevice("webgpu");
    } catch (err) {
      post("notice", { message: `WebGPU didn't work here (${err && err.message ? err.message : err}). Falling back to CPU.` });
      current = await tryDevice("wasm");
      current.key = key;
    }
  } else {
    current = await tryDevice("wasm");
  }
  return current;
}

// transformers.js v3 doesn't auto-detect the language (it silently assumes English),
// so do it the way Whisper does: one decoder step after <|startoftranscript|>,
// then pick the most likely <|xx|> language token.
async function detectLanguage(pipe, audio) {
  const gc = pipe.model.generation_config || {};
  const langToId = gc.lang_to_id;
  if (!gc.is_multilingual || !langToId) return null;

  // Skip leading silence, then look at up to 30 s of audio.
  let start = 0;
  while (start < audio.length && Math.abs(audio[start]) < 0.01) start++;
  if (start >= audio.length) return null;
  const clip = audio.subarray(start, start + 16000 * 30);

  const { input_features } = await pipe.processor(clip);
  const decoder_input_ids = new Tensor("int64", BigInt64Array.from([BigInt(gc.decoder_start_token_id)]), [1, 1]);
  const { logits } = await pipe.model({ input_features, decoder_input_ids });
  const scores = logits.data; // [1, 1, vocab]

  let best = null, bestScore = -Infinity;
  for (const [token, id] of Object.entries(langToId)) {
    const v = Number(scores[id]);
    if (v > bestScore) { bestScore = v; best = token; }
  }
  const m = best && best.match(/^<\|([a-z]{2,3}(?:-[a-z]+)?)\|>$/i);
  return m ? m[1] : null;
}

self.addEventListener("message", async (e) => {
  const msg = e.data;
  if (msg.type !== "transcribe") return;
  try {
    const { pipe, device } = await load(msg.model, msg.device);
    post("ready", { device });

    const opts = {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      task: msg.translate ? "translate" : "transcribe",
    };
    let language = msg.language;
    if (!language) {
      try {
        language = await detectLanguage(pipe, msg.audio);
        if (language) post("language", { code: language });
      } catch (err) {
        post("notice", { message: "Couldn't detect the language, assuming English." });
      }
    }
    if (language) opts.language = language;

    const out = await pipe(msg.audio, opts);
    post("result", { text: out.text || "", chunks: out.chunks || [] });
  } catch (err) {
    post("error", { message: err && err.message ? err.message : String(err) });
  }
});
