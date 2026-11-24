/// <reference lib="webworker" />
// Speech recognition, entirely on this device: a Web Worker runs Whisper (ONNX Runtime via
// Transformers.js) so the page never freezes. Audio arrives from the page and never leaves the browser.

import { AutoConfig, AutoProcessor, AutoTokenizer, WhisperForConditionalGeneration, env } from "@huggingface/transformers";
import { MODELS, RUNTIME, fileUrl, type ModelConfig, type ModelId } from "../config/models";
import { transcribePhrase, type Transcription, type Whisper } from "../lib/asr/decode";
import { FULL_WINDOW_SECONDS, PARTIAL_PAD_SECONDS, PAD_SECONDS, SAMPLE_RATE, openEncoderWindow, windowSeconds } from "../lib/asr/encoder-window";
import { hasWebGPU } from "../lib/asr/gpu";
import { leveled } from "../lib/audio/level";
import type { Backend, EnginePreference, WorkerRequest, WorkerResponse } from "../lib/asr/protocol";

declare const self: DedicatedWorkerGlobalScope;

const CACHE_NAME = "transformers-cache";
/** Marks an encoder in the cache that was rewritten to take short windows. */
const OPEN_WINDOW_HEADER = "X-Iqra-Open-Window";

interface Loaded extends Whisper {
  id: ModelId;
  backend: Backend;
  /** Whether phrases get windows of their own length (see `windowSeconds`) rather than 30 s. */
  shortWindows: boolean;
  /** Whether a phrase transcribed again starts from its last transcription (see decode.ts). */
  drafts: boolean;
}

function post(message: WorkerResponse) {
  self.postMessage(message);
}

env.allowLocalModels = false;
env.useBrowserCache = true;

let runtime: Backend | null = null;
let current: Loaded | null = null;
/**
 * The tokens of the last provisional transcription: the phrase still being recited, which is
 * transcribed again as it grows and once it is finished. Cleared after a finished phrase.
 */
let draft: bigint[] | null = null;
let loading: Promise<void> | null = null;
/** Transcriptions run one at a time, in the order they were requested. */
let queue: Promise<void> = Promise.resolve();

