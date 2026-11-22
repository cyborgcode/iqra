/// <reference types="vite/client" />

declare const __ORT_RUNTIME__: {
  version: string;
  base: string;
  webgpu: { mjs: string; wasm: string; bytes: number };
  wasm: { mjs: string; wasm: string; bytes: number };
};
