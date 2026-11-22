/// <reference types="vitest/config" />
import { createReadStream, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// ONNX Runtime's WebAssembly engine is served by this site instead of a third-party CDN.
// Two builds: with WebGPU support (asyncify) and plain WebAssembly (smaller, for browsers without WebGPU).
const ORT_DIR = path.resolve("node_modules/onnxruntime-web/dist");
const ORT_VERSION: string = JSON.parse(readFileSync(path.resolve("node_modules/onnxruntime-web/package.json"), "utf8")).version;
const ORT_BASE = `/ort/${ORT_VERSION}/`;
const ORT_BUILDS = {
  webgpu: { mjs: "ort-wasm-simd-threaded.asyncify.mjs", wasm: "ort-wasm-simd-threaded.asyncify.wasm" },
  wasm: { mjs: "ort-wasm-simd-threaded.mjs", wasm: "ort-wasm-simd-threaded.wasm" },
};
const ORT_FILES = Object.values(ORT_BUILDS).flatMap((b) => [b.mjs, b.wasm]);
const size = (file: string) => statSync(path.join(ORT_DIR, file)).size;

const ORT_RUNTIME = {
  version: ORT_VERSION,
  base: ORT_BASE,
  webgpu: { ...ORT_BUILDS.webgpu, bytes: size(ORT_BUILDS.webgpu.wasm) },
  wasm: { ...ORT_BUILDS.wasm, bytes: size(ORT_BUILDS.wasm.wasm) },
};

function ortRuntime(): Plugin {
  return {
    name: "iqra:ort-runtime",
    configureServer(server) {
      server.middlewares.use(ORT_BASE, (req, res, next) => {
        const file = (req.url ?? "").replace(/^\//, "").split("?")[0]!;
        if (!ORT_FILES.includes(file)) return next();
        res.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        createReadStream(path.join(ORT_DIR, file)).pipe(res);
      });
    },
    generateBundle() {
      for (const file of ORT_FILES) {
        this.emitFile({ type: "asset", fileName: `ort/${ORT_VERSION}/${file}`, source: readFileSync(path.join(ORT_DIR, file)) });
      }
    },
  };
}

// Cross-origin isolation enables SharedArrayBuffer, which multithreaded WebAssembly needs
// (2× faster transcription in testing). Production headers live in vercel.json; `vite preview`
// serves the same ones so the built site can be tested as deployed. The dev server only gets the
// isolation headers (its hot-reload client needs inline scripts that the CSP would block).
const VERCEL: { headers: { source: string; headers: { key: string; value: string }[] }[] } = JSON.parse(
  readFileSync(path.resolve("vercel.json"), "utf8"),
);
const SITE_HEADERS = Object.fromEntries(VERCEL.headers.find((h) => h.source === "/(.*)")!.headers.map((h) => [h.key, h.value]));
const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": SITE_HEADERS["Cross-Origin-Opener-Policy"]!,
  "Cross-Origin-Embedder-Policy": SITE_HEADERS["Cross-Origin-Embedder-Policy"]!,
};

export default defineConfig({
  plugins: [react(), tailwindcss(), ortRuntime()],
  server: { headers: ISOLATION_HEADERS },
  preview: { headers: SITE_HEADERS },
  define: {
    __ORT_RUNTIME__: JSON.stringify(ORT_RUNTIME),
  },
  resolve: {
    // Use ONNX Runtime's build that loads its WebAssembly from the paths we set (served from ORT_BASE),
    // instead of the "bundle" build, which would make Vite emit a second copy of the 27 MB engine.
    conditions: ["onnxruntime-web-use-extern-wasm", ...defaultClientConditions],
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    // Transformers.js resolves its ONNX Runtime files at run time; pre-bundling breaks that.
    exclude: ["@huggingface/transformers"],
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
  },
});
