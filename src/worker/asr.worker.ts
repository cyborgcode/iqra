/// <reference lib="webworker" />
// Speech recognition, entirely on this device: a Web Worker runs Whisper (ONNX Runtime via
// Transformers.js) so the page never freezes. Audio arrives from the page and never leaves the browser.

import {
  AutoConfig,
  AutoProcessor,
  AutoTokenizer,
  AutomaticSpeechRecognitionPipeline,
  WhisperForConditionalGeneration,
  env,
} from "@huggingface/transformers";
import { MODELS, RUNTIME, type ModelConfig, type ModelId } from "../config/models";
import type { Backend, EnginePreference, WorkerRequest, WorkerResponse } from "../lib/asr/protocol";

declare const self: DedicatedWorkerGlobalScope;

const CACHE_NAME = "transformers-cache";

function post(message: WorkerResponse) {
  self.postMessage(message);
}

env.allowLocalModels = false;
env.useBrowserCache = true;

let runtime: Backend | null = null;
let current: { id: ModelId; pipe: AutomaticSpeechRecognitionPipeline; backend: Backend } | null = null;
let loading: Promise<void> | null = null;
/** Transcriptions run one at a time, in the order they were requested. */
let queue: Promise<void> = Promise.resolve();

type Adapter = { info?: { isFallbackAdapter?: boolean }; isFallbackAdapter?: boolean };

/** True for a real GPU adapter. Software ("fallback") adapters are much slower than WebAssembly. */
async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    const adapter = (gpu ? await gpu.requestAdapter() : null) as Adapter | null;
    return !!adapter && !(adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter ?? false);
  } catch {
    return false;
  }
}

/** Downloads one file into the shared cache with progress, unless it is already there. */
async function prefetch(url: string, onBytes: (n: number) => void): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  if (await cache.match(url)) return;
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
  await cache.put(url, new Response(new Blob(chunks as BlobPart[], { type }), { headers: { "Content-Type": type } }));
}

async function buildPipeline(model: ModelConfig, backend: Backend, onProgress: (file: string, loaded: number) => void) {
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
  return new AutomaticSpeechRecognitionPipeline({
    task: "automatic-speech-recognition",
    model: whisper,
    tokenizer,
    processor,
  });
}

async function load(id: ModelId, origin: string, engine: EnginePreference): Promise<void> {
  const model = MODELS[id];
  if (current?.id === id && (engine === "auto" || current.backend === "wasm")) {
    post({ type: "ready", model: id, backend: current.backend, threads: env.backends.onnx.wasm?.numThreads ?? 1 });
    return;
  }
  await current?.pipe.dispose();
  current = null;

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
  const useGpu = runtime === "webgpu" && gpu && model.webgpuEncoder;
  let backend: Backend = useGpu ? "webgpu" : "wasm";
  let pipe: AutomaticSpeechRecognitionPipeline;
  try {
    pipe = await buildPipeline(model, backend, onProgress);
  } catch (error) {
    if (backend !== "webgpu") throw error;
    console.warn("WebGPU unavailable for this model, using WebAssembly", error);
    backend = "wasm";
    pipe = await buildPipeline(model, backend, onProgress);
  }
  for (const f of model.files) perFile.set(f.path, f.bytes);
  report(true);

  current = { id, pipe, backend };
  post({ type: "ready", model: id, backend, threads: env.backends.onnx.wasm?.numThreads ?? 1 });
}

async function transcribe(id: number, segments: Float32Array[]): Promise<void> {
  if (!current) throw new Error("model not loaded");
  const started = performance.now();
  const texts: string[] = [];
  for (const [i, segment] of segments.entries()) {
    const output = await current.pipe(segment, { language: "arabic", task: "transcribe" });
    const text = Array.isArray(output) ? output.map((o) => o.text).join(" ") : output.text;
    texts.push(text.trim());
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
      .then(() => transcribe(message.id, message.segments))
      .catch((error: unknown) => {
        post({ type: "error", id: message.id, during: "transcribe", message: error instanceof Error ? error.message : String(error) });
      });
  }
};