/** Downloads a file, with progress. */
async function download(url: string, onBytes: (n: number) => void): Promise<{ blob: Blob; type: string }> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Could not download ${url} (${response.status})`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    onBytes(value.length);
  }
  const type = response.headers.get("Content-Type") ?? "application/octet-stream";
  return { blob: new Blob(chunks as BlobPart[], { type }), type };
}

/** Downloads one file into the shared cache with progress, unless it is already there. */
async function prefetch(url: string, onBytes: (n: number) => void): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  if (await cache.match(url)) return;
  const { blob, type } = await download(url, onBytes);
  await cache.put(url, new Response(blob, { headers: { "Content-Type": type } }));
}

/**
 * Makes the model's encoder take windows shorter than 30 s (see encoder-window.ts): the file is
 * rewritten once, in the cache where Transformers.js then finds it (downloading it first if needed).
 * Returns whether that worked; if not, phrases get the usual 30 s windows.
 */
async function openWindow(model: ModelConfig, onBytes: (n: number) => void): Promise<boolean> {
  const file = model.files.find((f) => f.path.startsWith("onnx/encoder_model"));
  if (!file) return false;
  const url = fileUrl(model, file.path);
  try {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(url);
    if (cached?.headers.get(OPEN_WINDOW_HEADER) === "1") {
      onBytes(file.bytes);
      return true;
    }
    const original = cached ? await cached.blob() : (await download(url, onBytes)).blob;
    const rewritten = openEncoderWindow(new Uint8Array(await original.arrayBuffer()));
    // With its length, which Transformers.js would otherwise ask the Hub for to show progress.
    const headers = { "Content-Type": "application/octet-stream", "Content-Length": String(rewritten.length), [OPEN_WINDOW_HEADER]: "1" };
    await cache.put(url, new Response(new Blob([rewritten as BlobPart]), { headers }));
    return true;
  } catch (error) {
    console.warn("Transcribing with 30 s windows: the encoder could not be prepared for shorter ones", error);
    return false;
  }
}

async function buildModel(model: ModelConfig, backend: Backend, onProgress: (file: string, loaded: number) => void) {
  // Pin every request (including internal lookups) to the model's exact commit.
  env.remotePathTemplate = `{model}/resolve/${model.revision}/`;
  const options = { revision: model.revision };
  const progress_callback = (p: { status: string; file?: string; loaded?: number }) => {
    if (p.status === "progress" && p.file && p.loaded !== undefined) onProgress(p.file, p.loaded);
  };
  const config = await AutoConfig.from_pretrained(model.repo, options);
  const device = backend === "webgpu" ? { encoder_model: "webgpu", decoder_model_merged: "wasm" } : "wasm";
  // Transformers.js looks the encoder's precision up by its session name ("model") when it lists the
  // files to load, and by its file name when it loads them: with both, it never asks the Hub for a
  // file this model does not have.
  const dtype = { model: model.dtype.encoder_model!, ...model.dtype };
  const [whisper, tokenizer, processor] = await Promise.all([
    WhisperForConditionalGeneration.from_pretrained(model.repo, {
      ...options,
      config,
      dtype,
      device: device as "wasm",
      progress_callback,
    }),
    AutoTokenizer.from_pretrained(model.repo, { ...options, progress_callback }),
    AutoProcessor.from_pretrained(model.repo, { ...options, progress_callback }),
  ]);
  return { whisper: whisper as WhisperForConditionalGeneration, tokenizer, processor };
}

async function load(id: ModelId, origin: string, engine: EnginePreference): Promise<void> {
  const model = MODELS[id];
  if (current?.id === id && (engine === "auto" || current.backend === "wasm")) {
    post({ type: "ready", model: id, backend: current.backend, threads: env.backends.onnx.wasm?.numThreads ?? 1 });
    return;
  }
  await current?.whisper.dispose();
  current = null;
  draft = null;

  // ONNX Runtime can only be set up once per worker: pick the WebGPU-capable build only if this
  // model can use it (the page starts a fresh worker when a different build is needed).
  const gpu = engine === "auto" && model.webgpuEncoder && (await hasWebGPU());
  if (!runtime) {
    runtime = gpu ? "webgpu" : "wasm";
    const files = RUNTIME[runtime];
    const wasm = env.backends.onnx.wasm!;
    wasm.wasmPaths = { mjs: new URL(RUNTIME.base + files.mjs, origin).href, wasm: new URL(RUNTIME.base + files.wasm, origin).href };
    // Several threads need SharedArrayBuffer, which browsers only allow on cross-origin isolated pages.
    wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
  }

  // One progress bar for the engine and the model files.
  const runtimeFiles = RUNTIME[runtime];
  const total = runtimeFiles.bytes + model.files.reduce((s, f) => s + f.bytes, 0);
  const perFile = new Map<string, number>();
  let runtimeLoaded = 0;
  let lastPost = 0;
  const report = (force = false) => {
    const now = performance.now();
    if (!force && now - lastPost < 120) return;
    lastPost = now;
    let loaded = runtimeLoaded;
    for (const v of perFile.values()) loaded += v;
    post({ type: "progress", model: id, loaded: Math.min(loaded, total), total });
  };
  report(true);

  await prefetch(new URL(RUNTIME.base + runtimeFiles.wasm, origin).href, (n) => {
    runtimeLoaded += n;
    report();
  });
  runtimeLoaded = runtimeFiles.bytes;
  report(true);

  const onProgress = (file: string, loaded: number) => {
    perFile.set(file, loaded);
    report();
  };
  const encoder = model.files.find((f) => f.path.startsWith("onnx/encoder_model"))?.path ?? "";
  let encoderLoaded = 0;
  const shortWindows = await openWindow(model, (n) => onProgress(encoder, (encoderLoaded += n)));
  const useGpu = runtime === "webgpu" && gpu && model.webgpuEncoder;
  let backend: Backend = useGpu ? "webgpu" : "wasm";
  let built: Awaited<ReturnType<typeof buildModel>>;
  try {
    built = await buildModel(model, backend, onProgress);
  } catch (error) {
    if (backend !== "webgpu") throw error;
    console.warn("WebGPU unavailable for this model, using WebAssembly", error);
    backend = "wasm";
    built = await buildModel(model, backend, onProgress);
  }
  for (const f of model.files) perFile.set(f.path, f.bytes);
  report(true);

  current = { id, backend, ...built, shortWindows, drafts: true };
  post({ type: "ready", model: id, backend, threads: env.backends.onnx.wasm?.numThreads ?? 1 });
}

/**
 * The most tokens a request can produce: far above any recitation (fully vowelled Arabic can take
 * several tokens a word, and a fast reciter says three words a second), so it only stops a model
 * that repeats itself, which it otherwise does up to its limit of 448 tokens, holding up every
 * phrase after.
 */
function tokenBudget(samples: number): number {
  return Math.min(440, Math.ceil((samples / 16000) * 45) + 24);
}

/**
 * One phrase's text. In a short window when the encoder takes them, from the phrase's last provisional
 * transcription when there is one. A finished phrase that comes back repeating itself is transcribed
 * again in the full window, as the model was trained, where a repeat is the reciter's (some ayahs
 * follow one that reads the same) rather than the model's; a provisional one keeps what came before
 * the loop, as it will be replaced anyway.
 *
 * If a short window or a draft fails, the phrase is transcribed without, and if that works, they are
 * not used again.
 */
async function recognize(segment: Float32Array, partial: boolean): Promise<string> {
  const loaded = current!;
  const audio = leveled(segment);
  const maxTokens = tokenBudget(audio.length);
  const inFull = () => transcribePhrase(loaded, audio, { window: FULL_WINDOW_SECONDS * SAMPLE_RATE, maxTokens, guard: false });
  const window = windowSeconds(audio.length, partial ? PARTIAL_PAD_SECONDS : PAD_SECONDS) * SAMPLE_RATE;
  const inShort = (withDraft: boolean) => transcribePhrase(loaded, audio, { window, maxTokens, guard: true, draft: withDraft ? draft : null });

  let result: Transcription | null = null;
  if (loaded.shortWindows) {
    const withDraft = loaded.drafts && draft !== null;
    try {
      result = await inShort(withDraft);
    } catch (error) {
      if (withDraft) {
        result = await inShort(false).catch(() => null);
        if (result) {
          console.warn("Transcribing phrases afresh from now on: starting from a draft failed", error);
          loaded.drafts = false;
        }
      }
      if (!result) {
        result = await inFull();
        console.warn("Transcribing with 30 s windows from now on: a short window failed", error);
        loaded.shortWindows = false;
      }
    }
    if (result.looped && !partial) result = await inFull();
  } else result = await inFull();
  draft = partial ? result.tokens : null;
  return result.text;
}

/** If the graphics processor fails while transcribing, carry on with WebAssembly (and say so). */
async function fallBackToWasm(): Promise<void> {
  const { id, whisper, shortWindows, drafts } = current!;
  current = null;
  await whisper.dispose().catch(() => {});
  current = { id, backend: "wasm", ...(await buildModel(MODELS[id], "wasm", () => {})), shortWindows, drafts };
  post({ type: "ready", model: id, backend: "wasm", threads: env.backends.onnx.wasm?.numThreads ?? 1 });
}

async function transcribe(id: number, segments: Float32Array[], partial: boolean): Promise<void> {
  if (!current) throw new Error("model not loaded");
  const started = performance.now();
  const texts: string[] = [];
  for (const [i, segment] of segments.entries()) {
    let text: string;
    try {
      text = await recognize(segment, partial);
    } catch (error) {
      if (current?.backend !== "webgpu") throw error;
      console.warn("WebGPU failed while transcribing; using WebAssembly from now on", error);
      await fallBackToWasm();
      text = await recognize(segment, partial);
    }
    texts.push(text);
    post({ type: "segment", id, done: i + 1, total: segments.length });
  }
  post({ type: "result", id, texts, ms: Math.round(performance.now() - started) });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "load") {
    const task = (loading ?? Promise.resolve()).then(() => load(message.model, message.origin, message.engine));
    loading = task.catch(() => {});
    task.catch((error: unknown) => {
      post({ type: "error", during: "load", message: error instanceof Error ? error.message : String(error) });
    });
  } else if (message.type === "transcribe") {
    queue = queue
      .then(() => loading)
      .then(() => transcribe(message.id, message.segments, message.partial ?? false))
      .catch((error: unknown) => {
        post({ type: "error", id: message.id, during: "transcribe", message: error instanceof Error ? error.message : String(error) });
      });
  }
};
