import { MODELS, RUNTIME, fileUrl, modelBytes, type ModelId } from "../../config/models";
import { hasWebGPU } from "./gpu";
import type { Backend, EnginePreference, WorkerRequest, WorkerResponse } from "./protocol";

const CACHE_NAME = "transformers-cache";

export interface Progress {
  loaded: number;
  total: number;
}

export interface ReadyInfo {
  backend: Backend;
  threads: number;
}

let gpuCheck: Promise<boolean> | null = null;

/** Whether the model may use the graphics processor here (see gpu.ts). */
export function webgpuAvailable(): Promise<boolean> {
  gpuCheck ??= hasWebGPU();
  return gpuCheck;
}

/**
 * The engine build this browser needs for a model: the WebGPU-capable build only when the user allows
 * it, the device has a real GPU adapter, and the model can use it.
 */
export async function engineFor(engine: EnginePreference, model?: ModelId): Promise<Backend> {
  if (model && !MODELS[model].webgpuEncoder) return "wasm";
  return engine === "auto" && (await webgpuAvailable()) ? "webgpu" : "wasm";
}

function runtimeUrl(backend: Backend): string {
  return new URL(RUNTIME.base + RUNTIME[backend].wasm, location.origin).href;
}

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === "undefined" ? null : await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

/** Bytes still to download before `id` can run here (0 when everything is cached). */
export async function bytesToDownload(id: ModelId, engine: EnginePreference = "auto"): Promise<number> {
  const model = MODELS[id];
  const backend = await engineFor(engine, id);
  const cache = await openCache();
  if (!cache) return modelBytes(model) + RUNTIME[backend].bytes;
  let bytes = (await cache.match(runtimeUrl(backend))) ? 0 : RUNTIME[backend].bytes;
  for (const file of model.files) {
    if (!(await cache.match(fileUrl(model, file.path)))) bytes += file.bytes;
  }
  return bytes;
}

/** Removes every downloaded model and engine file from this browser. */
export async function deleteDownloads(): Promise<void> {
  if (typeof caches !== "undefined") await caches.delete(CACHE_NAME);
}

/**
 * Talks to the speech-recognition worker. The worker (and Transformers.js with it) is only
 * created when a model is first needed, so it is not part of the initial page load.
 */
class AsrClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private listeners = new Set<(message: WorkerResponse) => void>();
  private engineListeners = new Set<(info: ReadyInfo) => void>();
  private loaded: ModelId | null = null;
  /** How long the last request took: seconds of audio, and milliseconds to transcribe them. */
  lastTiming: { audioSeconds: number; ms: number } | null = null;

  private get port(): Worker {
    if (!this.worker) {
      const worker = new Worker(new URL("../../worker/asr.worker.ts", import.meta.url), { type: "module", name: "iqra-asr" });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const m = event.data;
        // The engine in use, also when it changes after loading (the graphics processor failed).
        if (m.type === "ready") this.engineListeners.forEach((l) => l({ backend: m.backend, threads: m.threads }));
        this.listeners.forEach((l) => l(m));
      };
      worker.onerror = (event) => {
        const message: WorkerResponse = { type: "error", during: "load", message: event.message || "The speech engine failed to start." };
        this.listeners.forEach((l) => l(message));
      };
      this.worker = worker;
    }
    return this.worker;
  }

  private send(request: WorkerRequest, transfer: Transferable[] = []) {
    this.port.postMessage(request, transfer);
  }

  get loadedModel(): ModelId | null {
    return this.loaded;
  }

  load(model: ModelId, engine: EnginePreference, onProgress?: (p: Progress) => void): Promise<ReadyInfo> {
    return new Promise((resolve, reject) => {
      const listener = (m: WorkerResponse) => {
        if (m.type === "progress" && m.model === model) onProgress?.({ loaded: m.loaded, total: m.total });
        else if (m.type === "ready" && m.model === model) {
          this.listeners.delete(listener);
          this.loaded = model;
          resolve({ backend: m.backend, threads: m.threads });
        } else if (m.type === "error" && m.during === "load") {
          this.listeners.delete(listener);
          reject(new Error(m.message));
        }
      };
      this.listeners.add(listener);
      this.send({ type: "load", model, origin: location.origin, engine });
    });
  }

  /** Transcribes each segment (16 kHz mono) and returns one text per segment. */
  transcribe(segments: Float32Array[], onSegment?: (done: number, total: number) => void): Promise<string[]> {
    const id = this.nextId++;
    // Each segment gets its own buffer so it can be transferred without copying the whole recording.
    const owned = segments.map((s) => s.slice());
    // Measured now: the buffers are handed over to the worker (and empty here) once sent.
    const audioSeconds = owned.reduce((sum, a) => sum + a.length, 0) / 16000;
    return new Promise((resolve, reject) => {
      const listener = (m: WorkerResponse) => {
        if (m.type === "segment" && m.id === id) onSegment?.(m.done, m.total);
        else if (m.type === "result" && m.id === id) {
          this.listeners.delete(listener);
          this.lastTiming = { audioSeconds, ms: m.ms };
          resolve(m.texts);
        } else if (m.type === "error" && (m.id === id || m.during === "load")) {
          this.listeners.delete(listener);
          reject(new Error(m.message));
        }
      };
      this.listeners.add(listener);
      this.send({ type: "transcribe", id, segments: owned }, owned.map((s) => s.buffer));
    });
  }

  /** Calls `listener` with the engine in use whenever the worker reports it. */
  onEngine(listener: (info: ReadyInfo) => void): () => void {
    this.engineListeners.add(listener);
    return () => this.engineListeners.delete(listener);
  }

  /** Stops the worker and frees the model's memory. */
  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.loaded = null;
  }
}

export const asr = new AsrClient();
