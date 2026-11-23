import { useSyncExternalStore } from "react";
import type { ModelId } from "../config/models";
import { asr, bytesToDownload, engineFor } from "../lib/asr/client";
import type { Backend, EnginePreference } from "../lib/asr/protocol";

export type ModelStatus =
  | { phase: "checking" }
  | { phase: "needs-download"; bytes: number }
  | { phase: "downloading"; loaded: number; total: number }
  | { phase: "loading" }
  | { phase: "ready"; backend: Backend; threads: number }
  | { phase: "error"; message: string };

let status: ModelStatus = { phase: "checking" };
let key = "";
/** The ONNX Runtime build the current worker was set up with. */
let runtimeInWorker: Backend | null = null;
const listeners = new Set<() => void>();

function set(next: ModelStatus) {
  status = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// If the graphics processor fails after loading, the worker carries on with WebAssembly: show it.
asr.onEngine((info) => {
  if (status.phase === "ready" && (status.backend !== info.backend || status.threads !== info.threads)) set({ phase: "ready", ...info });
});

export function useModelStatus(): ModelStatus {
  return useSyncExternalStore(subscribe, () => status);
}

async function start(model: ModelId, engine: EnginePreference, myKey: string, downloading: boolean) {
  // ONNX Runtime is set up once per worker; a different build needs a fresh worker.
  const runtime = await engineFor(engine, model);
  if (runtimeInWorker !== null && runtimeInWorker !== runtime) asr.terminate();
  runtimeInWorker = runtime;
  set(downloading ? { phase: "downloading", loaded: 0, total: 1 } : { phase: "loading" });
  try {
    const info = await asr.load(model, engine, (p) => {
      if (key === myKey && downloading) set({ phase: "downloading", loaded: p.loaded, total: p.total });
    });
    if (key === myKey) set({ phase: "ready", backend: info.backend, threads: info.threads });
    // Ask the browser to keep the downloaded model (and the offline copy of the site) when space runs low.
    if (downloading) navigator.storage?.persist?.().catch(() => {});
  } catch (error) {
    if (key === myKey) set({ phase: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Checks whether the model is already in this browser. If it is, it is loaded right away;
 * otherwise the status asks for a one-time download, which only starts on `downloadModel`.
 */
export async function prepareModel(model: ModelId, engine: EnginePreference): Promise<void> {
  const myKey = `${model}:${engine}`;
  if (myKey === key && status.phase !== "error") return;
  key = myKey;
  set({ phase: "checking" });
  const bytes = await bytesToDownload(model, engine);
  if (key !== myKey) return;
  if (bytes > 0) set({ phase: "needs-download", bytes });
  else await start(model, engine, myKey, false);
}

export function downloadModel(model: ModelId, engine: EnginePreference): Promise<void> {
  key = `${model}:${engine}`;
  return start(model, engine, key, true);
}

/** Forget the loaded model (after its files were deleted). */
export function resetModel() {
  asr.terminate();
  runtimeInWorker = null;
  key = "";
  set({ phase: "checking" });
}
