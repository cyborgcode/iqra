import type { ModelId } from "../../config/models";

/** "auto" uses WebGPU when a real GPU adapter is available; "wasm" always uses WebAssembly. */
export type EnginePreference = "auto" | "wasm";

/** Messages from the page to the speech-recognition worker. */
export type WorkerRequest =
  | { type: "load"; model: ModelId; origin: string; engine: EnginePreference }
  /** `partial`: a phrase still being recited, transcribed provisionally. */
  | { type: "transcribe"; id: number; segments: Float32Array[]; partial?: boolean };

export type Backend = "webgpu" | "wasm";

/** Messages from the worker to the page. */
export type WorkerResponse =
  | { type: "progress"; model: ModelId; loaded: number; total: number }
  | { type: "ready"; model: ModelId; backend: Backend; threads: number }
  | { type: "segment"; id: number; done: number; total: number }
  | { type: "result"; id: number; texts: string[]; ms: number }
  | { type: "error"; id?: number; during: "load" | "transcribe"; message: string };
